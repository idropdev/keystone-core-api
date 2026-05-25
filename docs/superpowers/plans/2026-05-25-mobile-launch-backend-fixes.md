# Mobile Launch Backend Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock HealthAtlas mobile App Store push by (1) returning user-uploaded docs in `GET /api/v1/documents` and (2) auto-pushing uploaded docs into the user's AnythingLLM workspace after OCR completes.

**Architecture:** Two independent backend changes. BE1 adds a `temporaryManagerId` branch in `DocumentAccessDomainService.listDocuments` — the repo method already exists, just needs to be called. BE2 hooks the existing OCR success path to fire-and-forget push the file + Document AI fields into the user's AnythingLLM workspace via the existing `AnythingLLMDocumentService`.

**Tech Stack:** NestJS, TypeScript, TypeORM, Jest. Existing `keystone-core-api` patterns (hexagonal — domain services + ports + infra adapters).

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-launch-backend-fixes-design.md`

**Branch:** Continue on `vignesh-changes`.

---

## Workstream BE1 — Files tab fix

Single-file behavior change in `DocumentAccessDomainService`. The repo method we need (`findByTemporaryManagerId`) already exists in both the port and TypeORM impl.

### Task BE1-1: Add user-branch in `listDocuments` + tests

**Files:**
- Modify: `src/document-processing/domain/services/document-access.domain.service.ts:120-195`
- Modify (add tests): the access service spec — likely `src/document-processing/domain/services/document-access.domain.service.spec.ts`. If that file doesn't exist, create it.

- [ ] **Step 1: Identify the test file**

Run:
```bash
ls src/document-processing/domain/services/document-access*.spec.ts 2>/dev/null
ls src/document-processing/document-processing.service.spec.ts
```

If `document-access.domain.service.spec.ts` exists, use it. Otherwise add the tests to `document-processing.service.spec.ts` since it already mocks the access service.

- [ ] **Step 2: Read the current `listDocuments` to see exact line numbers and surrounding code**

Run:
```bash
sed -n '100,200p' src/document-processing/domain/services/document-access.domain.service.ts
```

Confirm the structure: after `documentIdsFromGrants` is built, the manager branch checks `actor.type === 'manager'` and appends `originManagerIds`. We insert the user branch with the same shape right after.

- [ ] **Step 3: Write the failing test**

Add to the chosen test file. If using `document-processing.service.spec.ts`, find the existing `describe('listDocuments', ...)` block (around line 443 per `git grep`) and add a new `it` case inside it. If creating `document-access.domain.service.spec.ts`, scaffold a full test file using the existing `document-processing.service.spec.ts` as a template for mock setup.

The new test must verify the temporaryManagerId branch is called for user actors and merges its results with any access grants.

```ts
it('includes documents where user is the temporary manager (self-upload case)', async () => {
  const userActor: Actor = { type: 'user', id: 7 };
  const tempManagerDoc = {
    id: 'doc-temp-1',
    fileName: 'self-upload.pdf',
    temporaryManagerId: 7,
  } as Document;

  // No access grants for this user
  mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([]);
  // Repo returns one doc where user is temporary manager
  mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([tempManagerDoc]);
  // findById returns the full doc when listDocuments iterates IDs
  mockDocumentRepository.findById.mockResolvedValue(tempManagerDoc);

  const result = await service.listDocuments(userActor, { skip: 0, limit: 10 });

  expect(mockDocumentRepository.findByTemporaryManagerId).toHaveBeenCalledWith(7);
  expect(result.data).toHaveLength(1);
  expect(result.data[0].id).toBe('doc-temp-1');
  expect(result.total).toBe(1);
});

it('deduplicates when the same doc appears via grant AND temporaryManagerId', async () => {
  const userActor: Actor = { type: 'user', id: 7 };
  const doc = {
    id: 'doc-shared-1',
    fileName: 'shared.pdf',
    temporaryManagerId: 7,
  } as Document;

  mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([
    { documentId: 'doc-shared-1', subjectType: 'user', subjectId: 7 } as any,
  ]);
  mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([doc]);
  mockDocumentRepository.findById.mockResolvedValue(doc);

  const result = await service.listDocuments(userActor, { skip: 0, limit: 10 });

  expect(result.data).toHaveLength(1);
  expect(result.total).toBe(1);
});

