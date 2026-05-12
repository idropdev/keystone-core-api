# C2 — Document Upload Hardening + Ownership Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten document-processing security with three small changes: (1) reject file uploads where the multipart-declared MIME doesn't match the actual file bytes, (2) audit every document GET/DELETE/download endpoint to confirm ownership is enforced uniformly, (3) verify `getDownloadStream(id, userId)` matches Flutter's expected contract.

**Architecture:** Add `file-type` npm package and run a magic-byte check in the Multer file filter (or just after). For the ownership audit, read each endpoint handler's current authorization path against the existing `determineOwnershipContext` service method and document any gaps. The download path is verified by reading the existing service implementation and comparing it to what HealthAtlas Slice 2 will expect.

**Tech Stack:** NestJS 10+, `file-type` npm package (new, MIT-licensed, well-maintained), Jest. No DB migrations.

**Reference spec:** `docs/superpowers/specs/2026-05-05-workstream-c-backend-gaps-design.md` §4.C2.

**Notable C2 corrections to the workstream-C spec:**
- The spec said the existing body limit is 25 MB. It's actually **10 MB** (`fileSize: 10 * 1024 * 1024` in `document-processing.controller.ts:121`). Not changing this in C2 — it's outside scope, but flagging.
- The spec said "audit / add `assertOwnership`". There is no `assertOwnership` helper in the codebase. Ownership is enforced via `determineOwnershipContext` and per-endpoint authorization logic in the service layer. C2.2 verifies each endpoint actually runs through those checks; if not, we add them.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/document-processing/utils/mime-validator.ts` | Wraps `file-type` to verify a `Buffer` matches an expected MIME type from an allow-list |
| `src/document-processing/utils/mime-validator.spec.ts` | Unit tests for the validator |
| `docs/c2-ownership-audit.md` | Audit report for Task 3 — one row per document endpoint with the current ownership-enforcement check |

### Modified files

| Path | Change |
|---|---|
| `package.json` / `package-lock.json` | Add `file-type` dependency |
| `src/document-processing/document-processing.controller.ts` | Call `mime-validator` in the upload handler after Multer accepts the file; reject with 415 on mismatch. Audit/add ownership checks on per-document GET/DELETE/download routes if Task 3 finds gaps |

---

## Task 1: State verification

Research only. No production code. No commit.

- [ ] **Step 1: Confirm the upload route's current file validation shape**

Run: `sed -n '77,170p' src/document-processing/document-processing.controller.ts`

Report exactly:
- The allowed-MIME list in the `fileFilter`
- The size limit
- Whether `BadRequestException` is the rejection type
- Whether the body of the upload handler has any post-Multer file checks

- [ ] **Step 2: List all document endpoints that should enforce ownership**

Run: `grep -nE "^  @(Get|Post|Delete|Patch)\(.*:documentId" src/document-processing/document-processing.controller.ts`

Report each route with its line number. The complete list per the existing controller:
- `GET :documentId/status` (line ~194)
- `GET :documentId` (line ~230)
- `GET :documentId/fields` (line ~270)
- `GET :documentId/download` (line ~306)
- `DELETE :documentId` (line ~462)
- `POST :documentId/ocr/trigger` (line ~498)
- `GET :documentId/vision-ai` (line ~544)
- `GET :documentId/document-ai` (line ~590)
- `POST :documentId/assign-manager` (line ~639)

For each, read the handler body and note: does it pass `req.user.id` (or equivalent) to the service? Does the service enforce ownership via `determineOwnershipContext` or a similar check?

- [ ] **Step 3: Confirm `getDownloadStream` (or equivalent download method) shape**

Run: `grep -nE "getDownloadStream\|getDownloadUrl\|downloadDocument\|generateSignedUrl" src/document-processing/ -r --include="*.ts" | head -10`

Report the actual method name (the controller calls it `getDownloadUrl` per the existing controller line 343) and its signature. Determine whether it returns:
- A presigned URL (the Flutter client follows the redirect)
- A streamable response
- File bytes directly

This is informational only — Slice 2 of workstream B will be wired to whichever shape exists. No code change needed unless the method itself has an ownership gap.

- [ ] **Step 4: Check whether `file-type` is already a dependency**

Run: `grep -E '"file-type"' package.json`

Report whether it's present. If absent, Task 2 adds it.

- [ ] **Step 5: Confirm Jest can stub file streams in tests**

Run: `find test -name "*upload*" -o -name "*document-processing*" 2>/dev/null | head -5`

Identify the e2e test infra patterns we'll mirror in Task 4 for the MIME-mismatch test.

- [ ] **Step 6: Report**

Report findings under these headers (under 400 words total):

```
## C2 Task 1 — State Findings

