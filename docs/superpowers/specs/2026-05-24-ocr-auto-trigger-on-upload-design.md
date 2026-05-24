# OCR Auto-Trigger on Document Upload — Design

**Date:** 2026-05-24
**Status:** Approved design, ready for implementation plan
**Context:** Phase I work item per `dropdev/PHASE2A_NOTES.md`. Companion to the Gemini Entity Extractor (Known Issue #10, FIXED 2026-05-22).

## Problem

Today's upload flow leaves documents at status `STORED` and requires a separate manual call to `POST /api/v1/documents/{id}/ocr/trigger` to begin OCR. The iOS app cannot make that call — there is no UI for it. So in practice, real user uploads from the simulator or TestFlight never trigger OCR. The Gemini entity extractor that just shipped runs only when someone manually pokes Swagger.

A successful upload should automatically kick off OCR processing in the background so that:
- The iOS app's "Document received. Processing in the background." toast is factually accurate.
- At-a-glance populates with extracted entities a minute or so after upload.
- No human-in-the-loop step is required between upload and OCR.

## Decisions (from brainstorming)

- **Failure semantics:** sync kickoff failures roll back the upload entirely (delete the doc record + the GCS file, return an error to the client). Async OCR failures move the doc to `FAILED` status; the upload contract is already honored by then.
- **Manual `/ocr/trigger` endpoint stays.** It is still useful for re-processing `FAILED` docs, re-running extraction after an extractor upgrade, and admin overrides.
- **Approach: two-phase refactor of the current `startProcessing` method** — split it into a synchronous `kickoffProcessing` (validate state, transition to `PROCESSING`) and an async `runProcessing` (the OCR pipeline). Both `uploadDocument` and `triggerOcr` use the same symmetric `await kickoffProcessing(); runProcessing(...).catch(...)` pattern.

### Rejected alternatives

- **Inline fire-and-forget without refactor** — minimal diff, but sync kickoff failures land in `.catch()` and the upload returns success anyway. That contradicts the chosen rollback semantics.
- **Cloud Tasks / Pub-Sub queue** — durable retries across instance restarts, idiomatic for production scale. Beyond Phase I scope; new GCP resources to provision; the in-process `setTimeout` retry already running is acceptable for current load. Revisit in Phase II hardening.

## Architecture

### Component boundary

Two new private methods on `DocumentProcessingDomainService` replace the existing private `startProcessing`. No new files, no new modules, no new dependencies.

### `kickoffProcessing(documentId)` — synchronous, awaitable

```ts
private async kickoffProcessing(documentId: string): Promise<DocumentForProcessing> {
  const document = await this.documentRepository.findById(documentId);
  if (!document) {
    throw new NotFoundException(`Document ${documentId} not found`);
  }
  DocumentStateMachine.validateTransition(document.status, DocumentStatus.PROCESSING);
  await this.documentRepository.updateStatus(documentId, DocumentStatus.PROCESSING);
  return {
    documentId,
    gcsUri: document.rawFileUri,
    mimeType: document.mimeType,
  };
}
```

Returns a `DocumentForProcessing` DTO that the caller passes to `runProcessing`. Throws on:
- Document not found (`NotFoundException`)
- Invalid state transition (e.g. doc is already `PROCESSING` or in a terminal state that disallows re-entry)
- Database write failure

### `runProcessing(args, fileBuffer?)` — async, fire-and-forget

Body is everything in today's `startProcessing` *after* the initial status update. Same OCR pipeline (Document AI, Vision AI when enabled, post-OCR merge), same in-process retry, same audit events, same `extractAndSaveFields` chokepoint into the Gemini extractor.

Called as `this.runProcessing(args, fileBuffer).catch(logErr)` — the caller does not await the result.

### Call sites use the symmetric pattern

Both `uploadDocument` and `triggerOcr` end with the same two lines:

```ts
const processingArgs = await this.kickoffProcessing(documentId);
this.runProcessing(processingArgs, fileBuffer).catch((err) => {
  this.logger.error(`OCR processing failed for ${documentId}: ${err.message}`);
});
```

## `uploadDocument` integration

Today's `uploadDocument` ends with step 5 (audit log `DOCUMENT_UPLOADED`) and a comment instructing the caller to manually trigger OCR. The new tail of the method is:

```ts
// 6. Kick off OCR processing synchronously
try {
  const processingArgs = await this.kickoffProcessing(savedDocument.id);
  this.runProcessing(processingArgs, fileBuffer).catch((err) => {
    this.logger.error(
      `[DOCUMENT UPLOAD] Async OCR failed for ${savedDocument.id}: ${err.message}`,
    );
  });
} catch (kickoffError) {
  await this.rollbackUpload(savedDocument.id, gcsUri, kickoffError);
  throw kickoffError;
}

return savedDocument;
```

The two log lines that said "OCR must be manually triggered" are removed; they are no longer accurate.

### `rollbackUpload` helper

A new private method on `DocumentProcessingDomainService` that undoes steps 2-5 of `uploadDocument` in reverse order.

```ts
private async rollbackUpload(
  documentId: string,
  gcsUri: string,
  reason: Error,
): Promise<void> {
  this.logger.warn(
    `[DOCUMENT UPLOAD] Rolling back upload for ${documentId}: ${reason.message}`,
  );

  // Best-effort cleanup. Each step is independently try/catch'd so a partial
  // failure doesn't prevent the next attempt; orphans (if any) get reaped by
  // the existing scheduled-deletion process later.
  try {
    await this.storageService.delete(gcsUri);
  } catch (gcsErr) {
    this.logger.error(
      `[ROLLBACK] Failed to delete GCS file ${gcsUri}: ${gcsErr.message}`,
    );
  }

  try {
    await this.documentRepository.hardDelete(documentId);
  } catch (dbErr) {
    this.logger.error(
      `[ROLLBACK] Failed to hard-delete document ${documentId}: ${dbErr.message}`,
    );
  }

  this.auditService.logAuthEvent({
    userId: '',
    provider: 'document-processing',
    event: DocumentEventType.DOCUMENT_DELETED as any,
    success: true,
    metadata: {
      documentId,
      reason: 'auto-rollback-after-failed-ocr-kickoff',
      kickoffError: this.sanitizeError(reason),
    },
  });
}
```

GCS delete first (the larger artifact), then DB hard-delete. Failures inside cleanup are logged but do not propagate — the original `kickoffError` is what the caller sees.

### User-facing contract

A `201` response from `POST /api/v1/documents/upload` now means:
- The file is durably in GCS.
- The document record exists in the DB.
- OCR processing has been kicked off; the doc is in `PROCESSING` state.

If any of those three preconditions fails synchronously, the response is a 4xx/5xx and there is no orphan state to clean up later.

## `triggerOcr` migration

`triggerOcr` keeps its auth check (origin manager OR temporary manager), state-precondition check, and audit event. The middle (the `this.startProcessing(...).catch(...)` call) gets the same two-phase rewrite:

```ts
// 4. Kick off processing (NEW: two-phase pattern)
const processingArgs = await this.kickoffProcessing(documentId);
this.runProcessing(processingArgs).catch((err) => {
  this.logger.error(`OCR retrigger failed for ${documentId}: ${err.message}`);
});
```

**Side benefit:** today's `triggerOcr` swallows sync-kickoff failures via the `.catch()` on `startProcessing` and still returns 202. The new pattern propagates sync failures as proper exceptions, so the caller gets an accurate 4xx/5xx instead of a misleading 202 followed by silent log-only failure.

## Audit trail

| Endpoint | Events fired | Notes |
|---|---|---|
| `POST /documents/upload` (success, with auto-trigger) | `DOCUMENT_UPLOADED`, then `DOCUMENT_PROCESSING_STARTED` (the one already inside `runProcessing`) | No "trigger-ocr" audit event — there was no manual trigger |
| `POST /documents/upload` (rollback) | `DOCUMENT_UPLOADED`, then `DOCUMENT_DELETED` with `metadata.reason='auto-rollback-after-failed-ocr-kickoff'` | Paired events tell auditors "upload + immediate rollback" |
| `POST /documents/{id}/ocr/trigger` (manual re-trigger) | `DOCUMENT_PROCESSING_STARTED` with `metadata.operation='trigger-ocr'`, then the inner one from `runProcessing` | Two STARTED events — the outer one signals a human action |

HIPAA-safe logging stays consistent with current code: log document IDs, statuses, error class names — never PHI from file contents.

## Failure modes

| Failure | Source | Behavior |
|---|---|---|
| Document not found in `kickoffProcessing` | DB read returns null | Throws `NotFoundException`. In `uploadDocument` this is unreachable (we just saved the doc); in `triggerOcr` it surfaces as 404. |
| Invalid state transition in `kickoffProcessing` | State machine rejects | Throws. In `uploadDocument` this is unreachable (status is `STORED` by construction). In `triggerOcr` it returns 400. |
| DB status-update fails in `kickoffProcessing` | Cloud SQL connection drop or constraint violation | Throws. `uploadDocument` rolls back. `triggerOcr` returns 5xx. |
| Async OCR throws inside `runProcessing` | Document AI, Vision AI, Gemini, GCS read, etc. | Caught by `.catch()` in caller, logged. In-process retry mechanism (existing) takes over. After retries exhausted, doc moves to `FAILED` status via existing path. Upload response was already returned. |
| `rollbackUpload` step fails | GCS delete or DB hard-delete fails | Logged at error level, next cleanup step still attempted, original `kickoffError` propagates. Any leftover orphan is eventually reaped by the existing `scheduledDeletionAt` cleanup job. |

## Testing

Unit tests added to the existing `document-processing.service.spec.ts`:
- `kickoffProcessing` happy path: doc found, state valid, status updated to `PROCESSING`, DTO returned with correct fields.
- `kickoffProcessing` document-not-found: `findById` returns null → `NotFoundException`.
- `kickoffProcessing` invalid state: state machine throws → propagates.
- `kickoffProcessing` DB update failure: `updateStatus` throws → propagates.
- `uploadDocument` end-to-end happy path: `kickoffProcessing` called once with the new doc ID, `runProcessing` called once, no rollback, returned doc has expected fields.
- `uploadDocument` rollback path: `kickoffProcessing` stubbed to throw → `storageService.delete` called, `documentRepository.hardDelete` called, rollback audit event fired with the expected `reason`, kickoff error propagates out.
- `triggerOcr` happy path: same as today's coverage but asserts the new pair of calls.
- `triggerOcr` sync-kickoff failure: stub `kickoffProcessing` to throw → exception propagates (previously swallowed; this is a behavioral fix).

The `runProcessing` internals do not need new tests — the body is identical to today's `startProcessing` minus the first four lines, which are covered by the existing OCR-pipeline tests and by the Gemini extractor's `extractAndSaveFields` chokepoint coverage.

All 188 existing tests must still pass.

### Manual QA on Cloud Run after deploy

1. Fresh upload from the iOS simulator → confirm the doc reaches `PROCESSED` within ~60 seconds without any manual `/ocr/trigger` call.
2. At-a-glance refresh → confirm Gemini entities appear from the newly-uploaded doc.
3. Negative test (optional): point `DOC_PROCESSING_PROCESSOR_ID` at a nonexistent processor on a throwaway revision → upload → confirm rollback fires, doc record and GCS file are both gone, simulator surfaces a 4xx error.
4. Re-trigger path: take an existing `PROCESSED` doc, call `/ocr/trigger` via Swagger → confirm it still works and still emits the "trigger-ocr" audit event.

## Rollout

1. Deploy via the existing Cloud Build → Cloud Run flow.
2. Optional: re-trigger OCR on the 4 `STORED` docs that exist today for user 7 (`9a982bbf`, `abb33c2a`, `999b8224`, `729f5603`) so they catch up to the new behavior. Or leave as historical artifacts — manual trigger remains available.
3. Run the manual QA scenarios above.
4. Close this Phase I item in `dropdev/PHASE2A_NOTES.md`.

## Out of scope (YAGNI)

- Cloud Tasks / Pub-Sub queue migration (Approach C — Phase II hardening).
- Idempotency tokens / dedupe on the upload endpoint.
- Changing the upload response DTO shape (still returns the `Document` with whatever status it has at return time).
- A new "status polling" endpoint for the iOS app — `GET /documents/{id}/status` already exists.
- Automatic backfill of legacy `STORED` docs that pre-date this change.
- Changes to the Flutter upload screen — the current "Processing in the background" toast remains accurate.