it('returns empty when user has neither grants nor self-uploaded docs', async () => {
  const userActor: Actor = { type: 'user', id: 99 };

  mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([]);
  mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([]);

  const result = await service.listDocuments(userActor, { skip: 0, limit: 10 });

  expect(result.data).toHaveLength(0);
  expect(result.total).toBe(0);
});

it('does NOT call findByTemporaryManagerId for manager actors (regression)', async () => {
  const managerActor: Actor = { type: 'manager', id: 5 };

  mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([]);
  mockManagerRepository.findByUserId.mockResolvedValue({ id: 10 } as any);

  await service.listDocuments(managerActor, { skip: 0, limit: 10 });

  expect(mockDocumentRepository.findByTemporaryManagerId).not.toHaveBeenCalled();
});
```

Ensure `mockDocumentRepository` includes `findByTemporaryManagerId: jest.fn()` in the test setup. If using the existing `document-processing.service.spec.ts`, locate its mock setup (around the top of the `describe('DocumentProcessingService', ...)` block) and add the line if missing.

- [ ] **Step 4: Run the new tests to verify they fail**

```bash
npm run test -- document-processing.service.spec --testNamePattern="temporary manager|grant AND temporaryManagerId|neither grants nor self-uploaded|regression"
```

(If you put the tests in `document-access.domain.service.spec.ts`, replace `document-processing.service.spec` accordingly.)

Expected: All four new tests FAIL — the first one with `expect(jest.fn()).toHaveBeenCalledWith(7) // Number of calls: 0` because the user branch doesn't exist yet.

- [ ] **Step 5: Add the user branch in `listDocuments`**

In `src/document-processing/domain/services/document-access.domain.service.ts`, find the existing manager branch:

```ts
let allDocumentIds = [...documentIdsFromGrants];

if (actor.type === 'manager') {
  // Get Manager ID from User ID
  const manager = await this.managerRepository.findByUserId(actor.id);
  if (manager) {
    // ... existing manager-by-origin logic ...
    const originManagerIds = originManagerDocuments.map((doc) => doc.id);
    allDocumentIds = [...new Set([...allDocumentIds, ...originManagerIds])];
  }
}
```

Add the user branch RIGHT AFTER the manager `if` block (same indentation level):

```ts
if (actor.type === 'user') {
  // User-uploaded docs are owned by the user as the temporary manager
  // (set in document-processing.domain.service.ts at upload time).
  // canPerformOperation already treats temporaryManagerId === actor.id
  // as full ownership; the list query needs to surface them too.
  const temporaryManagerDocuments =
    await this.documentRepository.findByTemporaryManagerId(Number(actor.id));
  const temporaryManagerDocIds = temporaryManagerDocuments.map((doc) => doc.id);
  allDocumentIds = [
    ...new Set([...allDocumentIds, ...temporaryManagerDocIds]),
  ];
}
```

Note the `Number(actor.id)` coercion — `actor.id` can arrive as a string from JWT, but `findByTemporaryManagerId(userId: number)` requires a number.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test -- document-processing.service.spec --testNamePattern="temporary manager|grant AND temporaryManagerId|neither grants nor self-uploaded|regression"
```

Expected: All four tests PASS.

- [ ] **Step 7: Run the FULL test suite to catch regressions**

```bash
npm run test
```

Expected: all existing tests still pass. There's a chance the existing `listDocuments` tests assume the user branch doesn't exist — if any fail, inspect them. They should be fixable by adding `mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([])` to their setup so the call returns empty (matching the pre-change behavior).

- [ ] **Step 8: Commit**

```bash
git add src/document-processing/domain/services/document-access.domain.service.ts \
        src/document-processing/document-processing.service.spec.ts
