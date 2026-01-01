# PHASE 5.7: Manager Onboarding Lifecycle - Implementation Plan

## Status

**Phase**: 5.7 - Manager Onboarding Lifecycle
**Status**: Not Started
**Priority**: High (Required for HIPAA-compliant manager identity management)

## Overview

This phase implements a controlled, auditable manager onboarding lifecycle to ensure:
- Admin-controlled manager creation (no self-signup)
- Verification before use (HIPAA requirement)
- Separation of invitation, profile completion, and verification
- Admin controls for suspension/deletion
- Legal + operational metadata capture

**Key Principle**: Managers cannot access documents until verified. This is critical for HIPAA compliance as manager identity defines custodial authority.

---

## Current State Analysis

### What Exists
- ✅ `ManagerOrganization` entity (with verification_status)
- ✅ `ManagerInstance` entity
- ✅ Database migrations for manager tables
- ✅ Audit events: `MANAGER_VERIFIED`, `MANAGER_SUSPENDED`
- ✅ Manager role in RoleEnum

### What's Missing
- ❌ `ManagerInvitation` entity and lifecycle
- ❌ Manager onboarding API endpoints
- ❌ Verification guardrails in document processing
- ❌ Admin controls (invite, verify, suspend, delete)
- ❌ Manager self-service endpoints
- ❌ Additional audit events

---

## Implementation Modules

### Module 5.7.1: ManagerInvitation Foundation

**Files to Create**:
- `src/managers/domain/entities/manager-invitation.entity.ts`
- `src/managers/infrastructure/persistence/relational/entities/manager-invitation.entity.ts`
- `src/managers/domain/repositories/manager-invitation.repository.port.ts`
- `src/managers/infrastructure/persistence/relational/repositories/manager-invitation.repository.ts`
- `src/database/migrations/1735000004000-CreateManagerInvitations.ts`

**Domain Entity**:
```typescript
export class ManagerInvitation {
  id: number;
  email: string;
  organizationId: number;
  invitedByAdminId: number;
  token: string; // One-time, expiring token
  expiresAt: Date;
  acceptedAt?: Date;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
}
```

**Database Migration**:
- Create `manager_invitations` table
- Index on `token` (for lookup)
- Index on `email` (for duplicate prevention)
- Foreign keys to `manager_organizations` and `users` (admin)

**Acceptance Criteria**:
- ✅ ManagerInvitation entity created
- ✅ Database migration runs successfully
- ✅ Repository port and adapter implemented
- ✅ Token generation (crypto-secure, one-time use)

---

### Module 5.7.2: Manager Onboarding Domain Service

**Files to Create**:
- `src/managers/domain/services/manager-onboarding.domain.service.ts`
- `src/managers/domain/services/manager-profile.domain.service.ts`

**Key Methods**:

1. **Invite Manager** (Admin only):
   ```typescript
   async inviteManager(
     adminId: number,
     email: string,
     organizationId: number,
   ): Promise<ManagerInvitation>
   ```
   - Generate secure token
   - Set expiration (e.g., 7 days)
   - Send invitation email
   - Audit: `MANAGER_INVITED`

2. **Accept Invitation**:
   ```typescript
   async acceptInvitation(
     token: string,
     userData: { firstName, lastName, password },
     managerProfile: { displayName, location, identifiers }
   ): Promise<{ user, managerInstance }>
   ```
   - Validate token (not expired, not accepted)
   - Create User (role = manager)
   - Create ManagerInstance
   - Link to ManagerOrganization
   - Set status = `pending_verification`
   - Audit: `MANAGER_ONBOARDING_STARTED`, `MANAGER_ONBOARDING_COMPLETED`

3. **Verify Manager** (Admin only):
   ```typescript
   async verifyManager(
     adminId: number,
     managerInstanceId: number,
   ): Promise<ManagerInstance>
   ```
   - Update verification_status = 'verified'
   - Set verified_at, verified_by
   - Audit: `MANAGER_VERIFIED`

