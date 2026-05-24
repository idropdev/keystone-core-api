# OCR Auto-Trigger on Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the OCR trigger into a two-phase `kickoffProcessing` + `runProcessing` pair, then wire it into `uploadDocument` so OCR auto-starts on every upload with a true sync-rollback path on kickoff failure.

**Architecture:** Split today's private `startProcessing` into a synchronous `kickoffProcessing(documentId)` (validates state, transitions to PROCESSING) and an async fire-and-forget `runProcessing(args, fileBuffer?)` (the OCR pipeline). `uploadDocument` awaits the kickoff and calls a new `rollbackUpload` helper on failure (delete doc + GCS file). `triggerOcr` uses the same symmetric pattern and picks up a side-benefit fix where today's `.catch()` silently swallows sync kickoff failures.

**Tech Stack:** NestJS · TypeScript · Jest · existing `DocumentRepositoryPort.hardDelete` + `StorageServicePort.delete`. No new dependencies.

**Spec:** [`../specs/2026-05-24-ocr-auto-trigger-on-upload-design.md`](../specs/2026-05-24-ocr-auto-trigger-on-upload-design.md)

---

## File map

**Modify:**
- `src/document-processing/domain/services/document-processing.domain.service.ts` — split `startProcessing`, add `kickoffProcessing` + `rollbackUpload`, wire into `uploadDocument` + `triggerOcr`
- `src/document-processing/document-processing.service.spec.ts` — add `kickoffProcessing` unit tests, `triggerOcr` sync-failure test, `uploadDocument` rollback test; update existing `uploadDocument` test to mock the new auto-trigger calls

**No new files.** Everything lives inside the existing domain service. The `DocumentForProcessing` DTO is a private interface defined at the top of that file.

---

## Task 1: Refactor — split `startProcessing` + migrate `triggerOcr` (no end-user behavior change)

This task introduces `kickoffProcessing` and `runProcessing` and switches `triggerOcr` to the new pair. End-user behavior on `triggerOcr` is identical EXCEPT sync kickoff failures (state-machine rejection, DB write failure) now propagate as proper exceptions instead of being swallowed by `.catch()` and returning a misleading 202. `uploadDocument` is not touched in this task — that's Task 3.

**Files:**
- Modify: `src/document-processing/domain/services/document-processing.domain.service.ts`
- Modify: `src/document-processing/document-processing.service.spec.ts`

- [ ] **Step 1: Write failing unit tests for `kickoffProcessing`**

Open `src/document-processing/document-processing.service.spec.ts`. Inside the existing top-level `describe('DocumentProcessingDomainService', ...)`, add a new nested describe block after the existing `describe('uploadDocument', ...)`:

```ts
  describe('kickoffProcessing', () => {
    const docId = 'doc-kick-1';

    it('should validate state, set PROCESSING, and return the processing args', async () => {
      mockRepository.findById.mockResolvedValue({
        id: docId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      } as any);

      // Access the private method via bracket notation — TDD pragmatism
      const args = await (service as any).kickoffProcessing(docId);

      expect(mockRepository.findById).toHaveBeenCalledWith(docId);
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        docId,
        DocumentStatus.PROCESSING,
        expect.objectContaining({ processingStartedAt: expect.any(Date) }),
      );
      expect(args).toEqual({
        documentId: docId,
        gcsUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('should throw NotFoundException when the document does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect((service as any).kickoffProcessing(docId)).rejects.toThrow(
        /not found/i,
      );
      expect(mockRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should propagate state-machine rejection without touching the DB', async () => {
      mockRepository.findById.mockResolvedValue({
        id: docId,
        status: DocumentStatus.PROCESSED,
        rawFileUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      } as any);

      // PROCESSED → PROCESSING is rejected by canProcess === true path,
      // but validateTransition still expects the source to be valid. We
      // bypass the canProcess gate here; what we need is that an invalid
      // transition throws before updateStatus runs.
      jest
        .spyOn(require('../document-processing/domain/state/document-state-machine'), 'DocumentStateMachine', 'get')
        .mockImplementation(() => ({
          validateTransition: () => {
            throw new Error('invalid transition');
          },
        }));

      await expect((service as any).kickoffProcessing(docId)).rejects.toThrow(
        /invalid transition/i,
      );
      expect(mockRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should propagate DB updateStatus failures', async () => {
      mockRepository.findById.mockResolvedValue({
        id: docId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      } as any);
      mockRepository.updateStatus.mockRejectedValue(
        new Error('Cloud SQL connection refused'),
      );

      await expect((service as any).kickoffProcessing(docId)).rejects.toThrow(
        /Cloud SQL connection refused/,
      );
    });
  });
```