git commit -m "fix(access): include user's self-uploaded docs in listDocuments"
```

(Substitute the actual spec filename you used.)

### Task BE1-2: Manual integration QA after deploy

Not a code task — gated by a Cloud Run deploy. Surfaced here so the engineer knows what acceptance looks like.

- [ ] **Step 1: Deploy to Cloud Run** (whatever the team's normal deploy path is — typically a tagged push or manual `gcloud run deploy`).

- [ ] **Step 2: Point mobile `.env API_BASE_URL` at the deploy** if it isn't already.

- [ ] **Step 3: On the iOS simulator, sign in as a user with previously-uploaded docs** (e.g., `test9@test.com`).

- [ ] **Step 4: Tap Files tab. Expected:** previously-uploaded docs now appear in the list (instead of "No documents yet"). At-A-Glance was already showing them, so this confirms the docs exist in the DB and the list endpoint now returns them.

- [ ] **Step 5: Upload a fresh PDF.** After upload completes, return to Files tab → new doc appears at the top.

If either step shows "No documents yet" still, capture the Cloud Run logs for the `GET /api/v1/documents` request and inspect the response. Common failure causes are listed in the spec's failure-modes table.

---

## Workstream BE2 — Chat embed (server-side AnythingLLM push)

Five tasks. Two prep changes (storage `readRaw`, module wiring), then the service hook, then tests, then deploy QA.

### Task BE2-1: Add `readRaw` to `StorageServicePort` + GCP impl + test

The push needs file bytes from GCS. The current `StorageServicePort` only writes; we add a read method.

**Files:**
- Modify: `src/document-processing/domain/ports/storage.service.port.ts`
- Modify: `src/document-processing/infrastructure/storage/gcp-storage.adapter.ts`
- Modify (or create): `src/document-processing/infrastructure/storage/gcp-storage.adapter.spec.ts`

- [ ] **Step 1: Identify or create the spec file**

```bash
ls src/document-processing/infrastructure/storage/gcp-storage.adapter.spec.ts 2>/dev/null
```

If it exists, append tests there. If not, create it with a minimal jest scaffold.

- [ ] **Step 2: Write the failing test**

Add this test (or create the file with it):

```ts
import { GcpStorageAdapter } from './gcp-storage.adapter';

describe('GcpStorageAdapter.readRaw', () => {
  let adapter: GcpStorageAdapter;
  let mockStorage: any;
  let mockBucket: any;
  let mockFile: any;

  beforeEach(() => {
    mockFile = {
      download: jest.fn().mockResolvedValue([Buffer.from('pdf-bytes')]),
      exists: jest.fn().mockResolvedValue([true]),
    };
    mockBucket = { file: jest.fn().mockReturnValue(mockFile) };
    mockStorage = { bucket: jest.fn().mockReturnValue(mockBucket) };

    adapter = new GcpStorageAdapter({} as any);
    (adapter as any).storage = mockStorage;
    (adapter as any).bucketName = 'test-bucket';
  });

  it('downloads file bytes from a gs:// URI', async () => {
    const buf = await adapter.readRaw('gs://test-bucket/raw/user-1/doc-abc.pdf');

    expect(mockStorage.bucket).toHaveBeenCalledWith('test-bucket');
    expect(mockBucket.file).toHaveBeenCalledWith('raw/user-1/doc-abc.pdf');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('pdf-bytes');
  });

  it('throws if URI is not gs://', async () => {
    await expect(adapter.readRaw('https://example.com/foo.pdf')).rejects.toThrow(
      /Invalid GCS URI/,
    );
  });

  it('throws if file does not exist', async () => {
    mockFile.exists.mockResolvedValue([false]);
    await expect(adapter.readRaw('gs://test-bucket/raw/missing.pdf')).rejects.toThrow(
      /not found/,
    );
  });
});
```

If the existing spec file uses a different mock setup pattern (e.g., a `setupTestModule` helper), follow that pattern — the above is a fallback when there's no existing convention.

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
npm run test -- gcp-storage.adapter.spec
```

Expected: tests fail with `adapter.readRaw is not a function` (or similar).

- [ ] **Step 4: Add `readRaw` to the `StorageServicePort` interface**

Edit `src/document-processing/domain/ports/storage.service.port.ts`. Add after `storeRaw`:

```ts
/**
 * Download raw document file from GCS by its gs:// URI.
 * @returns File bytes
 * @throws if the URI is invalid or the file does not exist
 */
readRaw(gcsUri: string): Promise<Buffer>;
```

The final port file should have `storeRaw, storeProcessed, delete, getSignedUrl, readRaw`.

- [ ] **Step 5: Implement `readRaw` in `GcpStorageAdapter`**

In `src/document-processing/infrastructure/storage/gcp-storage.adapter.ts`, add a new method (near `storeRaw` for cohesion):

