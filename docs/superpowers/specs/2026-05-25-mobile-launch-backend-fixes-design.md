## Mobile Launch Backend Fixes — Design

**Date:** 2026-05-25
**Status:** Approved design, ready for implementation plan
**Context:** HealthAtlas mobile is queued for App Store submission with five CEO-mandated features. Two CEO requirements are blocked by keystone backend behavior, not mobile bugs: (1) Files tab shows empty because `GET /documents` doesn't return user-owned uploads, (2) chat returns "I haven't seen anything about that" because uploaded docs aren't pushed to the user's AnythingLLM workspace. This spec covers the two backend fixes that unblock the mobile launch.

## Decisions (from brainstorming)

- **BE1 (Files tab fix): add a `temporaryManagerId` branch in `DocumentAccessDomainService.listDocuments`.** Mirror the existing manager-by-origin pattern. New repo port method `findByTemporaryManagerId`. No data migration, no auto-grant on upload.
- **BE2 (chat embed): fire-and-forget AnythingLLM push at the tail of `runProcessing`,** after OCR completes and status transitions to `PROCESSED`. Push includes raw file bytes AND Document AI extracted fields for better RAG quality. Failures are logged, do not affect the user-visible upload or OCR pipeline.
- **Tests: unit tests for the new branches + service methods; manual integration QA on the simulator after Cloud Run deploy.**
- **Out of scope: backfill** of existing pre-fix uploads into chat workspaces, retry logic for transient AnythingLLM failures, and the manager-uploaded-doc chat embed path (managers don't use chat in v1).

## Mobile context (unchanged by this spec)

The HealthAtlas mobile fixes from F1–F7 are already on `HealthAtlas/vignesh-changes`. After these backend changes land and deploy to Cloud Run, the mobile QA flow that previously surfaced empty Files + non-knowing chat should produce a populated Files tab and a chat that returns real answers within ~30 seconds of upload completion. No mobile changes required for either fix.

## Workstream BE1 — Files tab fix

### Problem

`GET /api/v1/documents` returns `{ data: [], hasNextPage: false }` for users who have successfully uploaded documents via `/api/v1/documents/upload`. The docs exist in the database (At-A-Glance shows their extracted entities) but the list endpoint never returns them.

Root cause is in `DocumentAccessDomainService.listDocuments` (at `src/document-processing/domain/services/document-access.domain.service.ts:120`):

```ts
// Get document IDs from grants
const documentIdsFromGrants = grants.map((grant) => grant.documentId);
let allDocumentIds = [...documentIdsFromGrants];

if (actor.type === 'manager') {
  // ... include origin-manager docs ...
}
```

The service only includes:
- Documents the actor has explicit access grants for
- Documents where the actor is the origin manager (only if `actor.type === 'manager'`)

User-uploaded docs are created with `temporaryManagerId = actor.id` and `originManagerId = undefined` (per `document-processing.domain.service.ts:174-182`). The list query never checks `temporaryManagerId` for the `actor.type === 'user'` case.

`canPerformOperation` in the same file (lines 247-252) DOES treat `temporaryManagerId === actor.id` as full ownership for view/download/delete/trigger-ocr. So the per-doc access model already considers temporary managers; only the list-by-actor query was missed.

### Fix

Three layered changes:

**1. New repository port method**

`src/document-processing/domain/repositories/document.repository.port.ts` adds:

```ts
findByTemporaryManagerId(userId: number | string): Promise<Document[]>;
```

**2. TypeORM repository implementation**

`src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts` implements via:

```ts
async findByTemporaryManagerId(userId: number | string): Promise<Document[]> {
  const entities = await this.repository.find({
    where: { temporaryManagerId: Number(userId) },
    order: { uploadedAt: 'DESC' },
  });
  return entities.map((e) => this.mapper.toDomain(e));
}
```

Exact field name + mapper method validated against the existing entity at implementation time. The `Number()` coercion handles JWT user IDs that arrive as strings.

**3. Add the user branch in `listDocuments`**

In `DocumentAccessDomainService.listDocuments` (after step 4, "If actor is a manager, also get documents where they are origin manager"):

```ts
if (actor.type === 'user') {
  // User-uploaded docs are owned by the user as the temporary manager
  // (set in document-processing.domain.service.ts at upload time).
  // canPerformOperation already treats temporaryManagerId === actor.id
  // as full ownership; the list query needs to surface them too.
  const temporaryManagerDocuments =
    await this.documentRepository.findByTemporaryManagerId(actor.id);
  const temporaryManagerDocIds = temporaryManagerDocuments.map((doc) => doc.id);
  allDocumentIds = [...new Set([...allDocumentIds, ...temporaryManagerDocIds])];
}
```

### Tests

In `src/document-processing/document-processing.service.spec.ts` (or a sibling spec for the access domain service if it exists; create one if not):

| Case | Setup | Expected |
|---|---|---|
| User with one self-uploaded doc | One doc with `temporaryManagerId = userId`, no access grants | List returns 1 |
| User with self-uploaded + granted doc | One doc with `temporaryManagerId = userId`; one different doc with an access grant for the user | List returns 2, deduplicated |
| User with self-uploaded doc AND grant on same doc | Same docId in both temporaryManager and grant tables | List returns 1 (dedup via `new Set`) |
| User with no docs and no grants | Empty fixtures | List returns 0 |
| Manager flow unchanged | Manager with origin-manager docs only | List returns origin-manager docs (regression check) |

Mock the new repo method via `findByTemporaryManagerId: jest.fn()` in the test setup. Follow existing fixture-building patterns in the file.

### Out of scope (BE1)

- **Auto-creating an `AccessGrant` for the uploader on user uploads.** Considered as an alternative path. Rejected because it's a heavier write (two rows per upload), requires a backfill for existing docs, and `temporaryManagerId` already exists for exactly this ownership relation.
- **Fixing the stubbed `getDocumentsByOriginManager` at `document-access.domain.service.ts:284`.** It returns an empty array. Pre-existing TODO. Affects manager-flow document listing — out of scope for the mobile-user fix.
- **Pagination changes.** Existing in-memory pagination is preserved.
- **Adding query filters (date range, document type) beyond what's already supported.**

## Workstream BE2 — Chat embed (server-side AnythingLLM push)

### Problem

After a user uploads a document, chat queries that should be answerable from the doc still return "I haven't seen anything about that in your records yet." The doc never reaches the user's AnythingLLM workspace because:

1. Mobile uploads go to `/api/v1/documents/upload` (keystone document processing). That path stores PHI, runs OCR, extracts entities — and populates At-A-Glance. It does NOT push to AnythingLLM.
2. The direct `/api/anythingllm/v1/document/upload` endpoint is policy-blocked for user-role accounts: `anythingllm-policy/service.ts:672` returns `'Users cannot upload documents to AnythingLLM'`. So the mobile app cannot work around the gap by making a second call.

Server-side push from the keystone upload pipeline is the only path that satisfies both the HIPAA policy (users don't directly write to AnythingLLM) and the user expectation (chat sees what they uploaded).

### Fix

Hook into the existing OCR pipeline at the end of `runProcessing` in `DocumentProcessingDomainService` (`src/document-processing/domain/services/document-processing.domain.service.ts`). After OCR transitions the document to `PROCESSED`, fire-and-forget a push to AnythingLLM with the file bytes + Document AI fields.

**1. Module dependencies**

`DocumentProcessingModule` imports:
- `AnythingLLMDocumentModule` (exports `AnythingLLMDocumentService`)
- The module exporting `AnythingLLMWorkspaceProvisioningService`

If either module isn't currently exporting its service, update the module's `exports:` array. Watch for circular dependencies; use `forwardRef` if needed.

**2. Constructor injection in `DocumentProcessingDomainService`**

Add:
- `private readonly anythingLLMDocumentService: AnythingLLMDocumentService`
- `private readonly workspaceProvisioning: AnythingLLMWorkspaceProvisioningService`

`StorageService` is already injected — we use it to re-read the file bytes from GCS since `runProcessing` doesn't hold the buffer.

**3. Hook at the tail of `runProcessing`**

After the existing success-path status transition to `PROCESSED`, kick off the AnythingLLM push without awaiting:

```ts
void this.pushToAnythingLLMWorkspace(savedDocument.id).catch((err: any) => {
  this.logger.error(
    `[CHAT EMBED] Failed for doc ${savedDocument.id}: ${err?.message ?? err}`,
  );
});
```

The exact insertion point is the success branch of `runProcessing`, after the final `updateStatus(..., PROCESSED, ...)` call. Locate at implementation time.

**4. New private method `pushToAnythingLLMWorkspace(documentId: string): Promise<void>`**

```ts
private async pushToAnythingLLMWorkspace(documentId: string): Promise<void> {
  const document = await this.documentRepository.findById(documentId);
  if (!document) {
    this.logger.warn(`[CHAT EMBED] Document ${documentId} not found at push time`);
    return;
  }

  // Resolve uploader's user ID. For user-uploaded docs, temporaryManagerId
  // is the uploading user's ID. For manager-uploaded docs with intake context,
  // originUserContextId is the user the doc is for. Skip if neither is set
  // (managers chatting about their own intake is out of scope for v1).
  const actorUserId =
    document.temporaryManagerId ?? document.originUserContextId ?? null;
  if (!actorUserId) {
    this.logger.log(
      `[CHAT EMBED] Skipping doc ${documentId} — no user context for workspace`,
    );
    return;
  }

  const workspaceSlug = await this.workspaceProvisioning.getWorkspaceSlug(
    String(actorUserId),
  );
  if (!workspaceSlug) {
    this.logger.warn(
      `[CHAT EMBED] No workspace for user ${actorUserId} (doc ${documentId})`,
    );
    return;
  }

  // Re-read file from GCS. StorageService method name confirmed at impl time.
  const fileBuffer = await this.storageService.readRaw(document.rawFileUri);

  // Build documentFields JSON from Document AI output if available.
  // The exact field name on the Document entity is confirmed at impl time
  // (likely `documentAiOutput` or `extractedFields`). If absent, skip the
  // field — raw upload still works, just lower-quality RAG.
  const documentFieldsJson = this.buildDocumentFieldsJson(document);

  await this.anythingLLMDocumentService.uploadDocument(
    fileBuffer,
    document.fileName,
    workspaceSlug,
    documentFieldsJson, // undefined if no fields available
  );

  this.logger.log(
    `[CHAT EMBED] Pushed doc ${documentId} to workspace ${workspaceSlug}`,
  );
}
```

**5. `buildDocumentFieldsJson` helper**

Reads the persisted Document AI output off the `Document` entity (field name verified at impl time) and converts to the JSON string shape `AnythingLLMDocumentService.uploadDocument` expects:

```ts
'{"entities":[{"type":"...","mentionText":"...","confidence":0.9,...}],"fullResponse":{...}}'
```

If no Document AI output is persisted, return `undefined`. The downstream `uploadDocument` call already treats `documentFields` as optional.

**6. HIPAA logging discipline**

Per the existing convention in `anythingllm-document.controller.ts:120`:
> "Never logs file names, file contents, OCR values, workspace names, or paths"

All logs in `pushToAnythingLLMWorkspace` use only `documentId`, `actorUserId` (a numeric ID), and `workspaceSlug` (workspace slugs are non-PHI per existing keystone usage). No file names, no OCR text, no entity values.

Note: the existing `[DOCUMENT UPLOAD]` logs at lines 119-178 do include `documentType` and IDs but NOT file content or names. Same discipline applies here.

### Tests

In `src/document-processing/document-processing.service.spec.ts`:

| Case | Setup | Expected |
|---|---|---|
| Happy path: user upload completes OCR | Doc with `temporaryManagerId = 7`, OCR run succeeds, workspace exists | `anythingLLMDocumentService.uploadDocument` called once with `(buffer, fileName, "workspace-for-user-7", documentFieldsJson)` |
| No workspace mapped | `getWorkspaceSlug` returns null | `uploadDocument` NOT called; OCR result unchanged |
| AnythingLLM upload throws | `anythingLLMDocumentService.uploadDocument` rejects with `new Error('boom')` | Error logged via `logger.error`; OCR result still `PROCESSED` (no rethrow) |
| Manager-uploaded doc with no intake user | `temporaryManagerId = null`, `originUserContextId = null` | Push skipped; logger.log noted |
| Manager-uploaded doc WITH intake user | `temporaryManagerId = null`, `originUserContextId = 9` | Push targets workspace for user 9 |
| Document AI fields available | Doc has Document AI output | `uploadDocument` receives a non-empty `documentFieldsJson` parameter |
| Document AI fields absent | Doc has no Document AI output | `uploadDocument` receives `undefined` for `documentFieldsJson` |

Mock `anythingLLMDocumentService`, `workspaceProvisioning`, and `storageService.readRaw` in the test setup. Follow the existing `OcrService` / `DocumentProcessingDomainService` test patterns in the file.

### Out of scope (BE2)

- **Retry on AnythingLLM failure.** v1 logs the error and moves on. Failed pushes will simply mean chat doesn't see that one doc until the user re-uploads. BullMQ retry could be a Phase II hardening if user complaints surface.
- **Backfill of pre-fix uploads.** Existing docs uploaded before this lands will not be in chat workspaces. We could write a one-off script if a launch-day data audit shows it's needed, but it's not in this spec.
- **Push for manager-uploaded docs without `originUserContextId`.** Managers don't use chat in v1; skipping is intentional.
- **Custom RAG chunking strategy.** We rely on AnythingLLM's default chunker.
- **Updating an existing doc embedding when OCR re-runs (via `triggerOcr`).** v1 always uploads, potentially duplicating in the workspace. Acceptable — re-OCR is rare. Phase II could add idempotency via a `chatWorkspaceEmbeddedAt` marker on the Document entity.
- **Workspace creation if missing.** `getWorkspaceSlug` returns null; we skip. Workspaces are created via existing user-provisioning flows; this hook only consumes existing mappings.

### Known unknowns to verify at implementation time

- **Exact name of the Document AI output field on the `Document` entity.** Likely `documentAiOutput`, `extractedFields`, or `aiExtractedFields`. Grep to confirm.
- **Whether `StorageService` exposes a `readRaw(gcsUri): Promise<Buffer>` method.** If not, add it (mirroring the existing `storeRaw` pattern).
- **`AnythingLLMDocumentService` module export.** If it's registered as a provider but not exported, add to the module's `exports:` array.
- **Circular dependency risk** between `DocumentProcessingModule` and `AnythingLLMDocumentModule`. If `forwardRef` is needed, use it; document the cycle in a code comment.

## Sequencing

BE1 and BE2 are independent. They can land in either order, but BE1 is smaller and unblocks the simpler CEO requirement (Files tab). Sequence:

1. Land BE1 → deploy to Cloud Run → mobile QA confirms Files tab populates.
2. Land BE2 → deploy to Cloud Run → mobile QA confirms chat returns real answers.
3. Resume mobile App Store push (mobile branch unchanged; the bug fixes on `HealthAtlas/vignesh-changes` already account for this server behavior).

## Test plan

### Unit tests (per workstream above)

Run before opening a PR / merging to main:

```bash
cd keystone-core-api
npm run test
npm run test -- document-processing.service.spec
```

Expected: all existing tests pass, all new tests pass.

### Integration QA (manual, post-deploy)

Deploy to the dev Cloud Run instance, point mobile `.env API_BASE_URL` at it, run mobile on simulator:

1. Sign in as a user account that has uploaded at least one doc previously (e.g., `test9@test.com`). Tap Files tab → previously-uploaded docs appear (BE1).
2. Upload a fresh medical doc on simulator. Wait for At-A-Glance to populate (~30s). Tap Files tab → new doc appears (BE1).
3. Wait additional ~10-30s for OCR to complete + AnythingLLM push. Go to chat. Ask a question whose answer is in the uploaded doc. Expected: real answer cites the doc, not "I haven't seen anything" (BE2).
4. Check Cloud Run logs for `[CHAT EMBED] Pushed doc ...` confirming push happened.

### Regression sanity

- Manager-flow document uploads still appear in Files tab for the manager (existing origin-manager path).
- Manager-flow uploads that include `originUserContextId` for an intake user → chat for that user should see the doc.
- Existing access-grant flows for shared documents still appear in the recipient's Files tab.

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| Files tab still empty after BE1 deploy | `findByTemporaryManagerId` returning empty; check the entity field name + the `Number()` coercion of `actor.id` | Add a log line in the new repo method during impl; verify against DB row directly |
| List endpoint returns 500 | Unhandled repository error | Check Cloud Run logs; ensure the `find({...})` shape matches the TypeORM entity column name (case-sensitive) |
| Chat still doesn't see doc after BE2 deploy + waiting | (a) `getWorkspaceSlug` returns null → user has no workspace; check user-provisioning. (b) `anythingLLMDocumentService.uploadDocument` threw → check logs for `[CHAT EMBED] Failed`. (c) AnythingLLM workspace exists but RAG indexing failed → check AnythingLLM server logs | Per-case recovery; the log lines are the diagnostic entry points |
| AnythingLLM push doubles existing docs in workspace | OCR re-run via `triggerOcr` calls the same pipeline tail | Acceptable for v1 (re-OCR is rare). Phase II: add `chatWorkspaceEmbeddedAt` marker for idempotency |
| Module circular dependency at startup | `DocumentProcessingModule` ↔ `AnythingLLMDocumentModule` | Use `forwardRef(() => OtherModule)` on the import; verify with `npm run start:dev` boot |
| File too large for AnythingLLM upload | AnythingLLM rejects > N MB | Log error; user can retry. Mobile's 10 MB upload limit caps this in practice |

## Rollback

Both changes are code-only with no DB migrations:

- **BE1:** revert the commit; redeploy. Files tab returns to empty for users (pre-fix behavior).
- **BE2:** revert the commit; redeploy. Chat returns to its pre-fix state (no auto-embed of uploads). Already-embedded docs remain in their workspaces — no cleanup needed.

If only one workstream needs rollback, revert just its commit. They don't share files except `document-processing.module.ts` (BE2 only); a partial revert is safe.

## Out of scope (overall)

- **Mobile changes.** All necessary mobile fixes already shipped on `HealthAtlas/vignesh-changes`.
- **HIPAA audit changes.** Existing audit logging already captures upload events; AnythingLLM push events can be added in a follow-up if compliance asks.
- **Frontend QA tooling / synthetic accounts.** Existing `test9@test.com` and demo accounts cover the test matrix.
- **Cloud Run infra changes.** Same deployment, no new env vars, no new GCP resources.
- **Backfill of pre-fix uploads to chat workspaces.** Decided in WS-BE2 scope.
- **Anything in `anything-LayerOne-LLM` directly.** Backend hits the existing AnythingLLM HTTP API; the LLM repo itself is unchanged.
- **Mobile rebuild or App Store re-submission flow.** Both deferred to the original CEO-five-features handoff.
