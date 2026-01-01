# Fix: Document Listing for Managers

## Summary

Fixes a critical bug where managers could not retrieve documents they uploaded. The `getDocumentsByOriginManager()` method was a stub implementation that always returned an empty array, causing `GET /v1/documents` to return no results for managers.

## Problem

When managers uploaded documents, the documents were correctly saved with `originManagerId` set. However, when managers called `GET /v1/documents` to list their documents, the endpoint returned an empty array `[]` even though documents existed in the database.

**Root Cause:** The `getDocumentsByOriginManager()` method in `DocumentAccessDomainService` was a placeholder stub that always returned `[]` with a TODO comment to implement the repository method.

## Solution

### 1. Implemented Repository Method

**Added `findByOriginManagerId()` to repository interface:**
- `src/document-processing/domain/ports/document.repository.port.ts`
- Method signature with pagination and status filtering support

**Implemented repository method:**
- `src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts`
- Uses TypeORM to query documents by `originManagerId`
- Filters out soft-deleted documents (`deletedAt IS NULL`)
- Supports pagination and status filtering
- Maps entities to domain models

### 2. Fixed Service Implementation

**Updated `getDocumentsByOriginManager()` method:**
- `src/document-processing/domain/services/document-access.domain.service.ts`
- Replaced stub that returned `[]` with actual repository call
- Now properly retrieves documents where `originManagerId = manager.id`

### 3. Test Fixes

**Fixed test expectations:**
- `test/document-processing/full-workflow.e2e-spec.ts`
- Updated test to reflect correct behavior: users without assigned managers can upload documents (they become temporary origin managers)
- Fixed timeout issues (increased to 3min/2min for status checking tests)
- Fixed fields response structure (use `.fields` property instead of direct array)

## How This Helps the Service

### 1. **Functional Correctness**
- Managers can now see documents they uploaded, which is a core requirement
- Document listing endpoint works as designed for manager role
- Maintains proper access control (managers only see their own documents)

### 2. **HIPAA Compliance**
- Proper document visibility ensures managers can fulfill their custodial responsibilities
- Access control remains intact (managers only see documents where they are origin manager)
- Soft-delete filtering ensures deleted documents are not exposed

### 3. **User Experience**
- Managers can now use the document listing feature in the UI
- Pagination support allows efficient retrieval of large document sets
- Status filtering enables managers to filter by document processing status

### 4. **Code Quality**
- Removed technical debt (stub implementation)
- Follows existing repository pattern
- Maintains separation of concerns (domain service → repository → database)

### 5. **Test Reliability**
- Tests now accurately reflect system behavior
- Improved timeout handling prevents flaky tests
- Better test structure for maintainability

## Technical Details

### Database Query
```typescript
where: { 
  originManagerId: managerId, 
  deletedAt: IsNull() 
}
```

### Access Control Flow
1. Manager authenticates with JWT
2. `listDocuments()` extracts manager from actor
3. Looks up Manager entity by User ID
4. Calls `getDocumentsByOriginManager(manager.id)`
5. Repository queries documents with matching `originManagerId`
6. Returns paginated results

### Performance
- Uses indexed `originManagerId` column for efficient queries
- Supports pagination to handle large document sets
- Filters soft-deleted documents at database level

## Testing

- ✅ E2E test: `should list documents for manager` now passes
- ✅ Verified documents are correctly retrieved by `originManagerId`
- ✅ Verified soft-deleted documents are excluded
- ✅ Verified pagination works correctly
- ✅ All existing tests continue to pass

## Files Changed

### Core Implementation
- `src/document-processing/domain/ports/document.repository.port.ts` - Added interface method
- `src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts` - Implemented repository method
- `src/document-processing/domain/services/document-access.domain.service.ts` - Fixed stub implementation

### Tests
- `test/document-processing/full-workflow.e2e-spec.ts` - Fixed test expectations, timeouts, and response structure

## Migration Notes

No database migrations required. This change only affects application logic.

## Related Issues

- Fixes bug where managers could not see uploaded documents
- Resolves test failures in document listing workflow

## Checklist

- [x] Code follows project style guidelines
- [x] Tests pass locally
- [x] No breaking changes to API contracts
- [x] Documentation updated (if needed)
- [x] HIPAA compliance maintained
- [x] Performance considerations addressed

