# User Self-Management for Documents - Implementation Documentation

**Document Version**: 1.0  
**Date**: December 2025  
**Classification**: Internal - Implementation Documentation  
**Purpose**: Comprehensive documentation of the user self-management feature for documents

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Architecture](#3-architecture)
4. [Database Schema](#4-database-schema)
5. [API Endpoints](#5-api-endpoints)
6. [Authorization Logic](#6-authorization-logic)
7. [Implementation Details](#7-implementation-details)
8. [Migration Guide](#8-migration-guide)

---

## 1. Overview

### 1.1 Feature Description

The user self-management feature allows users to act as their own document manager for documents they personally upload when no manager is assigned. This reduces onboarding friction while maintaining the origin-centered, HIPAA-compliant access model.

### 1.2 Key Behaviors

- **Document-Scoped**: Self-management is determined per document, not globally for the user
- **Conditional**: Users can only self-manage documents they uploaded when they had no assigned manager
- **Immutable**: Once a manager is assigned to a self-managed document, the user permanently loses self-management ability for that document
- **One-Way Transition**: Manager assignment is irreversible - even if the manager is later removed, the document cannot return to self-management

### 1.3 Use Cases

1. **Onboarding**: New users can upload documents immediately without waiting for manager assignment
2. **Temporary Self-Service**: Users can manage their own documents until they're ready to assign a manager
3. **Gradual Onboarding**: Users can upload documents first, then assign managers later when ready

---

## 2. Design Principles

### 2.1 Origin-Centered Custodianship

The system maintains the immutable origin-manager model:
- When `originManagerId` is `null`, the uploading user (identified by `originUserContextId`) is implicitly the origin manager
- When `originManagerId` is set, it cannot be changed back to `null`
- This preserves the single-custodian model while enabling user self-management

### 2.2 Document-Scoped Authorization

Self-management is determined per document:
- Each document's `originManagerId` and `originUserContextId` determine self-management eligibility
- User-level manager assignments are only relevant at upload time
- Once a document is created, its self-management status is independent of user-level assignments

### 2.3 Immutability

- `originManagerId` is set once at document creation and cannot be changed
- Exception: Self-managed documents (`originManagerId = null`) can transition to manager-managed via the assign-manager endpoint
- This transition is one-way and permanent

---

## 3. Architecture

### 3.1 Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Document Upload Flow                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Check User's   │
                    │ Assigned Manager│
                    └─────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
            Has Manager?          No Manager?
                    │                   │
                    ▼                   ▼
         ┌──────────────────┐  ┌──────────────────┐
         │ Set originManager│  │ Set originManager│
         │      Id = mgr.id │  │    Id = null     │
         │ Set originUser   │  │ Set originUser   │
         │  ContextId = uid │  │  ContextId = uid │
         └──────────────────┘  └──────────────────┘
                    │                   │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Create Document│
                    └─────────────────┘
```

### 3.2 Access Control Flow

```
┌─────────────────────────────────────────────────────────────┐
│              Document Access Authorization                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Check Document │
                    │ originManagerId │
                    └─────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
            Is Null?              Not Null?
         (Self-Managed)        (Manager-Managed)
                    │                   │
                    ▼                   ▼
         ┌──────────────────┐  ┌──────────────────┐
         │ Check if actor is│  │ Check if actor is│
         │ originUserContext│  │ origin manager   │
         │      Id match?   │  │    (manager)?    │
         └──────────────────┘  └──────────────────┘
                    │                   │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Grant Access?  │
                    │  (or check      │
                    │   AccessGrant)  │
                    └─────────────────┘
```

---

## 4. Database Schema

### 4.1 Document Table Changes

The `documents` table already supports nullable `origin_manager_id`:

```sql
-- Column definition (already exists in migration 1735000003000)
origin_manager_id INTEGER NULL,
origin_user_context_id INTEGER NULL,

-- Foreign key constraints
FOREIGN KEY (origin_manager_id) REFERENCES manager_instances(id),
FOREIGN KEY (origin_user_context_id) REFERENCES user(id) ON DELETE SET NULL
```

### 4.2 Field Semantics

- **`origin_manager_id` (nullable)**:
  - `NULL`: Document is self-managed by the user identified in `origin_user_context_id`
  - `NOT NULL`: Document is managed by the specified manager (immutable after assignment)

- **`origin_user_context_id` (nullable)**:
  - Stores the ID of the user who uploaded the document
  - Provides intake context but does not imply ownership
  - Used to determine self-management eligibility

### 4.3 Indexes

```sql
-- Index for fast lookups by origin manager
CREATE INDEX IDX_documents_origin_manager_id ON documents(origin_manager_id);

-- Note: origin_user_context_id queries are less frequent, 
-- but could benefit from an index if needed
```

---

## 5. API Endpoints

### 5.1 Upload Document

**Endpoint**: `POST /api/v1/documents/upload`

**Behavior**:
- If user has assigned manager(s): Document uses assigned manager as origin manager
- If user has no assigned manager: Document is self-managed (`originManagerId = null`)

**Request**:
```http
POST /api/v1/documents/upload
Authorization: Bearer <user_token>
Content-Type: multipart/form-data

documentType: LAB_RESULT
file: <pdf_file>
```

**Response** (Self-Managed):
```json
{
  "id": "uuid",
  "originManagerId": null,
  "documentType": "LAB_RESULT",
  "status": "UPLOADED",
  "fileName": "lab-result.pdf",
  ...
}
```

**Response** (Manager-Managed):
```json
{
  "id": "uuid",
  "originManagerId": 123,
  "documentType": "LAB_RESULT",
  "status": "UPLOADED",
  "fileName": "lab-result.pdf",
  ...
}
```

### 5.2 Assign Manager to Self-Managed Document

**Endpoint**: `POST /api/v1/documents/:documentId/assign-manager`

**Description**: One-time, irreversible assignment of a manager to a self-managed document.

**Authorization**: Only the user who uploaded the self-managed document can assign a manager.

**Request**:
```http
POST /api/v1/documents/{documentId}/assign-manager
Authorization: Bearer <user_token>
Content-Type: application/json

{
  "managerId": 123
}
```

**Response**:
```json
{
  "id": "uuid",
  "originManagerId": 123,
  "documentType": "LAB_RESULT",
  "status": "PROCESSED",
  ...
}
```

**Error Responses**:
- `400 Bad Request`: Document already has a manager, or manager is not verified
- `403 Forbidden`: Actor is not the self-managing user
- `404 Not Found`: Document or manager not found

### 5.3 View Document

**Endpoint**: `GET /api/v1/documents/:documentId`

**Authorization**:
- Origin manager (explicit manager or self-managing user)
- Users/managers with access grants

**Behavior**: Self-managing users can view their self-managed documents without explicit grants.

### 5.4 Trigger OCR

**Endpoint**: `POST /api/v1/documents/:documentId/ocr/trigger`

**Authorization**: Only origin manager (explicit manager or self-managing user)

**Behavior**: Self-managing users can trigger OCR on their self-managed documents.

---

## 6. Authorization Logic

### 6.1 Determining Origin Manager

The system uses a helper method `isOriginManager()` to determine if an actor is the origin manager:

```typescript
private async isOriginManager(document: Document, actor: Actor): Promise<boolean> {
  // If document is self-managed (originManagerId is null)
  if (document.originManagerId === null) {
    // A user can self-manage if they are the uploader
    return actor.type === 'user' && document.originUserContextId === actor.id;
  } else {
    // Document is managed by an explicit manager
    if (actor.type === 'manager') {
      const manager = await this.managerRepository.findByUserId(actor.id);
      return manager?.id === document.originManagerId;
    }
  }
  return false;
}
```

### 6.2 Access Control Matrix

| Operation | Self-Managing User | Manager (Origin) | User with Grant | Manager (Secondary) |
|-----------|-------------------|------------------|-----------------|---------------------|
| Upload | ✅ (if no manager) | ✅ | ❌ | ❌ |
| View | ✅ (own docs) | ✅ | ✅ | ✅ (with grant) |
| Download | ✅ (own docs) | ✅ | ✅ | ✅ (with grant) |
| Trigger OCR | ✅ (own docs) | ✅ | ❌ | ❌ |
| Delete | ✅ (own docs) | ✅ | ❌ | ❌ |
| Assign Manager | ✅ (own docs) | ❌ | ❌ | ❌ |
| Create Grant | ❌ | ✅ | ❌ | ❌ |

### 6.3 Operation-Specific Authorization

#### Upload
1. Check if actor is user or manager
2. If user: Check for assigned managers
   - No managers → Self-managed (`originManagerId = null`)
   - Has managers → Use first assigned manager
3. If manager: Use manager as origin manager

#### View/Download
1. Check if actor is origin manager (via `isOriginManager()`)
2. If yes → Grant access
3. If no → Check for access grants
4. If grant exists → Grant access
5. Otherwise → Deny

#### Trigger OCR / Delete
1. Check if actor is origin manager (via `isOriginManager()`)
2. If yes → Allow
3. If no → Deny (no grants allowed)

#### Assign Manager
1. Verify document has `originManagerId === null`
2. Verify actor is user and matches `originUserContextId`
3. Verify manager exists and is verified
4. Update `originManagerId` (one-way transition)

---

## 7. Implementation Details

### 7.1 Domain Service Changes

#### DocumentProcessingDomainService

**`uploadDocument()`**:
- Checks `userManagerAssignmentService.getAssignedManagerIds()`
- Sets `originManagerId = null` if no managers assigned
- Sets `originUserContextId = actor.id` for user uploads

**`triggerOcr()`**:
- Updated to allow self-managing users
- Uses `isOriginManager()` helper for authorization

**`assignManagerToDocument()`** (NEW):
- Validates document is self-managed
- Validates actor is self-managing user
- Validates manager is verified
- Updates `originManagerId` (immutable after this)

#### DocumentAccessDomainService

**`isOriginManager()`** (NEW Helper):
- Centralizes logic for determining origin manager
- Handles both self-managed and manager-managed documents

**`canPerformOperation()`**:
- Uses `isOriginManager()` helper
- Applies operation-specific rules

**`listDocuments()`**:
- Includes self-managed documents for users
- Queries documents where `originManagerId IS NULL` and `originUserContextId` matches

### 7.2 Access Grant Service Updates

**`hasAccess()`**:
- Added check for self-managed documents
- Grants implicit access to self-managing users

### 7.3 Entity Updates

**Domain Entity** (`document.entity.ts`):
```typescript
export class Document {
  originManagerId: number | null; // Changed from number
  originUserContextId?: number;
  // ... other fields
}
```

**Persistence Entity** (`document.entity.ts`):
```typescript
@Entity({ name: 'documents' })
export class DocumentEntity {
  @ManyToOne(() => ManagerEntity, { nullable: true })
  @JoinColumn({ name: 'origin_manager_id' })
  originManager: ManagerEntity | null;

  @Column({ name: 'origin_manager_id', nullable: true })
  originManagerId: number | null;

  @Column({ name: 'origin_user_context_id', nullable: true })
  originUserContextId?: number;
}
```

### 7.4 DTO Updates

**DocumentResponseDto**:
```typescript
@ApiProperty({
  description: 'Origin manager ID (Manager ID, not User ID), or null if self-managed',
  nullable: true,
})
originManagerId: number | null;
```

**AssignManagerDto** (NEW):
```typescript
export class AssignManagerDto {
  @ApiProperty({ description: 'The ID of the manager to assign' })
  @IsNumber()
  @IsNotEmpty()
  managerId: number;
}
```

---

## 8. Migration Guide

### 8.1 Database Migration

The migration already exists (`1735000003000-AddOriginManagerToDocuments.ts`) and makes `origin_manager_id` nullable. No new migration is needed.

### 8.2 Code Migration

1. **Update Type Definitions**: Change `originManagerId: number` to `originManagerId: number | null` in:
   - Domain entities
   - DTOs
   - Service method signatures

2. **Update Authorization Logic**: Use `isOriginManager()` helper instead of direct manager checks

3. **Update Access Control**: Add checks for self-managed documents in access grant service

4. **Add New Endpoint**: Implement `POST /api/v1/documents/:documentId/assign-manager`

### 8.3 Testing

See `docs/user-self-management-tests.md` for comprehensive test documentation.

---

## 9. Security Considerations

### 9.1 Authorization Enforcement

- All document operations go through `DocumentAccessDomainService`
- Self-management checks are centralized in `isOriginManager()`
- Manager assignment is validated at multiple levels

### 9.2 Audit Trail

- All operations are logged via `AuditService`
- Manager assignment creates audit event: `MANAGER_ASSIGNED_TO_DOCUMENT`
- Self-management operations are tracked in audit logs

### 9.3 HIPAA Compliance

- Maintains origin-centered custodianship model
- Preserves immutable document history
- Enforces role-based access boundaries
- Provides complete audit trail

---

## 10. Future Considerations

### 10.1 Potential Enhancements

- Bulk manager assignment for multiple documents
- Manager assignment via invitation workflow
- Notification system for manager assignments
- Analytics on self-management usage

### 10.2 Limitations

- Manager assignment is one-way (cannot revert)
- Self-management is document-scoped (not user-scoped)
- Users cannot create access grants (only managers can)

---

## Appendix A: Code References

### Key Files

- `src/document-processing/domain/services/document-processing.domain.service.ts`
- `src/document-processing/domain/services/document-access.domain.service.ts`
- `src/access-control/domain/services/access-grant.domain.service.ts`
- `src/document-processing/document-processing.controller.ts`
- `src/document-processing/dto/assign-manager.dto.ts`

### Key Methods

- `DocumentProcessingDomainService.uploadDocument()`
- `DocumentProcessingDomainService.triggerOcr()`
- `DocumentProcessingDomainService.assignManagerToDocument()`
- `DocumentAccessDomainService.isOriginManager()`
- `DocumentAccessDomainService.canPerformOperation()`

---

**End of Document**