Note the `(service as any)` cast — `kickoffProcessing` is a private method. Accessing privates from tests via index/cast is the established pattern in this codebase for TDD against internal methods.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
npx jest src/document-processing/document-processing.service.spec.ts -t 'kickoffProcessing' 2>&1 | tail -25
```

Expected: 4 FAIL with `TypeError: service.kickoffProcessing is not a function` (or similar — the method does not exist yet).

- [ ] **Step 3: Define the `DocumentForProcessing` interface**

In `src/document-processing/domain/services/document-processing.domain.service.ts`, add this interface near the top of the file, right after the existing `enum DocumentEventType { ... }` block (around line 46):

```ts
/**
 * Args returned by kickoffProcessing and consumed by runProcessing.
 * Internal to the domain service; not exported.
 */
interface DocumentForProcessing {
  documentId: string;
  gcsUri: string;
  mimeType: string;
}
```

- [ ] **Step 4: Add the `kickoffProcessing` method**

In the same file, add the new method right above the existing `private async startProcessing(...)` (around line 263, just above the `/** Start OCR processing (async) ... */` JSDoc):

```ts
  /**
   * Phase 1 of OCR processing: synchronous setup.
   *
   * Looks up the document, validates the state transition to PROCESSING,
   * and persists the new status. Returns the args needed by runProcessing.
   * Throws on missing doc, invalid transition, or DB write failure — the
   * caller is responsible for any compensating action (rollback for upload,
   * 4xx response for triggerOcr).
   */
  private async kickoffProcessing(
    documentId: string,
  ): Promise<DocumentForProcessing> {
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    DocumentStateMachine.validateTransition(
      document.status,
      DocumentStatus.PROCESSING,
    );
    await this.documentRepository.updateStatus(
      documentId,
      DocumentStatus.PROCESSING,
      { processingStartedAt: new Date() },
    );
    return {
      documentId,
      gcsUri: document.rawFileUri,
      mimeType: document.mimeType,
    };
  }