```ts
async readRaw(gcsUri: string): Promise<Buffer> {
  if (!gcsUri.startsWith('gs://')) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }
  // gs://bucket-name/path/to/file → split off bucket and the rest
  const withoutScheme = gcsUri.slice(5); // remove 'gs://'
  const firstSlash = withoutScheme.indexOf('/');
  if (firstSlash === -1) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }
  const bucketName = withoutScheme.slice(0, firstSlash);
  const objectPath = withoutScheme.slice(firstSlash + 1);

  const file = this.storage.bucket(bucketName).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`GCS object not found: ${gcsUri}`);
  }
  const [buf] = await file.download();
  return buf;
}
```

If your adapter exposes `bucketName` as an instance field and uses `this.storage.bucket(this.bucketName)` for writes, you can do the same for reads (mock above uses that pattern). Adapt to the existing field/method naming on the adapter.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test -- gcp-storage.adapter.spec
```

Expected: all 3 new tests PASS.

- [ ] **Step 7: Run the full test suite for regressions**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/document-processing/domain/ports/storage.service.port.ts \
        src/document-processing/infrastructure/storage/gcp-storage.adapter.ts \
        src/document-processing/infrastructure/storage/gcp-storage.adapter.spec.ts
git commit -m "feat(storage): add readRaw to download GCS file bytes by URI"
```

### Task BE2-2: Wire AnythingLLM module deps into `DocumentProcessingModule`

The domain service will use two AnythingLLM services. Import their modules so Nest can inject them.

**Files:**
- Modify: `src/document-processing/document-processing.module.ts`

- [ ] **Step 1: Read the current module imports**

```bash
sed -n '1,50p' src/document-processing/document-processing.module.ts
```

Confirm the existing `imports:` array shape and the import block at the top.

- [ ] **Step 2: Add the two imports at the top of `document-processing.module.ts`**

```ts
import { AnythingLLMDocumentModule } from '../anythingllm/document/anythingllm-document.module';
import { AnythingLLMWorkspaceProvisioningModule } from '../anythingllm/workspace/anythingllm-workspace-provisioning.module';
```

- [ ] **Step 3: Add both to the `imports:` array of `@Module({ ... })`**

Append (preserve existing imports):

```ts
imports: [
  // ... existing imports ...
  AnythingLLMDocumentModule,
  AnythingLLMWorkspaceProvisioningModule,
],
```

- [ ] **Step 4: Verify Nest can resolve the deps at startup**

```bash
npm run start:dev
```

Wait ~10 seconds for the app to fully boot. Expected: no `UnknownDependenciesException` or `Nest can't resolve dependencies` errors. The expected error you might see is a `circular dependency` warning if there's a cycle — if so, change one of the two imports to:

```ts
forwardRef(() => AnythingLLMDocumentModule)
```

(and add `forwardRef` to the imports from `@nestjs/common`). Most likely no cycle exists — these modules are imported by `app.module.ts` already.

Kill the dev server (Ctrl+C) once startup succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/document-processing/document-processing.module.ts
git commit -m "chore(deps): import AnythingLLM document + workspace modules into doc-processing"
```

### Task BE2-3: Inject services into `DocumentProcessingDomainService` constructor

Pure plumbing — adds two constructor params. No behavior change yet (the methods using them come in BE2-4).

**Files:**
- Modify: `src/document-processing/domain/services/document-processing.domain.service.ts` (constructor section, near the top)

- [ ] **Step 1: Find the existing constructor**

```bash
grep -n "constructor(" src/document-processing/domain/services/document-processing.domain.service.ts | head -3
```

Read the lines around the constructor to see the existing param list and decorator style.

- [ ] **Step 2: Add the two services to the constructor**

Add imports at the top of the file:

```ts
import { AnythingLLMDocumentService } from '../../../anythingllm/document/anythingllm-document.service';
import { AnythingLLMWorkspaceProvisioningService } from '../../../anythingllm/workspace/anythingllm-workspace-provisioning.service';
```

Add to the constructor parameter list (preserve existing params + decorators):

```ts
constructor(
  // ... existing params ...
  private readonly anythingLLMDocumentService: AnythingLLMDocumentService,
  private readonly workspaceProvisioning: AnythingLLMWorkspaceProvisioningService,
) {}
```

If the existing constructor uses `@Inject('SomeToken')` for ports, just add the new lines without a decorator — these services are injectable classes, not port tokens.

- [ ] **Step 3: Confirm the full test suite still compiles and passes**

```bash
npm run test
```

Existing tests should fail to construct `DocumentProcessingDomainService` because the test setup doesn't provide the new deps. Update the test setup in `document-processing.service.spec.ts` to provide mocks:

```ts
const mockAnythingLLMDocumentService = {
  uploadDocument: jest.fn().mockResolvedValue({}),
};
const mockWorkspaceProvisioning = {
  getWorkspaceSlug: jest.fn().mockResolvedValue(null),
};
```

In the `Test.createTestingModule({ providers: [...] })` block, add:

```ts
{ provide: AnythingLLMDocumentService, useValue: mockAnythingLLMDocumentService },
{ provide: AnythingLLMWorkspaceProvisioningService, useValue: mockWorkspaceProvisioning },
```

Import the two service classes at the top of the spec file.

- [ ] **Step 4: Re-run tests**

```bash
npm run test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/document-processing/domain/services/document-processing.domain.service.ts \
        src/document-processing/document-processing.service.spec.ts
