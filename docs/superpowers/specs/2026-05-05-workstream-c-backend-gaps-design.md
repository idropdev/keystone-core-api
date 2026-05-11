# Workstream C — Keystone Backend Gaps for Mobile Slices Design

**Date:** 2026-05-05
**Repo affected:** keystone-core-api (no HealthAtlas or LayerOne changes)
**Branch:** `vignesh-changes`
**Estimated effort:** ~7-10 working days, single developer
**PR cadence:** three sequential PRs (one per sub-workstream)
**Order of execution:** C3 → C4 → C2

---

## 1. Context

Workstream C consolidates all keystone-core-api backend changes that HealthAtlas mobile Slices 2, 3, and 4 of workstream B require. Doing it as a single coordinated push (rather than per-slice keystone changes interleaved with mobile work) gives us:

- Cleaner backend history — three focused PRs instead of three half-PRs scattered across mobile work
- Staging deployable as soon as C lands, so device QA of B Slices 2-4 hits real endpoints not mocks
- Better backend review focus — reviewers see backend changes in keystone's own context
- Unblocks B Slice 1 device QA (currently deferred) by virtue of giving us a comprehensive end-to-end testable surface

This document references the parent workstream B design at `HealthAtlas/docs/superpowers/specs/2026-05-04-mobile-feature-wiring-design.md`. Sections referenced below should be read alongside this spec.

## 2. Scope

### In scope

**C2 — Document upload/download hardening (~1 day)**
- C2.1 MIME magic-byte sniffing in upload validation (not just `Content-Type` header)
- C2.2 Audit / add `assertOwnership(userId, documentId)` on all document GET/DELETE/download paths
- C2.3 Verify `getDownloadStream(id, userId)` behavior matches what Flutter expects (presigned URL vs proxied stream)

**C3 — At-a-glance aggregator (~2 days)**
- C3.1 New `AtAGlanceModule` with controller + service + DTOs + field-category-map
- C3.2 `GET /api/v1/at-a-glance/summary` — JWT-guarded, throttled 30/min, reads existing `extracted_fields` table
- C3.3 No database migrations

**C4 — Chat thread routes + `/me` augmentation (~4-5 days)**
- C4.1 `GET /:slug/threads` route in anythingllm-workspace.controller (delegates to `AnythingLLMThreadService.listThreads`)
- C4.2 `DELETE /:slug/thread/:threadSlug` route
- C4.3 `GET /:slug/thread/:threadSlug/chats` route (for resume)
- C4.4 Augment `GET /auth/me` response with `chatWorkspaceSlug` field (looked up via `AnythingLLMUserMappings`)
- C4.5 Verify stream-chat throttle is per-user, not per-IP

### Out of scope (explicit)

- LayerOne / anything-LayerOne-LLM changes — none needed; already supports threaded streaming
- HealthAtlas / Flutter changes — those are B slices, consumed once C lands
- HIPAA hardening (refresh token TTL, CloudLoggingClient refactor, distributed Redis rate limiting, BAA) → workstream E
- Records CRUD modules (medications, allergies, conditions, providers, pharmacies, insurance, emergency contact) → separate future workstream targeting the hybrid extracted-from-documents + manual-augment model. The B spec §6 deferred these and that deferral stands.
- New database migrations — everything in C builds on existing tables
- Cloud deployment changes — workstream D
- CI/CD additions — workstream F (existing `docker-e2e.yml` workflow stays unchanged per AWS SOW)

## 3. Architecture

### What goes where

| Sub-workstream | New files | Modified files | Migrations |
|---|---|---|---|
| **C3** | `src/at-a-glance/at-a-glance.module.ts`, `src/at-a-glance/at-a-glance.controller.ts`, `src/at-a-glance/at-a-glance.service.ts`, `src/at-a-glance/dto/at-a-glance-summary.dto.ts`, `src/at-a-glance/utils/field-category-map.ts`, `test/at-a-glance/*.e2e-spec.ts` | `src/app.module.ts` (register `AtAGlanceModule`) | none |
| **C4** | One e2e spec for the new routes | `src/anythingllm/workspace/anythingllm-workspace.controller.ts` (add 3 routes), `src/auth/auth.controller.ts` or `src/auth/auth.service.ts` (augment `/me`), `src/anythingllm/thread/anythingllm-thread.service.ts` (verify methods exist; add if not) | none |
| **C2** | E2e spec adjustments | `src/document-processing/document-processing.controller.ts` (MIME magic-byte check), `src/document-processing/document-processing.service.ts` (ownership audit if missing) | none |