4. **Suspend Manager** (Admin only):
   ```typescript
   async suspendManager(
     adminId: number,
     managerInstanceId: number,
     reason: string,
   ): Promise<ManagerInstance>
   ```
   - Disable all access
   - Prevent new documents
   - Audit: `MANAGER_SUSPENDED`

5. **Update Profile** (Manager self-service):
   ```typescript
   async updateManagerProfile(
     managerInstanceId: number,
     updates: { displayName?, phone?, operatingHours? }
   ): Promise<ManagerInstance>
   ```
   - Restrict: Cannot update org identifiers, verification status, organization
   - Audit: `MANAGER_PROFILE_UPDATED`

**Dependencies**:
- ManagerInvitationRepository
- ManagerInstanceRepository
- ManagerOrganizationRepository
- UserRepository (for creating manager user)
- AuditService
- MailService (for invitation emails)

---

### Module 5.7.3: Manager API Endpoints

**Files to Create**:
- `src/managers/managers.controller.ts`
- `src/managers/admin-managers.controller.ts`
- `src/managers/dto/create-manager-invitation.dto.ts`
- `src/managers/dto/accept-invitation.dto.ts`
- `src/managers/dto/update-manager-profile.dto.ts`
- `src/managers/dto/verify-manager.dto.ts`
- `src/managers/dto/suspend-manager.dto.ts`

**Endpoints**:

#### A. Manager Invitation (Admin Only)
1. **POST /v1/admin/manager-invitations**
   - Auth: Admin only (`@Roles(RoleEnum.admin)`)
   - Body: `{ email, organizationId }`
   - Response: `{ id, email, token, expiresAt }`
   - Side Effects: Creates invitation, sends email, audits `MANAGER_INVITED`

2. **GET /v1/manager-invitations/:token**
   - Auth: Public (token-based validation)
   - Response: `{ organizationName, expiresAt, status }`
   - Used for invitation validation before signup

#### B. Manager Onboarding
3. **POST /v1/manager-onboarding/accept**
   - Auth: Public (token-based)
   - Body: `{ token, user: { firstName, lastName, password }, managerProfile: { displayName, location, identifiers } }`
   - Response: `{ user, managerInstance }`
   - Side Effects: Creates user + ManagerInstance, sets pending_verification, audits events

#### C. Manager Self-Service
4. **GET /v1/managers/me**
   - Auth: Manager (verified only)
   - Response: Manager profile + verification status

5. **PATCH /v1/managers/me**
   - Auth: Manager (verified only)
   - Body: `{ displayName?, phone?, operatingHours? }`
   - Restrictions: Cannot update org identifiers, verification status, organization
   - Audit: `MANAGER_PROFILE_UPDATED`

#### D. Admin Controls
6. **GET /v1/admin/managers**
   - Auth: Admin only
   - Query: `?status=verified&organizationId=10`
   - Response: Paginated list of managers

7. **PATCH /v1/admin/managers/:id/verify**
   - Auth: Admin only
   - Body: `{ status: 'verified' }`
   - Audit: `MANAGER_VERIFIED`

8. **PATCH /v1/admin/managers/:id/suspend**
   - Auth: Admin only
   - Body: `{ reason: string }`
   - Side Effects: Disable access, prevent new documents
   - Audit: `MANAGER_SUSPENDED`

9. **DELETE /v1/admin/managers/:id**
   - Auth: Admin only
   - Preconditions: No origin documents OR documents reassigned
   - Audit: `MANAGER_DELETED`

**Authorization**:
- Admin endpoints: `@Roles(RoleEnum.admin)`
- Manager endpoints: `@Roles(RoleEnum.manager)` + verification check
- Public endpoints: Token-based validation

---

### Module 5.7.4: Verification Guardrails

**Files to Update**:
- `src/document-processing/domain/services/document-processing.domain.service.ts`
- `src/access-control/domain/services/access-grant.domain.service.ts`
- `src/document-processing/domain/services/document-access.domain.service.ts`
- `src/managers/managers.controller.ts` (for directory endpoint)