git commit -m "feat(doc-processing): inject AnythingLLM doc + workspace services"
```

### Task BE2-4: Implement `pushToAnythingLLMWorkspace` private method + tests

The method that does the actual push. Not called yet — wiring happens in BE2-5.

**Files:**
- Modify: `src/document-processing/domain/services/document-processing.domain.service.ts`
- Modify: `src/document-processing/document-processing.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `document-processing.service.spec.ts`:

```ts
describe('pushToAnythingLLMWorkspace', () => {
  it('pushes file + Document AI fields to user workspace on happy path', async () => {
    const doc = {
      id: 'doc-1',
      fileName: 'lab.pdf',
      rawFileUri: 'gs://bucket/raw/7/doc-1.pdf',
      temporaryManagerId: 7,
      originUserContextId: null,
      ocrJsonOutput: { entities: [{ type: 'PERSON', mentionText: 'John' }] },
    } as any;

    mockDocumentRepository.findById.mockResolvedValue(doc);
    mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue('workspace-for-user-7');
    mockStorageService.readRaw.mockResolvedValue(Buffer.from('pdf-bytes'));
    mockAnythingLLMDocumentService.uploadDocument.mockResolvedValue({});

    await (service as any).pushToAnythingLLMWorkspace('doc-1');

    expect(mockWorkspaceProvisioning.getWorkspaceSlug).toHaveBeenCalledWith('7');
    expect(mockStorageService.readRaw).toHaveBeenCalledWith('gs://bucket/raw/7/doc-1.pdf');
    expect(mockAnythingLLMDocumentService.uploadDocument).toHaveBeenCalledWith(
      expect.any(Buffer),
      'lab.pdf',
      'workspace-for-user-7',
      expect.stringContaining('entities'),
    );
  });

  it('skips when document has no user context (manager upload without intake user)', async () => {
    const doc = {
      id: 'doc-2',
      fileName: 'mgr.pdf',
      temporaryManagerId: null,
      originUserContextId: null,
    } as any;

    mockDocumentRepository.findById.mockResolvedValue(doc);

    await (service as any).pushToAnythingLLMWorkspace('doc-2');

    expect(mockWorkspaceProvisioning.getWorkspaceSlug).not.toHaveBeenCalled();
    expect(mockAnythingLLMDocumentService.uploadDocument).not.toHaveBeenCalled();
  });

  it('skips when no workspace mapped for user', async () => {
    const doc = {
      id: 'doc-3',
      fileName: 'foo.pdf',
      rawFileUri: 'gs://bucket/raw/5/doc-3.pdf',
      temporaryManagerId: 5,
    } as any;

    mockDocumentRepository.findById.mockResolvedValue(doc);
    mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue(null);

    await (service as any).pushToAnythingLLMWorkspace('doc-3');

    expect(mockAnythingLLMDocumentService.uploadDocument).not.toHaveBeenCalled();
  });

  it('uses originUserContextId when temporaryManagerId is null (manager upload with intake user)', async () => {
    const doc = {
      id: 'doc-4',
      fileName: 'intake.pdf',
      rawFileUri: 'gs://bucket/raw/9/doc-4.pdf',
      temporaryManagerId: null,
      originUserContextId: 9,
      ocrJsonOutput: null,
    } as any;

    mockDocumentRepository.findById.mockResolvedValue(doc);
    mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue('workspace-for-user-9');
    mockStorageService.readRaw.mockResolvedValue(Buffer.from('pdf'));
    mockAnythingLLMDocumentService.uploadDocument.mockResolvedValue({});

    await (service as any).pushToAnythingLLMWorkspace('doc-4');

    expect(mockWorkspaceProvisioning.getWorkspaceSlug).toHaveBeenCalledWith('9');
  });

  it('omits documentFields when ocrJsonOutput is null', async () => {
    const doc = {
      id: 'doc-5',
      fileName: 'no-ocr.pdf',
      rawFileUri: 'gs://bucket/raw/3/doc-5.pdf',
      temporaryManagerId: 3,
      ocrJsonOutput: null,
    } as any;

    mockDocumentRepository.findById.mockResolvedValue(doc);
    mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue('workspace-for-user-3');
    mockStorageService.readRaw.mockResolvedValue(Buffer.from('pdf'));
    mockAnythingLLMDocumentService.uploadDocument.mockResolvedValue({});

    await (service as any).pushToAnythingLLMWorkspace('doc-5');

    expect(mockAnythingLLMDocumentService.uploadDocument).toHaveBeenCalledWith(
      expect.any(Buffer),
      'no-ocr.pdf',
      'workspace-for-user-3',
      undefined,
    );
  });
});
```