```

- [ ] **Step 5: Run kickoffProcessing tests to verify they pass**

```bash
npx jest src/document-processing/document-processing.service.spec.ts -t 'kickoffProcessing' 2>&1 | tail -15
```

Expected: 4 PASS.

Note: the "state-machine rejection" test (Step 1 test 3) uses a `jest.spyOn` on `DocumentStateMachine.validateTransition`. If that mock path doesn't resolve (because the static import is read once at module load), simplify the test to pass a doc with a status that the real state machine rejects for the PROCESSING transition — e.g. `status: DocumentStatus.DELETED` (or any invalid source). If `DocumentStateMachine` accepts every transition that includes `STORED` as source but rejects `DELETED → PROCESSING`, that gives you the same behavioral coverage without spying. Use whichever approach works first — the test's job is to confirm `kickoffProcessing` propagates state-machine errors and skips `updateStatus`.

- [ ] **Step 6: Rename `startProcessing` to `runProcessing` and remove the state-transition lines**

In the same file, find the existing `private async startProcessing(documentId: string, gcsUri: string, mimeType: string, fileBuffer?: Buffer): Promise<void>` method (around line 267-280). The body references `document.pageCount` heavily and `document.userId` once, so we must KEEP the initial `findById` — we only remove the validateTransition + updateStatus, which kickoffProcessing now owns.

Change the signature to take the DTO + add a destructuring line:

```ts
  /**
   * Phase 2 of OCR processing: the async OCR pipeline.
   *
   * Called fire-and-forget by both uploadDocument (after kickoff succeeds)
   * and triggerOcr. Status is already PROCESSING when this runs — kickoff
   * is responsible for that transition. Failures inside this method move
   * the document to FAILED via the existing retry/error path.
   */
  private async runProcessing(
    args: DocumentForProcessing,
    fileBuffer?: Buffer,
  ): Promise<void> {
    const { documentId, gcsUri, mimeType } = args;

    try {
      // Get document (still needed for pageCount, userId, etc.)
      const document = await this.documentRepository.findById(documentId);
      if (!document) throw new Error('Document not found');

      // Audit log
      this.auditService.logAuthEvent({
        userId: document.userId,
        provider: 'document-processing',
        event: DocumentEventType.DOCUMENT_PROCESSING_STARTED as any,
        success: true,
        metadata: { documentId },
      });

      // (the rest of the existing startProcessing body picks up from "// INTELLIGENT PDF ROUTING")
```

Then DELETE these lines from the method body (formerly at the start of the `try` block, between the `findById` and the audit log):

```ts
      // Validate state transition before updating
      DocumentStateMachine.validateTransition(
        document.status,
        DocumentStatus.PROCESSING,
      );

      // Update status to PROCESSING
      await this.documentRepository.updateStatus(
        documentId,
        DocumentStatus.PROCESSING,
        {
          processingStartedAt: new Date(),
        },
      );
```

The remaining body — `// INTELLIGENT PDF ROUTING`, the pdf2json + pdf-parse + Document AI + Vision AI logic, the `extractAndSaveFields` call, status-to-PROCESSED transition, the FAILED retry path, etc. — stays unchanged.

Net result: `runProcessing` does one `findById` (for the OCR pipeline's downstream needs) instead of today's one validateTransition + one updateStatus + one findById. Slightly fewer DB ops than before since kickoffProcessing now owns the validateTransition + updateStatus calls.

- [ ] **Step 7: Update `triggerOcr` to use the new pair**

In the same file, find `async triggerOcr(documentId: string, actor: Actor): Promise<void>` (around line 1453). Locate the existing block (around lines 1522-1537) that reads:

```ts
    // 4. Validate state transition
    DocumentStateMachine.validateTransition(
      document.status,
      DocumentStatus.PROCESSING,
    );

    // 5. Trigger processing (async, don't await)
    this.startProcessing(
      documentId,
      document.rawFileUri,
      document.mimeType,
    ).catch((error) => {
      this.logger.error(
        `Failed to trigger OCR for document ${documentId}: ${error.message}`,
      );
    });
```

Replace with:

```ts
    // 4. Kickoff processing (sync; throws → propagates as 4xx/5xx)
    const processingArgs = await this.kickoffProcessing(documentId);

    // 5. Run the async OCR pipeline (fire-and-forget)
    this.runProcessing(processingArgs).catch((error) => {
      this.logger.error(
        `Failed to run OCR for document ${documentId}: ${error.message}`,
      );
    });
```

Note: the explicit `validateTransition` call in step 4 is removed because `kickoffProcessing` does it internally. The earlier `DocumentStateMachine.canProcess(document.status)` check at line 1515 stays — it's a separate higher-level guard that triggerOcr uses to return a friendly 400 with a custom message before kickoff would also reject.

- [ ] **Step 8: Add a `triggerOcr` test that proves sync failures now propagate**

In `src/document-processing/document-processing.service.spec.ts`, add another nested describe block after the `kickoffProcessing` block from Step 1:

```ts
  describe('triggerOcr', () => {
    const docId = 'doc-trigger-1';
    const userId = 7;
    const actor = { id: userId, type: 'user' } as any;

    beforeEach(() => {
      mockRepository.findById.mockResolvedValue({
        id: docId,
        userId: String(userId),
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/x.pdf',
        mimeType: 'application/pdf',
        temporaryManagerId: userId,
      } as any);
    });

    it('should propagate sync kickoff failures instead of swallowing them', async () => {
      // Make the second findById (inside kickoffProcessing) fail
      mockRepository.findById
        .mockResolvedValueOnce({
          id: docId,
          userId: String(userId),
          status: DocumentStatus.STORED,
          rawFileUri: 'gs://bucket/raw/x.pdf',
          mimeType: 'application/pdf',
          temporaryManagerId: userId,
        } as any)
        .mockResolvedValueOnce(null);

      await expect(service.triggerOcr(docId, actor)).rejects.toThrow(/not found/i);
    });

    it('should call kickoffProcessing then runProcessing on success', async () => {
      const kickoffSpy = jest
        .spyOn(service as any, 'kickoffProcessing')
        .mockResolvedValue({
          documentId: docId,
          gcsUri: 'gs://bucket/raw/x.pdf',
          mimeType: 'application/pdf',
        });
      const runSpy = jest
        .spyOn(service as any, 'runProcessing')
        .mockResolvedValue(undefined);

      await service.triggerOcr(docId, actor);

      expect(kickoffSpy).toHaveBeenCalledWith(docId);
      expect(runSpy).toHaveBeenCalledWith({
        documentId: docId,
        gcsUri: 'gs://bucket/raw/x.pdf',
        mimeType: 'application/pdf',
      });
    });
  });
```

- [ ] **Step 9: Run the full document-processing test suite**

```bash
npx jest src/document-processing/ 2>&1 | tail -15
```

Expected: green. If the pre-existing `uploadDocument` happy-path test fails because `mockRepository.findById` isn't mocked for any new call paths inside `uploadDocument`, hold — `uploadDocument` is NOT modified in this task (Task 3 does that). The existing test should still pass exactly as before since we haven't changed `uploadDocument` yet.

- [ ] **Step 10: Commit**

```bash
git add src/document-processing/domain/services/document-processing.domain.service.ts \
        src/document-processing/document-processing.service.spec.ts
git commit -m "refactor(doc-processing): split startProcessing into kickoff + run phases"
```

---

## Task 2: Add the `rollbackUpload` helper (TDD)

Adds a private helper that undoes the upload side-effects in reverse order. No call site is added in this task — Task 3 wires it into `uploadDocument`.

**Files:**
- Modify: `src/document-processing/domain/services/document-processing.domain.service.ts`
- Modify: `src/document-processing/document-processing.service.spec.ts`

- [ ] **Step 1: Write failing tests for `rollbackUpload`**

Add another nested describe block after `triggerOcr` in the spec file:

```ts
  describe('rollbackUpload', () => {
    const docId = 'doc-rollback-1';
    const gcsUri = 'gs://bucket/raw/foo.pdf';
    const reason = new Error('kickoff failed');

    it('should delete the GCS file, hard-delete the doc, and fire an audit event', async () => {
      mockStorage.delete.mockResolvedValue(undefined);
      mockRepository.hardDelete.mockResolvedValue(undefined);

      await (service as any).rollbackUpload(docId, gcsUri, reason);

      expect(mockStorage.delete).toHaveBeenCalledWith(gcsUri);
      expect(mockRepository.hardDelete).toHaveBeenCalledWith(docId);
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'document-processing',
          success: true,
          metadata: expect.objectContaining({
            documentId: docId,
            reason: 'auto-rollback-after-failed-ocr-kickoff',
          }),
        }),
      );
    });

    it('should still hard-delete the doc when GCS delete fails', async () => {
      mockStorage.delete.mockRejectedValue(new Error('GCS network error'));
      mockRepository.hardDelete.mockResolvedValue(undefined);

      await (service as any).rollbackUpload(docId, gcsUri, reason);

      expect(mockStorage.delete).toHaveBeenCalled();
      expect(mockRepository.hardDelete).toHaveBeenCalledWith(docId);
    });

    it('should not throw even when both cleanup steps fail', async () => {
      mockStorage.delete.mockRejectedValue(new Error('GCS error'));
      mockRepository.hardDelete.mockRejectedValue(new Error('DB error'));

      await expect(
        (service as any).rollbackUpload(docId, gcsUri, reason),
      ).resolves.toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/document-processing/document-processing.service.spec.ts -t 'rollbackUpload' 2>&1 | tail -15
```

Expected: 3 FAIL with `service.rollbackUpload is not a function`.

- [ ] **Step 3: Add the `rollbackUpload` method**

In `document-processing.domain.service.ts`, add this private method right before the existing `private sanitizeError(error: any): string` method (so the new helper sits near the existing error helpers, ~line 2000):

```ts
  /**
   * Undo the side-effects of a partially-completed upload when the
   * post-upload OCR kickoff fails synchronously.
   *
   * Best-effort: each cleanup step is independently guarded so a partial
   * failure (e.g. GCS network blip) does not prevent the next attempt.
   * The caller has already captured the original kickoff error and will
   * surface it to the client; rollback failures are logged but do not
   * propagate.
   */
  private async rollbackUpload(
    documentId: string,
    gcsUri: string,
    reason: Error,
  ): Promise<void> {
    this.logger.warn(
      `[DOCUMENT UPLOAD] Rolling back upload for ${documentId}: ${reason.message}`,
    );

    try {
      await this.storageService.delete(gcsUri);
    } catch (gcsErr: any) {
      this.logger.error(
        `[ROLLBACK] Failed to delete GCS file ${gcsUri}: ${gcsErr?.message ?? gcsErr}`,
      );
    }

    try {
      await this.documentRepository.hardDelete(documentId);
    } catch (dbErr: any) {
      this.logger.error(
        `[ROLLBACK] Failed to hard-delete document ${documentId}: ${dbErr?.message ?? dbErr}`,
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

- [ ] **Step 4: Run rollbackUpload tests to verify they pass**

```bash
npx jest src/document-processing/document-processing.service.spec.ts -t 'rollbackUpload' 2>&1 | tail -10
```

Expected: 3 PASS.

- [ ] **Step 5: Run the full document-processing test suite**

```bash
npx jest src/document-processing/ 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/document-processing/domain/services/document-processing.domain.service.ts \
        src/document-processing/document-processing.service.spec.ts
git commit -m "feat(doc-processing): add rollbackUpload helper for failed OCR kickoff"
```

---

## Task 3: Wire auto-trigger into `uploadDocument` (the behavior change)

Wires `kickoffProcessing` + `runProcessing` into the end of `uploadDocument`, with `rollbackUpload` on sync failure. Removes the "must be manually triggered" log lines. Updates existing tests to mock the new call path; adds a new test for the rollback case.

**Files:**
- Modify: `src/document-processing/domain/services/document-processing.domain.service.ts`
- Modify: `src/document-processing/document-processing.service.spec.ts`

- [ ] **Step 1: Replace the tail of `uploadDocument`**

In `document-processing.domain.service.ts`, find the end of the `uploadDocument` method (around lines 246-257). The current block reads:

```ts
      this.logger.log(
        `Document uploaded: ${savedDocument.id} (actor: ${actor.type}:${actor.id}, originManager: ${originManagerId || 'none'}, temporaryManager: ${temporaryManagerId || 'none'})`,
      );

      // 6. Document is now in STORED state, ready for OCR processing
      // OCR must be manually triggered via POST /v1/documents/:documentId/ocr/trigger
      // This avoids overhead of automatic processing and maintains domain architecture
      this.logger.log(
        `Document ${savedDocument.id} uploaded and stored. OCR processing must be manually triggered by origin manager or temporary manager.`,
      );

      return savedDocument;
    } catch (error) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw error;
    }
  }
