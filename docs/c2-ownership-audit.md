# C2 Task 3 — Document Endpoint Ownership Audit

**Date:** 2026-05-12
**Branch:** vignesh-changes
**Scope:** every per-document route in `src/document-processing/document-processing.controller.ts`
**Auditor:** automated review with manual verification

## Summary

| # | Route | Handler lines | Passes userId? | Ownership enforced? | Gap? |
|---|---|---|---|---|---|
| 1 | GET :documentId/status | 242–253 | Yes (full Actor) | Yes | No |
| 2 | GET :documentId | 278–293 | Yes (full Actor) | Yes | No |
| 3 | GET :documentId/fields | 318–329 | Yes (full Actor) | Yes | No |
| 4 | GET :documentId/download | 368–383 | Yes (full Actor) | Yes | No |
| 5 | DELETE :documentId | 510–521 | Yes (full Actor) | Yes | No |
| 6 | POST :documentId/ocr/trigger | 555–567 | Yes (full Actor) | Yes | No |
| 7 | GET :documentId/vision-ai | 602–613 | Yes (full Actor) | Yes | No |
| 8 | GET :documentId/document-ai | 648–662 | Yes (full Actor) | Yes | No |
| 9 | POST :documentId/assign-manager | 695–711 | Yes (full Actor) | Yes | No |

## Per-route detail

### 1. GET :documentId/status

- **Controller handler lines:** 242–253
- **Service method called:** `documentProcessingService.getDocumentStatus(documentId, actor)`
- **Service method (`document-processing.service.ts` L91–108):**
  Delegates immediately to `this.accessService.getDocument(documentId, actor)`.
- **`DocumentAccessDomainService.getDocument` check (`document-access.domain.service.ts` L75–106):**
  Hard-denies `actor.type === 'admin'`, then fetches the document, then calls
  `accessGrantService.hasAccess(documentId, actor.type, actor.id)`. Throws
  `NotFoundException` (disguised 403) if no grant.
- **Verdict:** enforced

---

### 2. GET :documentId

- **Controller handler lines:** 278–293
- **Service method called:** `documentProcessingService.getDocument(documentId, actor)`
- **Service method (`document-processing.service.ts` L77–79):**
  Direct pass-through to `this.accessService.getDocument(documentId, actor)`.
- **Ownership check:** Same `DocumentAccessDomainService.getDocument` path as route 1.
- **Verdict:** enforced

---

### 3. GET :documentId/fields

- **Controller handler lines:** 318–329
- **Service method called:** `documentProcessingService.getExtractedFields(documentId, actor)`
- **Service method (`document-processing.service.ts` L173–286):**
  First calls `this.accessService.canPerformOperation(documentId, 'view', actor)` and
  throws `ForbiddenException` if false. Then calls `accessService.getDocument(documentId, actor)`
  as a second gate. The `canPerformOperation` check resolves origin/temporary-manager
  identity and falls back to `accessGrantService.hasAccess`.
- **Verdict:** enforced

---

### 4. GET :documentId/download

- **Controller handler lines:** 368–383
- **Service method called:** `documentProcessingService.getDownloadUrl(documentId, actor)`
- **Service method (`document-processing.service.ts` L154–171):**
  Calls `this.accessService.canPerformOperation(documentId, 'download', actor)` and throws
  `ForbiddenException('Access denied to document')` if false. Then calls
  `accessService.getDocument(documentId, actor)` to confirm existence before generating URL.
- **Verdict:** enforced

---

### 5. DELETE :documentId

- **Controller handler lines:** 510–521
- **Service method called:** `documentProcessingService.deleteDocument(documentId, actor)`
- **Service method (`document-processing.service.ts` L126–152):**
  1. Calls `accessService.documentExists(documentId)` — returns 404 if absent (correct ordering).
  2. Calls `accessService.canPerformOperation(documentId, 'delete', actor)` — throws
     `ForbiddenException('Only the origin manager can delete documents')` if false.
  3. The `delete` operation in `canPerformOperation` only returns `true` for
     `isOriginManager || isTemporaryManager` (no grant path).
- **Verdict:** enforced

