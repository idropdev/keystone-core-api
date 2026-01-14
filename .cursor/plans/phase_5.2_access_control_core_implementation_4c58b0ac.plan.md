---
name: Phase 5.2 Access Control Core Implementation
overview: "Implement Phase 5.2: Access Control Core - AccessGrantService, DocumentAccessService, UserManagerAssignmentService, and Authorization Guards Updates. This phase builds on the foundation (Phase 5.1) to implement the core access control logic."
todos:
  - id: phase-5-2-1
    content: "Implement AccessGrantService with hasAccess(), createGrant(), revokeGrant() methods. Access resolution: origin manager implicit access OR explicit AccessGrant"
    status: pending
  - id: phase-5-2-2
    content: Implement DocumentAccessService with getDocument(), listDocuments(), canPerformOperation(). Enforce Phase 1 access decision matrix using AccessGrantService
    status: pending
    dependencies:
      - phase-5-2-1
  - id: phase-5-2-3
    content: Implement UserManagerAssignmentService with assignUserToManager(), removeAssignment(), validation (manager role, no self-assignment), audit logging
    status: pending
  - id: phase-5-2-4
    content: Update RolesGuard for manager role, hard-deny admins from document endpoints, extract actor type from JWT, pass actor to domain services
    status: pending
    dependencies:
      - phase-5-2-1
      - phase-5-2-2
---

# Phase 5.2: Ac

cess Control Core Implementation Plan

## Completed Foundation (Phase 5.1)

### Phase 5.1.1: Manager Role & Entities ✅

- Manager role (RoleEnum.manager = 3) added
- ManagerOrganization and ManagerInstance entities created
- Database migrations completed
- Commit: `1466172`, `1eab0e4`

### Phase 5.1.2: UserManagerAssignment Entity ✅

- UserManagerAssignment entity and repository created
- Database migration with indexes and constraints
- Commit: `845943b`, `9ea962a`

### Phase 5.1.3: AccessGrant Entity ✅

- AccessGrant entity and repository created
- Database migration with CHECK constraints
- Commit: `dd43674`, `79c486b`, `49261e6`

### Phase 5.1.4: Document originManagerId Migration ✅

- originManagerId and originUserContextId added to Document entity
- Database migration completed
- Commit: `e6168b5`

---

## Next: Phase 5.2 - Access Control Core

### Module 5.2.1: AccessGrantService

**Files to Create**:

- `src/access-control/domain/services/access-grant.domain.service.ts`
- `src/access-control/dto/create-access-grant.dto.ts`
- `src/access-control/dto/revoke-access-grant.dto.ts`

**Key Implementation**:

- `hasAccess()` method: Check origin manager implicit access OR explicit AccessGrant
- `createGrant()` method: Validate grantor authority, create AccessGrant
- `revokeGrant()` method: Soft revoke (set revokedAt), handle cascade if needed
- `getActiveGrants()` methods: Query active grants for document or subject

**Access Resolution Logic**:

```typescript
async hasAccess(documentId: string, actorType: 'user' | 'manager', actorId: number): Promise<boolean> {
  // 1. Get document
  const document = await this.documentRepository.findById(documentId);
  if (!document) return false;
  
  // 2. Check if actor is origin manager (implicit access)
  if (actorType === 'manager' && document.originManagerId === actorId) {
    return true;
  }
  
  // 3. Check for active AccessGrant
  const grant = await this.accessGrantRepository.findActive(
    documentId,
    actorType,
    actorId
  );
  
  return !!grant;
}
```

**Dependencies**:

- AccessGrantRepository (from Phase 5.1.3)
- DocumentRepository (existing)

---

### Module 5.2.2: DocumentAccessService

**Files to Create**:

- `src/document-processing/domain/services/document-access.domain.service.ts`

**Key Implementation**:

- `getDocument()`: Enforce access control using AccessGrantService
- `listDocuments()`: Filter documents by AccessGrants (origin manager OR explicit grants)
- `canPerformOperation()`: Implement Phase 1 access decision matrix

**Authorization Rules** (from Phase 1):

- Origin Manager: Full custodial authority (implicit access)
- Secondary Manager: View-only if granted
- User: View-only if granted
- Admin: Hard-denied (no document access)

**Dependencies**:

- AccessGrantService (from 5.2.1)
- DocumentRepository (existing)
- AuditService (existing)

---

### Module 5.2.3: UserManagerAssignmentService

**Files to Create**:

- `src/users/domain/services/user-manager-assignment.service.ts`
- `src/users/dto/create-user-manager-assignment.dto.ts`

**Key Implementation**:

- `assignUserToManager()`: Validate manager role, prevent self-assignment, create assignment
- `removeAssignment()`: Soft delete assignment
- `isManagerAssignedToUser()`: Check assignment exists
- `getAssignedUserIds()` / `getAssignedManagerIds()`: Query assignments

**Validation Rules**:

- Manager must have role 'manager'
- User cannot be assigned to themselves
- Audit log all assignment changes

**Dependencies**:

- UserManagerAssignmentRepository (from Phase 5.1.2)
- UserRepository (existing)
- AuditService (existing)

---

### Module 5.2.4: Authorization Guards Updates

**Files to Update**:

- `src/roles/roles.guard.ts` - Handle manager role
- `src/document-processing/document-processing.controller.ts` - Hard deny admins

**Key Changes**:

- Update RolesGuard to recognize RoleEnum.manager
- Extract actor type from JWT (user/manager/admin)
- Hard deny admins from document endpoints (403 before domain service)
- Pass actor to domain services

**Actor Extraction**:

```typescript
// From JWT payload: { id: userId, role: roleId, sessionId }
// Determine actor type:
// - roleId === RoleEnum.admin → actorType = 'admin'
// - roleId === RoleEnum.manager → actorType = 'manager'
// - roleId === RoleEnum.user → actorType = 'user'
```

**Dependencies**:

- RoleEnum (updated in Phase 5.1.1)
- JWT strategy (existing)

---

## Implementation Order

1. **5.2.1: AccessGrantService** (Foundation for access resolution)
2. **5.2.2: DocumentAccessService** (Depends on 5.2.1)
3. **5.2.3: UserManagerAssignmentService** (Independent, can be parallel)
4. **5.2.4: Authorization Guards** (Depends on all above)

---

## Key Files to Modify

### New Files:

- `src/access-control/domain/services/access-grant.domain.service.ts`
- `src/access-control/dto/create-access-grant.dto.ts`
- `src/access-control/dto/revoke-access-grant.dto.ts`
- `src/document-processing/domain/services/document-access.domain.service.ts`
- `src/users/domain/services/user-manager-assignment.service.ts`
- `src/users/dto/create-user-manager-assignment.dto.ts`

### Modified Files:

- `src/roles/roles.guard.ts`
- `src/document-processing/document-processing.controller.ts`
- `src/access-control/access-control.module.ts` (register service)
- `src/users/users.module.ts` (register service)
- `src/document-processing/document-processing.module.ts` (register service)

---

## Testing Strategy

After each module:

- Unit tests for service methods
- Integration tests for access resolution
- Verify origin manager implicit access
- Verify explicit grant access
- Verify admin hard-deny

---

## Success Criteria

- ✅ AccessGrantService resolves access correctly (origin manager implicit + explicit grants)
- ✅ DocumentAccessService enforces Phase 1 access decision matrix