```

Replace with:

```ts
      this.logger.log(
        `Document uploaded: ${savedDocument.id} (actor: ${actor.type}:${actor.id}, originManager: ${originManagerId || 'none'}, temporaryManager: ${temporaryManagerId || 'none'})`,
      );

      // 6. Kick off OCR processing (sync part awaited; async pipeline fire-and-forget)
      try {
        const processingArgs = await this.kickoffProcessing(savedDocument.id);
        this.runProcessing(processingArgs, fileBuffer).catch((err: any) => {
          this.logger.error(
            `[DOCUMENT UPLOAD] Async OCR failed for ${savedDocument.id}: ${err?.message ?? err}`,
          );
        });
      } catch (kickoffError: any) {
        await this.rollbackUpload(savedDocument.id, gcsUri, kickoffError);
        throw kickoffError;
      }

      return savedDocument;
    } catch (error) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw error;
    }
  }
```

- [ ] **Step 2: Update the existing `uploadDocument` happy-path test to mock the new auto-trigger path**

The current test (around line 110) doesn't mock `findById` (because today's `uploadDocument` never calls it). After the change, `kickoffProcessing` inside `uploadDocument` will call `findById`. Add the mock and assert the new behavior.

In `src/document-processing/document-processing.service.spec.ts`, modify the first test inside `describe('uploadDocument', ...)`:

```ts
    it('should upload document and trigger processing', async () => {
      const userId = 'user-123';
      const actor = { sub: userId, id: userId, type: 'user' } as any;
      const fileBuffer = Buffer.from('test file content');
      const fileName = 'test.pdf';
      const mimeType = 'application/pdf';
      const documentType = DocumentType.LAB_RESULT;

      mockRepository.save.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.UPLOADED,
        rawFileUri: '',
      } as any);

      mockStorage.storeRaw.mockResolvedValue(
        'gs://bucket/raw/user-123/doc-123_test.pdf',
      );

      // After upload, kickoffProcessing will look up the doc again with STORED status
      mockRepository.findById.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/user-123/doc-123_test.pdf',
        mimeType,
      } as any);

      // Don't let runProcessing actually run — spy it into a noop
      jest
        .spyOn(service as any, 'runProcessing')
        .mockResolvedValue(undefined);

      await service.uploadDocument(
        actor,
        fileBuffer,
        fileName,
        mimeType,
        documentType,
      );

      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockStorage.storeRaw).toHaveBeenCalledWith(
        fileBuffer,
        expect.objectContaining({
          userId,
          fileName,
          mimeType,
        }),
      );
      // First updateStatus: STORED (after GCS upload)
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'doc-123',
        DocumentStatus.STORED,
        expect.objectContaining({
          rawFileUri: expect.stringContaining('gs://'),
        }),
      );
      // Second updateStatus: PROCESSING (from kickoffProcessing)
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'doc-123',
        DocumentStatus.PROCESSING,
        expect.objectContaining({ processingStartedAt: expect.any(Date) }),
      );
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          event: expect.any(String),
          success: true,
        }),
      );
    });