### Upload route validation (current)
- MIME allow-list: <list>
- Size limit: <bytes>
- Rejection type: <BadRequestException/etc>
- Post-Multer checks: <none/list>

### Document endpoints + ownership pattern
| Route | Handler line | Calls service with userId? | Service enforces ownership? |
| ... | ... | ... | ... |

### Download method
- Method name: <exact>
- Signature: <exact>
- Returns: <presigned URL / stream / bytes>
- Ownership enforcement: <where it happens>

### file-type dependency
- Present?: <yes/no, version>

### E2e test infra for upload
- Existing similar tests: <list>
- Helpers we'll reuse: <list>

### Anything surprising
- <free text>
```

**Do NOT commit.**

---

## Task 2: Add MIME magic-byte sniffing to the upload route (TDD)

**Files created:**
- `src/document-processing/utils/mime-validator.ts`
- `src/document-processing/utils/mime-validator.spec.ts`

**Files modified:**
- `package.json` — add `file-type`
- `package-lock.json` — regenerated
- `src/document-processing/document-processing.controller.ts` — call validator in `uploadDocument` handler

### Step 1: Add `file-type` dependency

Run: `npm install file-type@latest`

The current `file-type` is v18+ and ESM-only. Older versions (v16) are CommonJS-compatible and easier to integrate with NestJS's default CommonJS TypeScript output. **Use `file-type@16.5.4`** for compatibility:

Run: `npm install file-type@16.5.4`

Verify: `grep -A1 '"file-type"' package.json` shows `"file-type": "^16.5.4"`.

### Step 2: Write failing unit test for the validator

Create `src/document-processing/utils/mime-validator.spec.ts`:

```typescript
import { validateFileMime } from './mime-validator';