### Auth/authorization model (unchanged from existing keystone patterns)

- All new endpoints are JWT-guarded via the existing `AuthGuard('jwt')`
- All chat-thread routes additionally use the existing `AnythingLLMOrchestratorService.executeOperation` policy check, which already verifies workspace ownership via the `AnythingLLMUserMappings` table
- The at-a-glance aggregator scopes all queries to `:userId` extracted from the JWT — never accepts a `userId` query param
- Document ownership is enforced via the existing `assertOwnership(userId, documentId)` pattern; C2.2 is an audit pass to confirm it's applied uniformly

### Data flow — at-a-glance aggregator (the only new domain piece)

```
mobile client ─── GET /api/v1/at-a-glance/summary  (JWT) ───▶ AtAGlanceController
                                                              │
                                                              ▼
                                                        AtAGlanceService.getSummaryForUser(userId)
                                                              │
                                                              ▼
                                                        SELECT field_type, field_key, field_value,
                                                               confidence, document_id, created_at
                                                          FROM extracted_fields ef
                                                          JOIN documents d ON d.id = ef.document_id
                                                         WHERE d.user_id = :userId
                                                           AND d.status = 'COMPLETED'
                                                         ORDER BY ef.created_at DESC
                                                              │
                                                              ▼
                                                        Bucket rows by field_category_map[fieldType]
                                                        For each bucket: top-3 unique values by recency
                                                        Special case: blood_type → singleton value
                                                              │
                                                              ▼
                                                        AtAGlanceSummaryDto JSON response
```

### Field → category map (initial, lives in code at `src/at-a-glance/utils/field-category-map.ts`)

```ts
medications:        ['medication','drug_name','prescription_name']
allergies:          ['allergy','allergen']
conditions:         ['condition','diagnosis','medical_condition']
doctors:            ['physician','provider','doctor']
pharmacies:         ['pharmacy','dispensing_pharmacy']
insurance:          ['insurance','policy_number','insurer']
emergency_contact:  ['emergency_contact']
blood_type:         ['blood_type']
```

This map is the single source of truth. Unknown `field_type` values get logged but do not break the response (they go into an `uncategorized` bucket included in the response but not surfaced by mobile UI).

### Response shape — `AtAGlanceSummaryDto`

```json
{
  "categories": {
    "medications":       {"count": 3, "samples": [{"name":"Lisinopril","dose":"10mg"}, ...]},
    "allergies":         {"count": 1, "samples": [...]},
    "conditions":        {"count": 2, "samples": [...]},
    "doctors":           {"count": 4, "samples": [...]},
    "pharmacies":        {"count": 1, "samples": [...]},
    "insurance":         {"count": 1, "samples": [...]},
    "emergency_contact": {"count": 0, "samples": []},
    "blood_type":        {"value": "O+", "source_document_id": "..."}
  },
  "last_updated": "2026-05-05T10:23:00Z",
  "documents_analyzed": 7
}
```

The `samples` arrays are at most 3 entries each. `blood_type` returns the most-recent single value rather than an array.

### Chat thread routes — the three new routes

All under `Controller('anythingllm/v1/workspace')` (existing controller class):

```
GET    /anythingllm/v1/workspace/:slug/threads
       → AnythingLLMThreadService.listThreads(slug, requesterContext)
       → returns [{slug, name, createdAt, lastMessageAt, lastMessagePreview}]
       → JWT-guarded + orchestrator policy check on workspace ownership

DELETE /anythingllm/v1/workspace/:slug/thread/:threadSlug
       → AnythingLLMThreadService.deleteThread(slug, threadSlug, requesterContext)
       → returns 204
       → JWT-guarded + orchestrator policy check on thread ownership

GET    /anythingllm/v1/workspace/:slug/thread/:threadSlug/chats
       → AnythingLLMThreadService.getThreadChats(slug, threadSlug, requesterContext)
       → returns thread message history for resume
       → JWT-guarded + orchestrator policy check on thread ownership
```