```

- [ ] **Step 3: Update the second existing `uploadDocument` test ("should never log PHI") similarly**

In the same describe block, find the test starting at `it('should never log PHI in audit events', ...)`. Inside its setup, before the `await service.uploadDocument(...)` call, add the same two mocks the happy-path test now has:

```ts
      mockRepository.findById.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/file.pdf',
        mimeType: 'application/pdf',
      } as any);
      jest.spyOn(service as any, 'runProcessing').mockResolvedValue(undefined);
```

(Same intent — kickoff needs `findById`, `runProcessing` is stubbed to a noop.)

- [ ] **Step 4: Add a new test for the rollback path**

Inside `describe('uploadDocument', ...)`, append a third test:

```ts
    it('should roll back upload when kickoffProcessing fails', async () => {
      const userId = 'user-123';
      const actor = { sub: userId, id: userId, type: 'user' } as any;
      const fileBuffer = Buffer.from('test file content');
      const fileName = 'test.pdf';
      const mimeType = 'application/pdf';
      const documentType = DocumentType.LAB_RESULT;
      const gcsUri = 'gs://bucket/raw/user-123/doc-123_test.pdf';

      mockRepository.save.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.UPLOADED,
        rawFileUri: '',
      } as any);
      mockStorage.storeRaw.mockResolvedValue(gcsUri);

      jest
        .spyOn(service as any, 'kickoffProcessing')
        .mockRejectedValue(new Error('Cloud SQL connection refused'));
      mockStorage.delete.mockResolvedValue(undefined);
      mockRepository.hardDelete.mockResolvedValue(undefined);

      await expect(
        service.uploadDocument(
          actor,
          fileBuffer,
          fileName,
          mimeType,
          documentType,
        ),
      ).rejects.toThrow(/Cloud SQL connection refused/);

      expect(mockStorage.delete).toHaveBeenCalledWith(gcsUri);
      expect(mockRepository.hardDelete).toHaveBeenCalledWith('doc-123');
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'DOCUMENT_DELETED',
          metadata: expect.objectContaining({
            documentId: 'doc-123',
            reason: 'auto-rollback-after-failed-ocr-kickoff',
          }),
        }),
      );
    });