describe('validateFileMime', () => {
  const ALLOWED = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/gif',
  ];

  it('should accept a PDF buffer with matching Content-Type', async () => {
    // %PDF-1.4 header — minimal valid PDF magic bytes
    const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
    const result = await validateFileMime(buffer, 'application/pdf', ALLOWED);
    expect(result.ok).toBe(true);
    expect(result.detectedMime).toBe('application/pdf');
  });

  it('should accept a JPEG buffer with matching Content-Type', async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = await validateFileMime(buffer, 'image/jpeg', ALLOWED);
    expect(result.ok).toBe(true);
  });

  it('should accept a PNG buffer with matching Content-Type', async () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await validateFileMime(buffer, 'image/png', ALLOWED);
    expect(result.ok).toBe(true);
  });

  it('should reject when declared Content-Type does not match detected', async () => {
    // PNG bytes, but declared as PDF
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await validateFileMime(buffer, 'application/pdf', ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('mismatch');
    expect(result.detectedMime).toBe('image/png');
  });

  it('should reject when detected MIME is not in the allow list', async () => {
    // ZIP magic bytes (PK\x03\x04) — detected but not allowed
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const result = await validateFileMime(buffer, 'application/zip', ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not allowed');
  });

  it('should reject when no MIME could be detected (unknown bytes)', async () => {
    // Random bytes that no detector recognizes
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const result = await validateFileMime(buffer, 'application/pdf', ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('could not be detected');
  });

  it('should reject when buffer is empty', async () => {
    const result = await validateFileMime(Buffer.alloc(0), 'application/pdf', ALLOWED);
    expect(result.ok).toBe(false);
  });
});
```

### Step 3: Run test — confirm failure

Run: `npm test -- --testPathPattern=mime-validator.spec`
Expected: `Cannot find module './mime-validator'`.

### Step 4: Implement `mime-validator.ts`

Create `src/document-processing/utils/mime-validator.ts`:

```typescript
import { fromBuffer } from 'file-type';

export interface MimeValidationResult {
  ok: boolean;
  detectedMime: string | null;
  reason?: string;
}

/**
 * Validate that a file's actual bytes match an expected MIME type from
 * a fixed allow-list.
 *
 * Uses `file-type` to read magic bytes from the start of the buffer. This
 * defends against clients sending a spoofed `Content-Type` header (the
 * multipart-declared MIME, which arrives as `file.mimetype` via Multer).
 *
 * @param buffer - The full file buffer or at least the first ~4KB
 * @param declaredMime - The MIME declared in the multipart Content-Type
 * @param allowed - List of MIME strings we're willing to accept at all
 * @returns Validation result with ok, detectedMime, and reason on failure
 */
export async function validateFileMime(
  buffer: Buffer,
  declaredMime: string,
  allowed: string[],
): Promise<MimeValidationResult> {
  if (buffer.length === 0) {
    return {
      ok: false,
      detectedMime: null,
      reason: 'File is empty',
    };
  }

  const detected = await fromBuffer(buffer);
  if (!detected) {
    return {
      ok: false,
      detectedMime: null,
      reason: 'File MIME type could not be detected from contents',
    };
  }

  if (!allowed.includes(detected.mime)) {
    return {
      ok: false,
      detectedMime: detected.mime,
      reason: `Detected MIME ${detected.mime} is not allowed`,
    };
  }

  if (detected.mime !== declaredMime) {
    return {
      ok: false,
      detectedMime: detected.mime,
      reason: `Declared MIME ${declaredMime} does not match detected ${detected.mime} (mismatch)`,
    };
  }

  return {
    ok: true,
    detectedMime: detected.mime,
  };
}
```

### Step 5: Run test — confirm pass

Run: `npm test -- --testPathPattern=mime-validator.spec`
Expected: All 7 tests pass.

### Step 6: Wire the validator into the upload route

Open `src/document-processing/document-processing.controller.ts`. In the `uploadDocument` handler (around line 148), AFTER the Multer file is accepted but BEFORE the upload is queued for processing, add a magic-byte check.

Find the existing `if (!file) { throw new BadRequestException('File is required'); }` early-return. Right after it (and after the admin-deny check on line ~165), add:

```typescript
// Magic-byte MIME validation — defends against spoofed Content-Type headers.
// The fileFilter already rejected disallowed MIMEs based on the multipart
// header, but headers are client-controlled. This re-validates the actual
// file bytes against the allow-list.
const allowedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/gif',
];
const mimeCheck = await validateFileMime(
  file.buffer,
  file.mimetype,
  allowedMimeTypes,
);
if (!mimeCheck.ok) {
  logger.warn(
    `[UPLOAD DOCUMENT] ❌ MIME mismatch: userId=${req.user?.id}, declared=${file.mimetype}, detected=${mimeCheck.detectedMime ?? 'unknown'}, reason=${mimeCheck.reason}`,
  );
  throw new BadRequestException(
    `File contents do not match declared type. ${mimeCheck.reason}`,
  );
}
```

Add the import at the top of the file:

```typescript
import { validateFileMime } from './utils/mime-validator';
```

Note: the existing fileFilter at line ~125 checks `file.mimetype` (which is the multipart-declared MIME), so disallowed types are already rejected at the Multer layer. The new validator is **defense in depth** — it catches the case where a client declares `application/pdf` and uploads PNG bytes.

The 415 status is more semantically correct than 400 for "unsupported media type," but the existing controller throws `BadRequestException` (400) for upload errors. Stay consistent — use `BadRequestException`. If the codebase has a convention for 415, switch to that. Quick check:

Run: `grep -rn "UnsupportedMediaTypeException\|HttpStatus.UNSUPPORTED_MEDIA_TYPE" src/document-processing/ 2>/dev/null | head -5`

If no matches, stay with `BadRequestException`.

### Step 7: Run lint + tests

Run: `npm run lint -- src/document-processing/`
Expected: no errors.

Run: `npm test`
Expected: ≥ 164 tests passing (the baseline) + 7 new mime-validator tests = ≥ 171.

### Step 8: Boot the app to confirm it starts cleanly

Run: `timeout 20 npm run start:dev 2>&1 | head -30 || true`
Expected: Nest starts. No regressions.

### Step 9: Commit

```bash
git add -- package.json package-lock.json src/document-processing/utils/mime-validator.ts src/document-processing/utils/mime-validator.spec.ts src/document-processing/document-processing.controller.ts
git commit -m "feat(document-processing): add MIME magic-byte validation to upload route"
```

(82 chars.)

---

## Task 3: Ownership audit on document endpoints

Read each per-document endpoint and confirm ownership is enforced. Document findings in `docs/c2-ownership-audit.md`. If gaps are found, fix them in the same commit.

### Step 1: Read each handler in turn

For each route in the list below, read the handler body in `document-processing.controller.ts`:

1. `GET :documentId/status` (~line 194-227)
2. `GET :documentId` (~line 230-269)
3. `GET :documentId/fields` (~line 270-305)
4. `GET :documentId/download` (~line 306-360)
5. `DELETE :documentId` (~line 462-497)
6. `POST :documentId/ocr/trigger` (~line 498-543)
7. `GET :documentId/vision-ai` (~line 544-589)
8. `GET :documentId/document-ai` (~line 590-638)
9. `POST :documentId/assign-manager` (~line 639-end)

For each, identify:
- Does the handler pass `req.user.id` (or equivalent) to the service?
- Does the service-side method enforce ownership? (Check by reading the called service method.)
- If admin and manager bypasses exist, are they explicit (e.g. role-check) and audited?

### Step 2: Write the audit report

Create `docs/c2-ownership-audit.md`:

```markdown
# C2 Task 3 — Document Endpoint Ownership Audit