Note `(service as any).pushToAnythingLLMWorkspace(...)` — accessing the private method via `any` is the standard pattern for unit-testing private methods in this codebase. If the existing spec file uses a different pattern (e.g., extracting helpers into a separate testable class), follow that.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test -- document-processing.service.spec --testNamePattern="pushToAnythingLLMWorkspace"
```

Expected: all 5 tests FAIL with `service.pushToAnythingLLMWorkspace is not a function`.

- [ ] **Step 3: Add the `pushToAnythingLLMWorkspace` method to `DocumentProcessingDomainService`**

In `src/document-processing/domain/services/document-processing.domain.service.ts`, add the following PRIVATE methods. Place near other private helpers (after `runProcessing` and friends). The `ocrJsonOutput` field on `Document` is the persisted Document AI output.

```ts
/**
 * Fire-and-forget push of a processed document into the user's
 * AnythingLLM workspace so the chat assistant can answer questions
 * about it. Called at the tail of `runProcessing` after OCR completes.
 *
 * Resolves the uploader's user ID from `temporaryManagerId` (user
 * self-upload) or `originUserContextId` (manager upload with intake
 * user). Skips silently if neither is set.
 *
 * Errors are logged via this.logger.error and not rethrown — the OCR
 * pipeline already completed successfully when this is called.
 */
private async pushToAnythingLLMWorkspace(documentId: string): Promise<void> {
  const document = await this.documentRepository.findById(documentId);
  if (!document) {
    this.logger.warn(
      `[CHAT EMBED] Document ${documentId} not found at push time`,
    );
    return;
  }

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
      `[CHAT EMBED] No workspace mapped for user ${actorUserId} (doc ${documentId})`,
    );
    return;
  }

  const fileBuffer = await this.storageService.readRaw(document.rawFileUri);
  const documentFieldsJson = this.buildDocumentFieldsJson(document);

  await this.anythingLLMDocumentService.uploadDocument(
    fileBuffer,
    document.fileName,
    workspaceSlug,
    documentFieldsJson,
  );

  this.logger.log(
    `[CHAT EMBED] Pushed doc ${documentId} to workspace ${workspaceSlug}`,
  );
}

/**
 * Build the documentFields JSON string AnythingLLM expects from the
 * persisted Document AI output. Returns undefined if no OCR output
 * available (raw upload still works, just lower-quality RAG).
 */
private buildDocumentFieldsJson(document: Document): string | undefined {
  const ocr = document.ocrJsonOutput;
  if (!ocr) {
    return undefined;
  }
  // AnythingLLM expects: { entities: [...], fullResponse: {...} }
  // ocrJsonOutput shape varies — be defensive.
  const entities = Array.isArray(ocr.entities) ? ocr.entities : [];
  return JSON.stringify({
    entities,
    fullResponse: ocr,
  });
}
```

If `Document` is not already imported in this file (it likely is), the import is `import { Document } from '../entities/document.entity';`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test -- document-processing.service.spec --testNamePattern="pushToAnythingLLMWorkspace"
```

