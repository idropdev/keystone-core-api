---
name: User Self-Management for Documents
overview: Enable users to self-manage documents they upload when no manager is assigned, while preserving the immutable origin-manager model. Users can upload documents without assigned managers, and an endpoint allows permanent manager assignment after upload.
todos:
  - id: migration-nullable-origin-manager
    content: Create database migration to make origin_manager_id nullable in documents table
    status: pending
  - id: update-domain-entity
    content: Update domain Document entity to make originManagerId nullable (number | null)
    status: pending
  - id: update-persistence-entity
    content: Update persistence DocumentEntity to make originManagerId and originManager relation nullable
    status: pending
  - id: verify-mapper-handles-null
    content: Verify document mapper handles null originManagerId correctly in toDomain and toPersistence
    status: pending
    dependencies:
      - update-domain-entity
      - update-persistence-entity
  - id: update-upload-logic-self-management
    content: Update uploadDocument() to allow users without assigned managers (set originManagerId = null)
    status: pending
    dependencies:
      - update-domain-entity
  - id: add-is-origin-manager-helper
    content: Add isOriginManager() helper method in document-access.domain.service.ts to handle self-management authorization
    status: pending
    dependencies:
      - update-domain-entity
  - id: update-access-control-can-perform-operation
    content: Update canPerformOperation() to use isOriginManager() helper for self-managed documents
    status: pending
    dependencies:
      - add-is-origin-manager-helper
  - id: update-access-grant-has-access
    content: Update hasAccess() in access-grant.domain.service.ts to handle null originManagerId for self-managed documents
    status: pending
    dependencies:
      - update-domain-entity
  - id: update-document-listing-self-managed
    content: Update listDocuments() to include self-managed documents (where originManagerId IS NULL and originUserContextId matches)
    status: pending
    dependencies:
      - update-domain-entity
  - id: update-ocr-trigger-self-management
    content: Update triggerOcr() to allow users to trigger OCR on self-managed documents
    status: pending
    dependencies:
      - add-is-origin-manager-helper
  - id: create-assign-manager-dto
    content: Create AssignManagerDto with managerId field and validation decorators
    status: pending
  - id: add-assign-manager-service-method
    content: Add assignManagerToDocument() method in document-processing.domain.service.ts with validation and immutability checks
    status: pending
    dependencies:
      - update-domain-entity
      - create-assign-manager-dto
  - id: add-assign-manager-endpoint
    content: Add POST /v1/documents/:documentId/assign-manager endpoint in controller
    status: pending
    dependencies:
      - add-assign-manager-service-method
      - create-assign-manager-dto
  - id: update-response-dto-nullable
    content: Update DocumentResponseDto to make originManagerId nullable (number | null)
    status: pending
    dependencies:
      - update-domain-entity
  - id: verify-repository-queries-null
    content: Verify repository queries handle null originManagerId correctly, add methods if needed
    status: pending
    dependencies:
      - update-persistence-entity
---

# User Self-Management for Documents

## Overview

Allow users to act as the manager of documents they personally upload **on a per-document basis**, until a manager is explicitly assigned. This reduces onboarding friction while preserving the origin-centered, HIPAA-compliant access model. Self-management is **document-scoped**, not global.

## Key Architectural Changes

1. Make `originManagerId` nullable in the database and domain model
2. When `originManagerId` is `NULL`, the uploading user (identified by `originUserContextId`) acts as the origin manager for that document only
3. Add endpoint to assign a manager to a document (irreversible transfer)
4. Update access control logic to handle self-managed documents (where `originManagerId IS NULL`)
5. Update upload logic to allow users without assigned managers to upload documents

## Implementation Steps

### 1. Database Migration

**File**: `src/database/migrations/[timestamp]-MakeOriginManagerIdNullable.ts`

- Alter `documents.origin_manager_id` column to be nullable
- Update foreign key constraint to allow NULL values
- Add migration class with `up()` and `down()` methods

**Note**: The existing migration `1735000003000-AddOriginManagerToDocuments.ts` created the column as nullable, but the entity has `nullable: false`. This migration ensures consistency.

### 2. Update Domain Entity

**File**: `src/document-processing/domain/entities/document.entity.ts`

- Change `originManagerId: number` to `originManagerId: number | null`
- Update comment to reflect nullable behavior

### 3. Update Persistence Entity

**File**: `src/document-processing/infrastructure/persistence/relational/entities/document.entity.ts`

- Update `@ManyToOne(() => ManagerEntity, { nullable: true })` on `originManager` relation
- Update `@Column({ name: 'origin_manager_id', nullable: true })` on `originManagerId`
- Update comments to reflect nullable behavior and self-management logic

### 4. Update Mapper

**File**: `src/document-processing/infrastructure/persistence/relational/mappers/document.mapper.ts`

- Ensure mapper handles `null` values correctly in both directions (`toDomain` and `toPersistence`)
- No explicit changes needed if TypeORM handles null correctly, but verify

### 5. Update Document Upload Logic

**File**: `src/document-processing/domain/services/document-processing.domain.service.ts`**Method**: `uploadDocument()`**Changes**:

- When `actor.type === 'user'`:
- Remove the requirement for assigned managers
- If user has no assigned managers → set `originManagerId = null`, set `originUserContextId = actor.id`
- If user has assigned managers → use existing logic (first assigned manager)
- When `actor.type === 'manager'`:
- Existing behavior unchanged (always set `originManagerId = manager.id`)
- Update variable type: `let originManagerId: number | null`

### 6. Update Access Control Logic

**File**: `src/document-processing/domain/services/document-access.domain.service.ts`**Method**: `canPerformOperation()`**Changes**:

- Add helper method `isOriginManager(document: Document, actor: Actor): Promise<boolean>`
- If `document.originManagerId === null`:
    - Return `true` if `actor.type === 'user'` AND `document.originUserContextId === actor.id`
- If `document.originManagerId !== null`:
    - Use existing logic (check if actor is manager and `document.originManagerId === manager.id`)
- Update `canPerformOperation()` to use `isOriginManager()` helper
- Update comments to document self-management authorization

**File**: `src/access-control/domain/services/access-grant.domain.service.ts`**Method**: `hasAccess()`**Changes**:

- Update origin manager check to handle `null` case:
- If `document.originManagerId === null` AND `actorType === 'user'` AND `document.originUserContextId === actorId` → return `true`
- Otherwise use existing manager-based logic

### 7. Update Document Listing

**File**: `src/document-processing/domain/services/document-access.domain.service.ts`**Method**: `listDocuments()`**Changes**:

- Add logic to include self-managed documents for users:
- If `actor.type === 'user'`:
    - Query documents where `originManagerId IS NULL` AND `originUserContextId = actor.id`
    - Add these document IDs to `allDocumentIds`
- Update comments to reflect self-management inclusion

### 8. Update OCR Trigger Logic

**File**: `src/document-processing/domain/services/document-processing.domain.service.ts`**Method**: `triggerOcr()`**Changes**:

- Update origin manager check to handle self-management:
- If `document.originManagerId === null`:
    - Allow if `actor.type === 'user'` AND `document.originUserContextId === actor.id`
- If `document.originManagerId !== null`:
    - Use existing manager-based verification logic
- Remove the hard requirement for `actor.type === 'manager'` at the start
- Update error messages and audit logging to handle both cases

### 9. Add Manager Assignment Endpoint

**File**: `src/document-processing/document-processing.controller.ts`**New Method**: `assignManager()`

- Route: `POST /v1/documents/:documentId/assign-manager`
- Requires JWT auth
- Body DTO: `{ managerId: number }`
- Authorization:
- Only self-managing users can assign a manager (`originManagerId IS NULL` AND `originUserContextId === actor.id`)
- Hard deny admins
- Calls new service method to assign manager
- Returns updated document response

**File**: `src/document-processing/domain/services/document-processing.domain.service.ts`**New Method**: `assignManagerToDocument()`

- Validate document exists and has `originManagerId === null`
- Validate actor is the self-managing user (`originUserContextId === actor.id`)
- Validate manager exists and is verified
- Update document: set `originManagerId = managerId` (immutable after this)
- Save document
- Audit log the assignment
- Throw `BadRequestException` if document already has a manager

**File**: `src/document-processing/dto/assign-manager.dto.ts` (NEW)

- Create DTO with `managerId: number`
- Use validation decorators (`@IsNumber()`, `@IsNotEmpty()`)

### 10. Update Response DTOs

**File**: `src/document-processing/dto/document-response.dto.ts`

- Change `originManagerId: number` to `originManagerId: number | null`
- Update `@ApiProperty()` description to indicate nullable behavior

### 11. Update Repository Queries (if needed)

**File**: `src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts`

- Verify queries that filter by `originManagerId` handle `null` correctly
- Add repository method `findByOriginManagerId(managerId: number | null)` if needed for listing
- Add repository method `findSelfManagedByUserId(userId: number)` for user's self-managed documents

### 12. Testing Considerations

- Update existing tests that expect `originManagerId` to always be set
- Add tests for:
- User upload without assigned manager (should succeed with `originManagerId = null`)
- User can view/trigger OCR on self-managed documents
- User cannot view documents they didn't upload (even if `originManagerId IS NULL`)
- Manager assignment endpoint works correctly
- Manager assignment is irreversible (cannot assign twice, cannot remove assignment)

## Critical Rules

1. **Immutability**: `originManagerId` is immutable once set (cannot change from `null` to a value, or from one value to another)
2. **Document-scoped**: Self-management applies per-document, not globally
3. **No manager removal**: Once a manager is assigned, the user permanently loses self-management privileges for that document
4. **Authorization**: Users act as origin managers **only** for documents where:

- `originManagerId IS NULL`
- `originUserContextId === actor.id`
- `actor.type === 'user'`

## Files to Modify

1. `src/database/migrations/[timestamp]-MakeOriginManagerIdNullable.ts` (NEW)
2. `src/document-processing/domain/entities/document.entity.ts`
3. `src/document-processing/infrastructure/persistence/relational/entities/document.entity.ts`
4. `src/document-processing/infrastructure/persistence/relational/mappers/document.mapper.ts`
5. `src/document-processing/domain/services/document-processing.domain.service.ts`
6. `src/document-processing/domain/services/document-access.domain.service.ts`
7. `src/access-control/domain/services/access-grant.domain.service.ts`
8. `src/document-processing/document-processing.controller.ts`