**Date:** YYYY-MM-DD
**Branch:** vignesh-changes
**Scope:** every per-document route in `document-processing.controller.ts`

## Summary

| Route | Handler lines | Passes userId to service? | Service enforces ownership? | Gap? | Action |
|---|---|---|---|---|---|
| GET :documentId/status | ... | ... | ... | ... | ... |
| GET :documentId | ... | ... | ... | ... | ... |
| GET :documentId/fields | ... | ... | ... | ... | ... |
| GET :documentId/download | ... | ... | ... | ... | ... |
| DELETE :documentId | ... | ... | ... | ... | ... |
| POST :documentId/ocr/trigger | ... | ... | ... | ... | ... |
| GET :documentId/vision-ai | ... | ... | ... | ... | ... |
| GET :documentId/document-ai | ... | ... | ... | ... | ... |
| POST :documentId/assign-manager | ... | ... | ... | ... | ... |

## Per-route detail

### GET :documentId/status
- Handler: ...
- Service method called: ...
- Ownership check location: ...
- Findings: ...

(repeat for each route)

## Gaps found

[List any routes where ownership is NOT enforced. Each row links to the fix.]

## Fixes applied

[If any code changes were needed to close gaps, document them here. Link to commits.]
```

### Step 3: Fix any gaps found

If Step 1 finds a route that doesn't enforce ownership:
- Add the missing check inline (likely calling a method on the service that already exists, or wrapping the service call in an ownership guard)
- Add a unit test for the 403-when-not-owned path

Keep the fix surgical. Do NOT refactor the existing ownership-context machinery (`determineOwnershipContext`) — that's beyond C2 scope.

If NO gaps are found, the audit report is the only deliverable for Task 3.

### Step 4: Lint + tests

Run: `npm run lint -- src/document-processing/`
Run: `npm test`

### Step 5: Commit

If gaps were found and fixed:

```bash
git add -- docs/c2-ownership-audit.md <any code files you changed>
git commit -m "fix(document-processing): close ownership gaps found in C2 audit"
```

If no gaps were found and only the audit report was authored:

```bash
git add -- docs/c2-ownership-audit.md
git commit -m "docs(c2): add document endpoint ownership audit report"
```

(Both under 100 chars.)

---

## Task 4: Final verification + sign-off

No code changes. Verification + small validation that Slice 2 (HealthAtlas mobile) will work against the current download contract.

- [ ] **Step 1: Read the existing `getDownloadUrl` handler and underlying service method**

Run: `sed -n '306,360p' src/document-processing/document-processing.controller.ts`

Identify what the route returns (URL? Stream? Bytes?). Compare to what Slice 2 of workstream B expects per `HealthAtlas/docs/superpowers/specs/2026-05-04-mobile-feature-wiring-design.md` §5: "GET /documents/:id/download returns the file" — Flutter handles both presigned-URL redirects and streamed bytes via Dio.

Report (in a comment in `c2-ownership-audit.md` or a separate `docs/c2-download-contract.md`):
- What the route returns today
- Whether Slice 2 needs any keystone-side change to consume it (e.g. CORS header, Content-Disposition, etc.)

This is informational. No code change unless the contract is broken.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: ≥ 171 tests passing.

- [ ] **Step 3: Lint everything touched**

Run: `npm run lint -- src/document-processing/`

- [ ] **Step 4: Verify no Claude/.claude attribution**

Run: `git log b5600a0..HEAD --pretty=%B | grep -iE "claude|anthropic|co-authored|generated with" || echo "(clean)"`
Expected: `(clean)`.

- [ ] **Step 5: Report C2 ready**

Report:
- Number of commits added
- Final test count
- Whether ownership audit found gaps
- Whether the download contract is acceptable for Slice 2
- Whether C2 is ready to open a PR

---

## Self-Review Notes (for the engineer executing this plan)

- **DRY:** No new abstractions beyond the small `validateFileMime` utility. Don't extract an ownership-helper if the service-level `determineOwnershipContext` is already enforcing things correctly — that's beyond C2 scope.
- **YAGNI:** No new tables, no new auth flows, no presigned-URL machinery. C2 is the small closer for workstream C.
- **TDD:** The validator gets full TDD. The audit task is documentation + possibly small fixes.
- **Branch:** Stay on `vignesh-changes` in keystone-core-api.
- **Pre-staged file discipline:** `M package-lock.json` working-tree change must NOT be staged in any C2 commit other than the one that adds `file-type` (which legitimately regenerates the lockfile).
- **Standing rule:** No commit may reference Claude, Anthropic, `.claude/`, or include a Co-Authored-By trailer.
- **Commitlint:** 100-char header limit. All commit messages in this plan are within the limit.