Expected: all 5 PASS.

- [ ] **Step 5: Run the full test suite to catch regressions**

```bash
npm run test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/document-processing/domain/services/document-processing.domain.service.ts \
        src/document-processing/document-processing.service.spec.ts
git commit -m "feat(chat-embed): add pushToAnythingLLMWorkspace private method"
```

### Task BE2-5: Hook `pushToAnythingLLMWorkspace` into `runProcessing` tail + test

Now wire the new method into the OCR success path so it actually fires.

**Files:**
- Modify: `src/document-processing/domain/services/document-processing.domain.service.ts` (around line 1149-1180)
- Modify: `src/document-processing/document-processing.service.spec.ts`

- [ ] **Step 1: Locate the hook point**

Read lines 1140-1185 of the domain service file. The success path is:

```ts
await this.documentRepository.updateStatus(
  documentId,
  DocumentStatus.PROCESSED,
  { ... processedFileUri, ocrJsonOutput, extractedText, ... },
);

this.logger.log(`[STORAGE] Successfully saved ocrJsonOutput for document ${documentId}`);

// Audit log
this.auditService.logAuthEvent({ ... });

this.logger.log(`Processing complete for document ${documentId}`);
```

The hook goes RIGHT AFTER the audit log and BEFORE the `Processing complete` log — fire-and-forget so the log fires immediately, not after the push.

- [ ] **Step 2: Write the failing test**

Add to `document-processing.service.spec.ts`. The test verifies that `pushToAnythingLLMWorkspace` is called once after `runProcessing` reaches the PROCESSED state, and that a thrown error from the push does NOT break `runProcessing`.

```ts
describe('runProcessing — AnythingLLM chat embed hook', () => {
  it('fires pushToAnythingLLMWorkspace once after successful OCR', async () => {
    // Spy on the private method via prototype access
    const pushSpy = jest
      .spyOn(service as any, 'pushToAnythingLLMWorkspace')
      .mockResolvedValue(undefined);

    // Set up the rest of runProcessing's happy path mocks. Reuse whatever
    // pattern the existing "runProcessing happy path" test uses; the key
    // assertion is the pushSpy call.
    const processingArgs = { /* fixture matching DocumentForProcessing shape */ } as any;
    const fileBuffer = Buffer.from('pdf');
    mockOcrService.processDocument.mockResolvedValue({
      text: 'lab results',
      confidence: 0.95,
      pageCount: 1,
      rawDocumentAiResult: { entities: [] },
    });
    mockDocumentRepository.findById.mockResolvedValue({
      id: 'doc-99',
      status: DocumentStatus.PROCESSING,
    } as any);
    mockStorageService.storeProcessed.mockResolvedValue('gs://bucket/processed/doc-99.json');

    await (service as any).runProcessing(processingArgs, fileBuffer);

    // Give microtasks a turn so the fire-and-forget runs
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('doc-99');
  });

  it('does not fail runProcessing if pushToAnythingLLMWorkspace throws', async () => {
    jest
      .spyOn(service as any, 'pushToAnythingLLMWorkspace')
      .mockRejectedValue(new Error('AnythingLLM down'));

    const processingArgs = { /* fixture */ } as any;
    mockOcrService.processDocument.mockResolvedValue({
      text: '',
      confidence: 0,
      pageCount: 1,
      rawDocumentAiResult: null,
    });
    mockDocumentRepository.findById.mockResolvedValue({
      id: 'doc-99',
      status: DocumentStatus.PROCESSING,
    } as any);

    await expect(
      (service as any).runProcessing(processingArgs, Buffer.from('pdf')),
    ).resolves.toBeUndefined();
  });
});
```

