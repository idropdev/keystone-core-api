# Manager Architecture Simplification - Quick Reference

## Overview

**Change**: Remove `ManagerOrganization` concept. Managers are now independent entities.

**Impact**: Simplifies domain model while preserving all security and HIPAA constraints.

---

## Key Changes

### Entity Changes

| Before | After |
|--------|-------|
| `ManagerOrganization` | ❌ **REMOVED** |
| `ManagerInstance` | ✅ **RENAMED** → `Manager` |
| Organization-level verification | ✅ **MOVED** → Manager-level verification |

### Manager Entity (New Structure)

```typescript
class Manager {
  id: number;
  userId: number;                      // FK to User
  
  // Identity (Required)
  displayName: string;                 // REQUIRED
  legalName?: string;
  
  // Location (at least one required)
  address?: string;                    // OR
  latitude?: number;                   // AND
  longitude?: number;                  // (both if using coordinates)
  
  // Contact
  phoneNumber?: string;
  operatingHours?: string;
  timezone?: string;                   // IANA format
  
  // Verification (Manager-Level)
  verificationStatus: 'pending' | 'verified' | 'suspended';
  verifiedAt?: Date;
  verifiedByAdminId?: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}
```

---

## Verification Model

### Before (Organization-Level)
- Verification applied to `ManagerOrganization`
- All managers under an organization shared verification status
- Suspending an organization affected all managers

### After (Manager-Level)
- Verification applied directly to `Manager`
- Each manager independently verified
- Suspending one manager has no effect on others

### States
- `pending` → Newly created, awaiting verification
- `verified` → Can upload documents, trigger OCR, appear in directory
- `suspended` → Cannot access documents (admin can re-verify)

---

## API Changes

### POST /v1/admin/manager-invitations

**Before**:
```json
{
  "email": "manager@example.com",
  "organizationId": 123
}
```

**After**:
```json
{
  "email": "manager@example.com",
  "displayName": "Quest Diagnostics – Downtown Lab",
  "address": "123 Main St, Austin, TX 78701",
  "phoneNumber": "+1-512-555-1234"
}
```

### GET /v1/managers

**Before**: Returns managers with `organizationId`, `organizationName`

**After**: Returns managers with identity fields (`displayName`, `address`, etc.)

### Verification Endpoints

- `PATCH /v1/admin/managers/:id/verify` → Updates `Manager.verificationStatus` (not organization)
- `PATCH /v1/admin/managers/:id/suspend` → Updates `Manager.verificationStatus = 'suspended'`

---

## Test Updates

### Test Helpers

**Remove**:
- `createTestManagerOrganization()`

**Update**:
- `createTestManagerInvitation()` → Accept manager identity fields (not `organizationId`)
- `verifyTestManager()` → Verify manager directly (not organization)

### Test Scenarios

1. **Manager Invitation**: Remove organization creation, add identity fields
2. **Manager Verification**: Verify manager directly, test independent verification
3. **Directory Listing**: Filter by `Manager.verificationStatus = 'verified'`
4. **Document Upload**: Verify manager before allowing upload

---

## Invariants (Updated)

1. ✅ Managers are independent (no organization grouping)
2. ✅ Managers must be verified before activation
3. ✅ Manager identity must be human-distinguishable (`displayName` + location)
4. ✅ At least one location method required: `address` OR (`latitude` AND `longitude`)
5. ✅ Verification is manager-level (not organization-level)
6. ✅ Suspending one manager does not affect others

---

## What Stays the Same

- ✅ AccessGrant-driven access control
- ✅ Origin-centered document authority
- ✅ Audit logging requirements
- ✅ HIPAA constraints
- ✅ Session-based authentication
- ✅ Admin hard-denied from document access

---

## Migration Checklist

### Database
- [ ] Add new fields to `manager_instances` table
- [ ] Migrate verification status from organizations
- [ ] Migrate identity data
- [ ] Remove `organization_id` columns
- [ ] Drop `manager_organizations` table
- [ ] Rename `manager_instances` → `managers`

### Code
- [ ] Update domain entities (`ManagerInstance` → `Manager`)
- [ ] Update repositories (remove organization references)
- [ ] Update services (remove organization logic)
- [ ] Update controllers (remove organization endpoints)
- [ ] Update DTOs (remove `organizationId`, add identity fields)
- [ ] Update tests (remove organization setup)

---

## Files to Update

### Remove
- `src/managers/domain/entities/manager-organization.entity.ts`
- `src/managers/infrastructure/persistence/relational/entities/manager-organization.entity.ts`
- `src/managers/domain/repositories/manager-organization.repository.port.ts`
- `src/managers/infrastructure/persistence/relational/repositories/manager-organization.repository.ts`
- `src/managers/dto/create-manager-organization.dto.ts`
- `src/managers/controllers/admin-managers.controller.ts` (organization endpoints)

### Rename
- `ManagerInstance` → `Manager` (everywhere)
- `ManagerInstanceEntity` → `ManagerEntity`
- `ManagerInstanceRepositoryPort` → `ManagerRepositoryPort`

### Update
- All services that reference `ManagerOrganization`
- All controllers that reference `organizationId`
- All tests that create organizations
- All DTOs that include `organizationId`

---

## Design Documents

- **Full Design**: `docs/manager-architecture-simplification.md`
- **Domain Model**: `docs/phase-0-domain-modeling.md` (updated)
- **Quick Reference**: This document