**Guardrails to Implement**:

1. **Document Upload**:
   - ❌ Unverified managers cannot be selected as origin manager
   - Check: `managerInstance.organization.verificationStatus === 'verified'`

2. **OCR Trigger**:
   - ❌ Unverified managers cannot trigger OCR
   - Check in `triggerOcr()` method

3. **Access Grants**:
   - ❌ Unverified managers cannot receive access grants
   - Check in `createAccessGrant()` method

4. **Manager Directory**:
   - ✅ Only verified managers appear in `/v1/managers` directory
   - Filter: `WHERE verification_status = 'verified'`

5. **Manager Self-Service**:
   - ❌ Unverified managers cannot update profile
   - Check in `PATCH /v1/managers/me`

**Implementation Pattern**:
```typescript
// In domain services
async ensureManagerVerified(managerInstanceId: number): Promise<void> {
  const manager = await this.managerInstanceRepository.findById(managerInstanceId);
  if (manager.organization.verificationStatus !== 'verified') {
    throw new ForbiddenException('Manager must be verified before performing this action');
  }
}
```

---

### Module 5.7.5: Audit Events Extension

**Files to Update**:
- `src/audit/audit.service.ts`

**New Audit Events**:
```typescript
export enum AuthEventType {
  // ... existing events ...
  MANAGER_INVITED = 'MANAGER_INVITED',
  MANAGER_ONBOARDING_STARTED = 'MANAGER_ONBOARDING_STARTED',
  MANAGER_ONBOARDING_COMPLETED = 'MANAGER_ONBOARDING_COMPLETED',
  MANAGER_PROFILE_UPDATED = 'MANAGER_PROFILE_UPDATED',
  MANAGER_DELETED = 'MANAGER_DELETED',
  // MANAGER_VERIFIED and MANAGER_SUSPENDED already exist
}
```

**Audit Data Requirements**:
- All events: `userId` (admin or manager), `managerInstanceId`, `organizationId`
- NO PHI in audit logs
- Include relevant metadata (invitation token hash, verification reason, etc.)

---

## Implementation Order

1. **5.7.1: ManagerInvitation Foundation** (Database + Entities)
2. **5.7.2: Manager Onboarding Domain Service** (Business Logic)
3. **5.7.3: Manager API Endpoints** (Public Interface)
4. **5.7.4: Verification Guardrails** (Security Enforcement)
5. **5.7.5: Audit Events Extension** (Compliance)

---

## Testing Requirements

### E2E Tests to Create:
- `test/managers/manager-invitations.e2e-spec.ts`
- `test/managers/manager-onboarding.e2e-spec.ts`
- `test/managers/manager-self-service.e2e-spec.ts`
- `test/managers/admin-manager-controls.e2e-spec.ts`

### Test Scenarios:
1. Admin invites manager → invitation created, email sent
2. Manager accepts invitation → user + ManagerInstance created, status = pending
3. Admin verifies manager → status = verified
4. Verified manager uploads document → success
5. Unverified manager uploads document → 403 Forbidden
6. Manager updates profile → success (with restrictions)
7. Admin suspends manager → access disabled
8. Admin deletes manager → success (if no origin documents)

---

## HIPAA Compliance Notes

1. **No Self-Signup**: All managers must be invited by admin
2. **Verification Required**: Managers cannot access documents until verified
3. **Audit Trail**: All invitation, onboarding, and verification events logged
4. **No PHI in Logs**: Audit events sanitized per existing patterns
5. **Retention**: Manager deletion respects document retention rules

---

## Dependencies

- UsersModule (for creating manager users)
- AuditModule (for audit logging)
- MailModule (for invitation emails)
- AccessControlModule (for verification checks)
- DocumentProcessingModule (for guardrails)

---

## Next Steps After Completion

1. Update test helpers to use new manager onboarding flow
2. Update documentation with manager onboarding process
3. Add manager onboarding to admin UI (future)
4. Implement manager directory UI (future)