```

- [ ] **Step 5: Run document-processing tests**

```bash
npx jest src/document-processing/ 2>&1 | tail -20
```

Expected: green. If a test asserts a specific call count on `mockRepository.updateStatus` (`.toHaveBeenCalledTimes(1)`), it may fail because the count is now 2. Search for that pattern in the existing tests and update the count where appropriate.

- [ ] **Step 6: Run the full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all green (188+ tests).

- [ ] **Step 7: Run lint**

```bash
npm run lint 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/document-processing/domain/services/document-processing.domain.service.ts \
        src/document-processing/document-processing.service.spec.ts
git commit -m "feat(doc-processing): auto-trigger OCR on upload with sync rollback"
```

---

## Task 4 (USER): Deploy + manual QA + close out

GCP setup is unchanged from previous deploys — no new APIs to enable, no new IAM bindings.

- [ ] **Step 1: Submit Cloud Build**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
gcloud builds submit --config=cloudbuild.yaml --project=healthatlas-dev-vp
```

Expected: `STATUS: SUCCESS` after ~2-3 minutes.

- [ ] **Step 2: Roll the image onto Cloud Run**

```bash
gcloud run services update keystone \
  --image=us-central1-docker.pkg.dev/healthatlas-dev-vp/keystone/keystone:latest \
  --region=us-central1 \
  --project=healthatlas-dev-vp
```