---

### 6. POST :documentId/ocr/trigger

- **Controller handler lines:** 555–567
- **Service method called:** `documentProcessingService.triggerOcr(documentId, actor)`
- **Service method (`document-processing.service.ts` L327–329):**
  Thin pass-through to `this.domainService.triggerOcr(documentId, actor)`.
- **Domain service (`document-processing.domain.service.ts` L1686–1790):**
  Fetches document, resolves manager identity from `actor.id`, checks
  `document.originManagerId === manager.id` (for manager actors) or
  `document.temporaryManagerId === actor.id` (for user actors). Throws
  `ForbiddenException` with audit log if neither condition holds. Also enforces
  manager verification status (`verificationStatus !== 'verified'` → 403).
- **Note:** This is the only route whose ownership check bypasses
  `DocumentAccessDomainService` entirely and runs in the domain processing service.
  The logic is consistent with the access model and more restrictive (no grant path
  — only origin/temporary manager may trigger OCR).
- **Verdict:** enforced

---

### 7. GET :documentId/vision-ai

- **Controller handler lines:** 602–613
- **Service method called:** `documentProcessingService.getVisionAiOutput(documentId, actor)`
- **Service method (`document-processing.service.ts` L288–304):**
  Calls `this.accessService.canPerformOperation(documentId, 'view', actor)` → throws
  `ForbiddenException` if false. Then calls `accessService.getDocument(documentId, actor)`
  before fetching OCR output.
- **Verdict:** enforced

---

### 8. GET :documentId/document-ai

- **Controller handler lines:** 648–662
- **Service method called:** `documentProcessingService.getDocumentAiOutput(documentId, actor)`
- **Service method (`document-processing.service.ts` L306–322):**
  Identical pattern to route 7: `canPerformOperation('view')` gate, then
  `accessService.getDocument` gate, then `domainService.getDocumentAiOutput`.
- **Verdict:** enforced

---

### 9. POST :documentId/assign-manager

- **Controller handler lines:** 695–711
- **Service method called:** `documentProcessingService.assignManager(documentId, dto.managerId, actor)`
- **Service method (`document-processing.service.ts` L331–357):**
  Delegates to `this.domainService.assignManager(documentId, managerId, actor)`.
- **Domain service (`document-processing.domain.service.ts` L1803–1894):**
  Fetches document, enforces `actor.type === 'user'` (managers may not initiate),
  then checks `document.temporaryManagerId !== actor.id` — throws
  `ForbiddenException` with audit log if the caller is not the temporary manager.
  Also validates the target manager's `verificationStatus === 'verified'`.
- **Verdict:** enforced

---

## Gaps found

All 9 endpoints enforce ownership via the service layer.

## Fixes applied

No code changes were necessary.

## Notes

- Every controller handler converts `req.user` into a typed `Actor` via
  `extractActorFromRequest(req)` before calling any service method. No handler
  passes a raw `userId` string.
- The codebase uses two complementary ownership paths:
  - **`DocumentAccessDomainService`** — used by routes 1–5, 7, 8. Provides
    `getDocument` (grant-based) and `canPerformOperation` (role + grant matrix).
  - **`DocumentProcessingDomainService`** — used by routes 6 (`triggerOcr`) and 9
    (`assignManager`). Enforces tighter ownership (origin/temporary manager only;
    no grant fallback) directly in domain logic.
- `determineOwnershipContext` in `document-processing.service.ts` is used only for
  annotating query result items with an ownership label (`'own' | 'assigned_user' |
  'granted'`). It is not itself an authorization gate.
- Admin actors are rejected at the controller layer (`RoleEnum.admin` check) as a
  first line of defence, and again inside `DocumentAccessDomainService.getDocument`
  and `canPerformOperation` for defence-in-depth.
- The `getDocumentsByOriginManager` helper in `DocumentAccessDomainService` currently
  returns an empty array (see `TODO` comment at line 284). This affects `listDocuments`
  for manager actors (they will only see grant-based documents, not their own
  origin-manager documents). This is a functional gap in listing, not an ownership
  enforcement gap, and is out of scope for this audit.
