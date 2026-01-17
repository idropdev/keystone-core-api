
# SYSTEM-100: Organization Structure & Access Requests

This PR implements the comprehensive Organization Structure, RBAC, and Access Request workflow for Keystone.

## Key Features

### 1. Organization Structure & RBAC
- Added `Organization` concept via `ManagerOrganization`.
- Updated `Manager` entity to belong to organizations.
- Added RBAC: Admins manage orgs, Managers view own org.

### 2. Auto User-Manager Assignment
- **New Feature**: Users are automatically assigned to managers when:
  - They upload a document with `originManagerId`.
  - A manager grants them access to a document (if acting as temp manager).
- Implemented `UserManagerAssignmentService.ensureAssignment()` (idempotent).

### 3. Access Request Workflow
- **New Feature**: Managers can request access to documents.
- **Role**: `RoleEnum.manager`
- **Endpoints**:
  - `POST /access-requests`: Request access
  - `GET /access-requests/pending`: View pending (for origin manager)
  - `PATCH /access-requests/:id/approve`
  - `PATCH /access-requests/:id/deny`

### 4. Organization Filtering (User Side)
- **New Endpoints**:
  - `GET /users/me/assigned-managers`: List managers assigned to user.
  - `GET /users/me/organizations`: List organizations user is connected to.
- **Security Check**: Fixed `RolesGuard` to allow User role override on specific methods.

### 5. Deletion Request (Scalable Revocation)
- Added `deletion_request` type to `RevocationRequest`.
- Implemented batch revocation `revokeAllByDocumentId`.

## Testing
- **E2E Tests**: Added **Phase 9** to `keystone-full-workflow.e2e-spec.ts` covering:
  - Access Request flow (Request -> List -> Approve/Deny)
  - User Organization filtering
  - Auto-assignment triggers
- **Verification**: All 11 new tests PASSED in local environment.

## Fixes Included
- Fixed Circular Dependency (`AccessControlModule` <-> `UsersModule`).
- Fixed `RolesGuard` precedence (Handler > Class).
- Fixed Migration dependency order.