The corresponding service methods may already exist in `AnythingLLMThreadService` (the schemas `ThreadChatsResponseSchema`, `DeleteThreadResponseSchema`, etc. are already in `registry/schemas`). If the public methods are missing, C4 includes wrapping the upstream AnythingLLM endpoints — same pattern as `createThread`.

### `/auth/me` augmentation

Current shape returns the `User` entity. New shape adds `chatWorkspaceSlug: string | null` (null if the user has no provisioned workspace yet; in practice every authenticated user should have one because workspace provisioning runs at registration).

Lookup: `AnythingLLMUserMappings` table, indexed on `keystoneUserId`. Existing `AnythingLLMUserProvisioningService` has helpers that surface the slug — we delegate to that rather than re-implementing the lookup.

Adding this field rather than a separate `/me/chat-workspace` endpoint saves one round trip on app start and simplifies the Flutter client.

## 4. Sub-workstream details

### C3 — At-a-glance aggregator (do first)

**Why first:** smallest, isolated, no dependency on existing code paths, gives momentum.

**Files created:**
- `src/at-a-glance/at-a-glance.module.ts` — NestJS module declaration
- `src/at-a-glance/at-a-glance.controller.ts` — single endpoint, JWT-guarded, `@Throttle({default:{limit:30, ttl:60000}})`
- `src/at-a-glance/at-a-glance.service.ts` — single method `getSummaryForUser(userId): Promise<AtAGlanceSummaryDto>`
- `src/at-a-glance/dto/at-a-glance-summary.dto.ts` — Swagger-decorated response DTO
- `src/at-a-glance/dto/category-data.dto.ts` — nested type
- `src/at-a-glance/utils/field-category-map.ts` — static `field_type → category` lookup table
- `src/at-a-glance/utils/field-category-map.spec.ts` — unit tests for the mapper
- `src/at-a-glance/at-a-glance.service.spec.ts` — service unit tests with Postgres testcontainer
- `test/at-a-glance/at-a-glance.e2e-spec.ts` — e2e test against running app

**Files modified:**
- `src/app.module.ts` — register `AtAGlanceModule` in imports

**Behavior matrix:**

| Scenario | Behavior |
|---|---|
| Authenticated user, 0 documents | Returns all categories with `count: 0` + empty samples, `documents_analyzed: 0` |
| Documents present but none COMPLETED | Same as above + `last_updated: null` |
| Some categories empty, others populated | Empty categories return `count: 0`, populated ones return counts + top-3 samples |
| `extracted_fields` row with `fieldType` not in map | Goes into `uncategorized` bucket; logged via `Logger.debug` for visibility |
| User A's `extracted_fields` are isolated from user B's | Verified by integration test seeding both users |
| 31st request in 60s from same user | 429 Too Many Requests |

**Acceptance criteria for C3:**
- [ ] `GET /api/v1/at-a-glance/summary` returns 200 with `AtAGlanceSummaryDto` shape
- [ ] Without JWT → 401
- [ ] User A cannot see user B's data (verified in e2e test seeding two users)
- [ ] Empty account (no documents) returns all categories with count 0
- [ ] Account with `extracted_fields` matching multiple categories returns correct counts + samples
- [ ] `blood_type` returns singleton `value`, not `samples` array
- [ ] p95 < 200ms for a user with 50 documents on dev hardware
- [ ] OpenAPI / Swagger UI shows the new endpoint with full DTO schema
- [ ] Three commits or fewer, all on `vignesh-changes`, all without Claude/.claude attribution

### C4 — Chat thread routes + `/me` augmentation (do second)

**Why second:** largest piece, but C3 will have warmed up the testing patterns. Lands the most user-visible backend capability.

**Files created:**
- `test/anythingllm/thread-routes.e2e-spec.ts` — e2e tests for the 3 new routes
- `test/auth/me-with-workspace.e2e-spec.ts` — e2e test for augmented `/me`