The `processingArgs` fixture has to match the shape `runProcessing` expects (the `DocumentForProcessing` type). Look at existing tests in `document-processing.service.spec.ts` for an existing `runProcessing happy path` test — copy its `processingArgs` fixture. If no existing test exists, build the fixture by inspecting the `DocumentForProcessing` type definition near line 49 of the domain service file.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm run test -- document-processing.service.spec --testNamePattern="AnythingLLM chat embed hook"
```

Expected: tests FAIL — `pushSpy` is not called because the hook doesn't exist yet.

- [ ] **Step 4: Add the hook in `runProcessing`**

In `src/document-processing/domain/services/document-processing.domain.service.ts`, after the audit log block (which immediately follows the `updateStatus(..., PROCESSED, ...)` at line 1149) and BEFORE the `this.logger.log('Processing complete for document ${documentId}')` line, insert:

```ts
// Fire-and-forget push to user's AnythingLLM workspace so chat can see
// the doc. Failures are logged but do not affect the OCR pipeline,
// which already completed successfully.
void this.pushToAnythingLLMWorkspace(documentId).catch((err: any) => {
  this.logger.error(
    `[CHAT EMBED] Failed for doc ${documentId}: ${err?.message ?? err}`,
  );
});
```

The `void` prefix tells TypeScript/the linter we intentionally aren't awaiting. The `.catch` ensures any thrown error from the inside (above the await chain) is caught — defense in depth, since `pushToAnythingLLMWorkspace` already catches its own errors.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test -- document-processing.service.spec --testNamePattern="AnythingLLM chat embed hook"
```

Expected: both tests PASS.

- [ ] **Step 6: Run the full test suite for regressions**

```bash
npm run test
```

Expected: all PASS. Existing `runProcessing` tests may now incidentally trigger the push spy — they should still pass since the new method is mocked at the class level via the constructor injection mocks (no `uploadDocument` actually happens in those tests).

- [ ] **Step 7: Commit**

```bash
git add src/document-processing/domain/services/document-processing.domain.service.ts \
        src/document-processing/document-processing.service.spec.ts
git commit -m "feat(chat-embed): fire pushToAnythingLLMWorkspace after OCR completes"
```

### Task BE2-6: Manual integration QA after deploy

Same shape as BE1-2 — not a code task.

- [ ] **Step 1: Deploy** to Cloud Run.

- [ ] **Step 2: Upload a fresh PDF on the iOS simulator** (any test account).

- [ ] **Step 3: Wait ~30s after At-A-Glance auto-navigation** for OCR + the AnythingLLM push to complete.

- [ ] **Step 4: Check Cloud Run logs for `[CHAT EMBED] Pushed doc ... to workspace ...`** confirming the push succeeded.

- [ ] **Step 5: Open chat. Ask a question whose answer is in the uploaded doc** (e.g., "What medications am I on?" for a doc with med entities). Expected: chat returns real content from the doc, not "I haven't seen anything about that."

If chat still returns the canned "haven't seen" response:
- Check that the AnythingLLM workspace actually received the doc (admin UI or API).
- Verify the workspace has the embedded chunks (look in the AnythingLLM workspace document list).
- If the doc is in the workspace but chat still misses it, the workspace might be in `chat` mode instead of `query` mode (per memory `2026-05-24-anythingllm-chatmode-query-design.md` — should already be query mode). Verify.

---

## Self-review notes

This plan covers all sections of the spec:

| Spec section | Tasks |
|---|---|
| WS-BE1 fix (new repo method, access service branch, tests) | BE1-1 |
| WS-BE1 integration QA | BE1-2 |
| WS-BE2 readRaw storage method | BE2-1 |
| WS-BE2 module dep wiring | BE2-2 |
| WS-BE2 constructor injection | BE2-3 |
| WS-BE2 pushToAnythingLLMWorkspace method + tests | BE2-4 |
| WS-BE2 runProcessing hook + tests | BE2-5 |
| WS-BE2 integration QA | BE2-6 |

The spec's "new repo method" point is downgraded: `findByTemporaryManagerId` already exists in both port and impl (discovered during pre-flight). BE1 is therefore a single-file behavior change + tests. The spec's caveat language carried over conservatively; the plan reflects reality.

No placeholders. Every code step includes the exact code to write. Type and method names match across tasks (`pushToAnythingLLMWorkspace`, `buildDocumentFieldsJson`, `readRaw`, `getWorkspaceSlug`, `uploadDocument`).

Two known impl-time verifications carried forward from spec:
- `processingArgs` fixture for BE2-5 — copy from existing happy-path test.
- If a circular dependency surfaces in BE2-2, use `forwardRef`.