Expected: new revision deploys, serving 100% of traffic.

- [ ] **Step 3: Manual QA — happy path**

1. Open the iOS simulator with the HealthAtlas app running (or `flutter run` from `HealthAtlas/`).
2. Log in as `test9@test.com` / `Test@123`.
3. Folder tab → Upload Document → pick any PDF or image.
4. Confirm "Document received. Processing in the background." toast appears.
5. Wait ~60 seconds, refresh at-a-glance.
6. **Expected:** new doc's entities (medications, conditions, allergies, etc.) appear in at-a-glance without any manual `/ocr/trigger` call.

Optionally, watch live: the new doc's status transitions can be checked by querying Cloud SQL:

```bash
/opt/homebrew/share/google-cloud-sdk/bin/cloud-sql-proxy \
  healthatlas-dev-vp:us-central1:keystone-db --port 9490 &
DB_PASS=$(gcloud secrets versions access latest --secret=DATABASE_PASSWORD --project=healthatlas-dev-vp)
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p 9490 -U keystone -d keystone -c \
  "SELECT id, status, processing_started_at, processed_at FROM documents WHERE user_id = 7 ORDER BY uploaded_at DESC LIMIT 3;"
```

Expected: top row's `status` transitions `STORED → PROCESSING` (right after upload) → `PROCESSED` (within ~60s).

- [ ] **Step 4: Manual QA — re-trigger still works**

1. Pick an existing `PROCESSED` doc (e.g. one from previous testing).
2. Get a fresh JWT via Swagger login.
3. Call `POST /api/v1/documents/{id}/ocr/trigger` from Swagger.
4. **Expected:** returns 202; doc status transitions back through `PROCESSING → PROCESSED`; new extracted_fields rows replace the old ones (or merge — depends on existing repository semantics; verify by counting rows before and after).

- [ ] **Step 5: Close out PHASE2A_NOTES.md**

Open `/Users/vigneshponraj/Documents/github/dropdev/PHASE2A_NOTES.md`. Find the Phase I checklist (in the "What's next — external audience + App Store launch" section, around line 444). Replace the "Bake OCR auto-trigger into upload endpoint" bullet with a ✅-prefixed version naming the new Cloud Run revision and pointing at this plan + the spec.

Also re-open Known Issue #9 if it's still phrased as "OCR auto-trigger gap"; replace its body with a "FIXED 2026-05-24" note pointing at the new revision.

- [ ] **Step 6: Push the branch**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git push origin vignesh-changes
```

Expected: clean push (no secret-scanning issues since we don't touch env-example).

- [ ] **Step 7: Optional — re-trigger the 4 stale STORED docs for user 7**

The 4 docs (`9a982bbf`, `abb33c2a`, `999b8224`, `729f5603`) were uploaded under the old behavior and never processed. With auto-trigger live, they're not retroactively processed; trigger them manually if you want them populated:

```bash
BASE="https://keystone-634361481663.us-central1.run.app/api/v1"
TOKEN=$(curl -sS -X POST "$BASE/auth/email/login" -H 'Content-Type: application/json' \
  -d '{"email":"test9@test.com","password":"Test@123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
for ID in 9a982bbf-64a7-41f4-8334-6e3bb9d77141 abb33c2a-c7bc-4709-841d-4a652ee961f8 999b8224-4168-419b-9c17-9a1a7593b7c2 729f5603-09bc-45ba-a3a6-cf90a2a72017; do
  curl -sS -X POST "$BASE/documents/$ID/ocr/trigger" -H "Authorization: Bearer $TOKEN" -w " (HTTP %{http_code})\n"
done
```

Expected: 4× `{"message":"OCR processing triggered successfully"} (HTTP 202)`.

Or skip — they're historical artifacts.