**Files modified:**
- `src/anythingllm/workspace/anythingllm-workspace.controller.ts` — add 3 `@Get`/`@Delete` route handlers
- `src/anythingllm/thread/anythingllm-thread.service.ts` — verify `listThreads`, `deleteThread`, `getThreadChats` exist publicly; add wrapping methods if not. Schemas (`ThreadChatsResponseSchema`, etc.) already in `registry/schemas`.
- `src/auth/auth.controller.ts` and/or `src/auth/auth.service.ts` — augment `/me` response with `chatWorkspaceSlug`
- `src/auth/dto/user.dto.ts` (or wherever the `/me` response is typed) — add the `chatWorkspaceSlug` field

**Behavior matrix:**

| Scenario | Behavior |
|---|---|
| `GET /workspace/:slug/threads` for owned workspace | 200 with thread list |
| `GET /workspace/:slug/threads` for another user's workspace | 403 (orchestrator policy denies) |
| `GET /workspace/:slug/threads` for nonexistent workspace | 404 |
| `DELETE /workspace/:slug/thread/:threadSlug` for owned thread | 204 |
| `DELETE` for other user's thread | 403 |
| `DELETE` for nonexistent thread | 404 |
| `GET /workspace/:slug/thread/:threadSlug/chats` for owned thread | 200 with message history |
| `GET /auth/me` for user with provisioned workspace | 200 with `chatWorkspaceSlug` populated |
| `GET /auth/me` for user without workspace (edge case) | 200 with `chatWorkspaceSlug: null` |
| Stream-chat throttle (existing) | Confirmed per-user, not per-IP (verified by simulating two users from same IP) |

**Acceptance criteria for C4:**
- [ ] All 3 new routes return correct responses for happy path
- [ ] Ownership 403 verified in integration test for each route
- [ ] `/auth/me` includes `chatWorkspaceSlug` field
- [ ] Existing `/auth/me` consumers don't break (added field, no removed/renamed fields)
- [ ] Stream-chat throttle is per-user (verified)
- [ ] OpenAPI / Swagger shows new endpoints and the augmented `/me` schema
- [ ] All commits on `vignesh-changes`, no Claude/.claude attribution

### C2 — Document upload/download hardening (do third)

**Why third:** smallest scope, mostly hardening on existing code — closer for the workstream.

**Files modified:**
- `src/document-processing/document-processing.controller.ts` — MIME magic-byte validation in `upload` handler; ownership-check audit on all paths
- `src/document-processing/document-processing.service.ts` — verify `getDownloadStream(id, userId)` signature and behavior
- `test/document-processing/document-processing.e2e-spec.ts` — extend existing e2e with MIME-mismatch + ownership-violation cases

**Magic-byte implementation:** Use `file-type` npm package (active, well-maintained, supports our 5 allowed MIME types). Read first ~4KB of the uploaded buffer, call `fileTypeFromBuffer`, compare to declared `Content-Type` from the multipart part. If mismatch or detection fails for an allow-listed type, return 415.

**Behavior matrix:**

| Scenario | Behavior |
|---|---|
| Upload PDF with `Content-Type: application/pdf` and matching bytes | 201, accepted |
| Upload `.exe` renamed `.pdf` with `Content-Type: application/pdf` | 415, magic bytes don't match |
| Upload PDF with `Content-Type: application/octet-stream` | 415 (Content-Type not in allow-list) |
| Upload JPEG with `Content-Type: image/jpeg` | 201 |
| Upload HEIC (some iOS uploads) | 415 — mobile client should auto-convert before upload |
| File >25 MB | 413 (existing Multer body limit) |
| `GET /:id` for another user's document | 403 (audited by C2.2) |
| `DELETE /:id` for another user's document | 403 |
| `GET /:id/download` for another user's document | 403 |

**Acceptance criteria for C2:**
- [ ] MIME magic-byte check rejects header/content mismatches
- [ ] All allow-listed types still upload successfully
- [ ] Ownership 403 returned (not 404) for cross-user access attempts to any document endpoint
- [ ] No regressions in existing document-processing e2e suite
- [ ] All commits on `vignesh-changes`, no Claude/.claude attribution

## 5. Testing approach

Each sub-workstream produces unit tests + at least one e2e test. Test infra additions:

- **C3:** new `test/at-a-glance/` directory, Postgres testcontainer setup mirroring existing patterns (the `document-processing` e2e test is a good template — copy the test container bootstrap)
- **C4:** extend existing `test/anythingllm/` patterns; `/me` e2e goes in `test/auth/`
- **C2:** extend existing `test/document-processing/`

The existing `docker-e2e.yml` workflow stays unchanged (per the AWS SOW deliverable list). New tests must run within that workflow's existing matrix.

## 6. Definition of "Workstream C done"

- [ ] Three PRs merged to `vignesh-changes` in `keystone-core-api`: C3, then C4, then C2
- [ ] All new endpoints visible in Swagger UI with correct DTO schemas
- [ ] All new e2e tests pass in CI
- [ ] No new ESLint or `tsc` errors
- [ ] No commit references Claude/Anthropic/co-authored-by/.claude
- [ ] Staging environment redeployed and reachable (deferred — actual deploy is workstream D's concern; this just confirms the build is deployable)

Once C is done, B Slice 1's deferred device QA can run combined with all the B Slice 2/3/4 feature work as a single comprehensive QA pass.

## 7. Open verification items (resolve during implementation, not blocking design approval)

- **C2:** Confirm `documentProcessingService.getDownloadStream` returns a presigned GCS URL (Dio follows redirects) vs proxies a stream. Behavior identical to Flutter either way; just affects the C2.3 implementation footprint.
- **C2:** Confirm whether `assertOwnership(userId, documentId)` is already enforced on GET/DELETE/download paths (likely yes given the HIPAA-aware controller comments). If yes, C2.2 is a one-pass audit; if no, it's a 1-day fix touching ~4 endpoints.
- **C3:** Audit the actual `extracted_fields.fieldType` values emitted by the OCR pipeline (Document AI + Vision + text-entity-extractor regex). Update `field-category-map.ts` to cover all observed types. Anything unmapped lands in the `uncategorized` bucket.
- **C4:** Confirm `AnythingLLMThreadService.listThreads`, `deleteThread`, `getThreadChats` exist as public methods. The schemas are in `registry/schemas`; the service might already expose them. If not, wrapping the upstream AnythingLLM endpoints is small.
- **C4:** Confirm stream-chat throttle scope by inspecting `@Throttle` decorator + `ThrottlerGuard` config. If IP-based, switch to user-based (use `req.user.id` as the key).

## 8. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `extracted_fields.fieldType` taxonomy doesn't match expected categories | Medium | C3 returns mostly `uncategorized` data | Audit emitted types in dev DB during C3; map is editable in code; ship with the best initial map and update as discoveries land |
| `AnythingLLMThreadService` doesn't have the public methods we assume | Low | C4 grows by ~half a day to wrap them | Wrap the upstream HTTP endpoints using the same pattern as the existing `createThread` method |
| Throttle is IP-based and we don't catch it | Medium | Multiple users behind one NAT share a quota | Explicit verification test in C4.5; fix if found |
| Pre-existing `package-lock.json` working-tree change in keystone collides with our work | Low | Bundles unrelated changes into our commits | Use explicit `git add -- <paths>` in every commit (same discipline as Slice 1) |
| `file-type` npm package conflicts with existing dependencies | Low | C2 needs a different approach | Check `package.json` before adding; fall back to manual magic-byte signatures if needed |

## 9. Decisions log

Locked through brainstorming and clarification on 2026-05-05:

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | C2 + C3 + C4 as outlined; LayerOne / Flutter / HIPAA hardening / records CRUD / migrations all out |
| 2 | PR cadence within C | Three sequential PRs (C3, C4, C2), one per sub-workstream |
| 3 | Order of execution | C3 → C4 → C2 (small new module → biggest feature → cleanup hardening) |
| 4 | Test infra | Reuse existing `docker-e2e.yml` workflow per AWS SOW (no changes to it) |
| 5 | Branch | All work on `vignesh-changes` in `keystone-core-api` |
| 6 | Migrations | None — all work builds on existing tables (`extracted_fields`, `AnythingLLMUserMappings`, etc.) |
| 7 | Commit attribution | No Claude/.claude/co-authored-by per standing rule |
