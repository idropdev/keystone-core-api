# Manager Architecture Simplification - Design Document

## Status

**Phase**: Design & Refactor Planning  
**Status**: Awaiting Approval  
**Date**: 2025-01-27

## Overview

This document defines the simplified Manager architecture that removes the `ManagerOrganization` concept entirely. Managers will exist as independent, verified custodial entities without organizational grouping.

**Key Principle**: Reducing domain complexity must not reduce auditability, authority clarity, or HIPAA safety.

---

## Motivation

### Why Simplify?

1. **Reduce Domain Complexity**: Eliminate the two-tier hierarchy (Organization → Instance)
2. **Avoid Cascading Effects**: Suspending one manager doesn't affect others
3. **Preserve Origin-Centered Authority**: Each manager independently verified
4. **Maintain HIPAA Compliance**: Verification and access control remain strict

### What Changes?

- ❌ **Remove**: `ManagerOrganization` entity and all references
- ✅ **Rename**: `ManagerInstance` → `Manager`
- ✅ **Move**: Verification from organization-level to manager-level
- ✅ **Add**: Real-world identity fields for unique identification

### What Stays the Same?

- ✅ AccessGrant-driven access control
- ✅ Origin-centered document authority
- ✅ Audit logging requirements
- ✅ HIPAA constraints (no PHI in OAuth, JWT, logs)
- ✅ Session-based authentication
- ✅ Admin hard-denied from document access

---

## New Conceptual Model

### Manager (Single Entity)

A `Manager` represents a real-world healthcare provider, clinic, lab, or practitioner.

**Managers**:
- Are not users (separate entity)
- Are not grouped (no organization hierarchy)
- Are independently verified
- Can act as origin managers for documents
- Can receive delegated access grants

---

## Manager Entity Design

### Identity Fields (Required)

Each manager MUST include non-ambiguous real-world identifiers to avoid collisions.

```typescript
class Manager {
  // Primary Identity
  id: number;                          // Auto-increment
  displayName: string;                 // REQUIRED: "Quest Diagnostics – Downtown Lab"
  legalName?: string;                   // Optional but recommended: "Quest Diagnostics Incorporated"
  
  // Location (at least one required)
  address?: string;                     // Full address string OR
  latitude?: number;                    // Geographic coordinates (if no address)
  longitude?: number;                   // Geographic coordinates (if no address)
  
  // Contact & Metadata
  phoneNumber?: string;                 // Contact phone
  operatingHours?: string;              // Free-form or structured JSON
  timezone?: string;                    // IANA timezone format (e.g., "America/New_York")
  
  // Verification (Manager-Level)
  verificationStatus: 'pending' | 'verified' | 'suspended';
  verifiedAt?: Date;                    // Timestamp when verified
  verifiedByAdminId?: number;           // Admin who verified
  
  // User Link (for authentication)
  userId: number;                       // FK to User (manager must have role 'manager')
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;                     // Soft delete
}
```

### Validation Rules

1. **Identity Uniqueness**:
   - Two managers may share `displayName` only if location differs
   - Enforce at least one: `address` OR (`latitude` AND `longitude`)

2. **Verification States**:
   - `pending`: Newly created, awaiting admin verification
   - `verified`: Admin-verified, can act as origin manager
   - `suspended`: Admin-suspended, cannot access documents

3. **Verification Requirements**:
   - Only `verified` managers can:
     - Upload documents
     - Trigger OCR
     - Act as origin managers
     - Appear in directory listings

---

## Verification Model (Simplified)

### Manager-Level Verification

**Before (Organization-Level)**:
- Verification applied to `ManagerOrganization`
- All `ManagerInstance` entities under an organization shared verification status
- Suspending an organization affected all instances

**After (Manager-Level)**:
- Verification applied directly to `Manager`
- Each manager independently verified
- Suspending one manager has no effect on others

### Verification States

```typescript
type VerificationStatus = 'pending' | 'verified' | 'suspended';
```

**State Transitions**:
- `pending` → `verified`: Admin verifies manager
- `verified` → `suspended`: Admin suspends manager
- `suspended` → `verified`: Admin re-verifies manager (after review)

### Verification Workflow

1. **Admin invites manager** → Creates `ManagerInvitation`
2. **Manager accepts invitation** → Creates `User` (role: manager) + `Manager` (status: `pending`)
3. **Admin verifies manager** → Updates `Manager.verificationStatus = 'verified'`
4. **Manager can now**:
   - Upload documents
   - Trigger OCR
   - Appear in directory
   - Act as origin manager

---

## Document Origin Rules (Unchanged)

- Each document has exactly one immutable `originManagerId`
- The origin manager:
  - Has implicit access (no AccessGrant needed)
  - Controls OCR processing
  - Controls re-sharing authority
- Documents are never owned by users

---

## User Upload Rules (Simplified)

- Users may upload documents
- User MUST select a **verified manager** at upload time
- That manager becomes the `originManagerId`
- User receives a delegated AccessGrant automatically

**No Change**: Users still select from verified managers only.

---

## Access Control (No Change)

- Access remains AccessGrant-driven
- Origin manager = implicit access
- All others require explicit grants
- Admins remain hard-denied from document access

---

## Required Design Changes

### Remove

- ❌ `ManagerOrganization` entity (domain + infrastructure)
- ❌ `ManagerOrganizationRepositoryPort` and implementation
- ❌ Organization-level verification logic
- ❌ Organization directory logic
- ❌ Organization-level suspension logic
- ❌ `organizationId` field from `Manager` entity
- ❌ `organizationId` from `ManagerInvitation` entity
- ❌ All references to `ManagerOrganization` in:
  - Controllers
  - Services
  - Repositories
  - DTOs
  - Tests

### Update

- ✅ `ManagerInstance` → `Manager` (rename everywhere)
- ✅ `ManagerInstanceEntity` → `ManagerEntity`
- ✅ `ManagerInstanceRepositoryPort` → `ManagerRepositoryPort`
- ✅ Verification logic → manager-level (not organization-level)
- ✅ Directory listing → verified managers only (filter by `verificationStatus = 'verified'`)
- ✅ Suspension logic → per manager (update `verificationStatus = 'suspended'`)
- ✅ `ManagerInvitation` → remove `organizationId`, add manager identity fields
- ✅ Document upload → verify manager directly (not organization)

### Add

- ✅ `displayName` (required string)
- ✅ `legalName` (optional string)
- ✅ `address` (optional string)
- ✅ `latitude` (optional number)
- ✅ `longitude` (optional number)
- ✅ `phoneNumber` (optional string)
- ✅ `operatingHours` (optional string/JSON)
- ✅ `timezone` (optional string, IANA format)
- ✅ `verificationStatus` (required enum: 'pending' | 'verified' | 'suspended')
- ✅ `verifiedAt` (optional Date)
- ✅ `verifiedByAdminId` (optional number)

### Preserve

- ✅ AccessGrant system
- ✅ Origin-centered document authority
- ✅ Audit logging
- ✅ HIPAA constraints
- ✅ Session-based authentication
- ✅ UserManagerAssignment (still references Manager, not Organization)

---

## Updated Domain Model

### Manager Entity

```typescript
/**
 * Domain entity for Manager
 * Represents an independent, verified healthcare provider that can act as origin manager
 */
export class Manager {
  id: number;
  userId: number;                      // Links to User entity (manager must have role 'manager')
  
  // Identity (Required for uniqueness)
  displayName: string;                 // REQUIRED: "Quest Diagnostics – Downtown Lab"
  legalName?: string;                   // Optional: "Quest Diagnostics Incorporated"
  
  // Location (at least one required)
  address?: string;                     // Full address OR
  latitude?: number;                    // Geographic coordinates
  longitude?: number;                   // Geographic coordinates
  
  // Contact & Metadata
  phoneNumber?: string;
  operatingHours?: string;              // Free-form or structured JSON
  timezone?: string;                    // IANA format
  
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

## Updated Invariants

### Manager Invariants

1. ✅ Managers are separate entities (not Users with a role)
2. ✅ Only Managers can be origin managers for documents
3. ✅ **Managers are independent (no organization grouping)**
4. ✅ **Managers must be verified before activation** (`verificationStatus = 'verified'`)
5. ✅ Managers authenticate via shared OAuth infrastructure (same as users)
6. ✅ Managers can be assigned to users (for management relationships)
7. ✅ Managers can receive access grants (as secondary managers)
8. ✅ Managers cannot delete documents (only revoke access)
9. ✅ **Manager identity must be human-distinguishable** (`displayName` + location)
10. ✅ **At least one location method required**: `address` OR (`latitude` AND `longitude`)

### Verification Invariants

1. ✅ Only `verified` managers can upload documents
2. ✅ Only `verified` managers can trigger OCR
3. ✅ Only `verified` managers appear in directory listings
4. ✅ Verification is manager-level (not organization-level)
5. ✅ Suspending one manager does not affect others

### Document Origin Invariants (Unchanged)

1. ✅ Each document has exactly one immutable `originManagerId`
2. ✅ Origin manager has implicit access (no AccessGrant needed)
3. ✅ Origin manager controls OCR processing
4. ✅ Origin manager controls re-sharing authority

---

## Updated Access Assumptions

### Manager Verification Checks

**Before Document Upload**:
- If actor is manager → verify `Manager.verificationStatus = 'verified'`
- If actor is user → verify selected manager's `verificationStatus = 'verified'`

**Before OCR Trigger**:
- Verify `Document.originManagerId` → `Manager.verificationStatus = 'verified'`

**Before Directory Listing**:
- Filter `Manager.verificationStatus = 'verified'` only

### Authorization Rules (Unchanged)

- **Origin Manager**: Full custodial authority (upload, OCR, metadata, re-share)
- **Secondary Manager**: View-only access (if granted via AccessGrant)
- **User**: Delegated access (if granted via AccessGrant)
- **Admin**: Hard-denied from document access

---

## API Contract Changes

### Endpoints to Update

#### 1. POST /v1/admin/manager-invitations

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
  "legalName": "Quest Diagnostics Incorporated",
  "address": "123 Main St, Austin, TX 78701",
  "phoneNumber": "+1-512-555-1234"
}
```

**Changes**:
- Remove `organizationId`
- Add manager identity fields (displayName, address, etc.)

#### 2. GET /v1/managers

**Before**:
```json
{
  "data": [
    {
      "id": 123,
      "organizationId": 10,
      "organizationName": "Quest Diagnostics",
      "name": "Quest Diagnostics - Downtown Lab",
      "verificationStatus": "verified"
    }
  ]
}
```

**After**:
```json
{
  "data": [
    {
      "id": 123,
      "displayName": "Quest Diagnostics – Downtown Lab",
      "legalName": "Quest Diagnostics Incorporated",
      "address": "123 Main St, Austin, TX 78701",
      "phoneNumber": "+1-512-555-1234",
      "verificationStatus": "verified"
    }
  ]
}
```

**Changes**:
- Remove `organizationId`, `organizationName`
- Add manager identity fields

#### 3. PATCH /v1/admin/managers/:id/verify

**Before**: Updates `ManagerOrganization.verificationStatus`

**After**: Updates `Manager.verificationStatus` directly

#### 4. PATCH /v1/admin/managers/:id/suspend

**Before**: Updates `ManagerOrganization.verificationStatus = 'rejected'`

**After**: Updates `Manager.verificationStatus = 'suspended'`

---

## Test Design Updates

### Test Helper Updates

**Remove**:
- `createTestManagerOrganization()` → No longer needed
- `organizationId` parameter from `createTestManagerInvitation()`

**Update**:
- `createTestManagerInvitation()` → Accept manager identity fields instead of `organizationId`
- `acceptTestManagerInvitation()` → No change (still accepts managerProfile)
- `verifyTestManager()` → Verify manager directly (not organization)

### Test Case Updates

#### Manager Onboarding Tests

**Before**:
```typescript
// Create organization
const org = await createTestManagerOrganization(adminToken);
// Create invitation with organizationId
const invitation = await createTestManagerInvitation(
  adminToken,
  email,
  org.id
);
```

**After**:
```typescript
// Create invitation with manager identity
const invitation = await createTestManagerInvitation(
  adminToken,
  email,
  {
    displayName: 'Test Manager',
    address: '123 Test St, Austin, TX 78701',
    phoneNumber: '+1-512-555-1234'
  }
);
```

#### Verification Tests

**Before**:
```typescript
// Verify manager (updates organization)
await verifyTestManager(adminToken, managerInstance.id);
// All managers in same organization become verified
```

**After**:
```typescript
// Verify manager (updates manager directly)
await verifyTestManager(adminToken, manager.id);
// Only this manager becomes verified
```

#### Directory Tests

**Before**:
```typescript
// Test: Unverified manager in verified organization appears in directory
// (organization-level verification)
```

**After**:
```typescript
// Test: Only verified managers appear in directory
// (manager-level verification)
const unverifiedManager = await createTestManager(...);
// Should NOT appear in directory
const verifiedManager = await verifyTestManager(adminToken, manager.id);
// Should appear in directory
```

### Test Scenarios to Update

1. **Manager Invitation**:
   - ✅ Remove organization creation step
   - ✅ Add manager identity fields to invitation

2. **Manager Verification**:
   - ✅ Verify manager directly (not organization)
   - ✅ Test that unverified managers don't appear in directory
   - ✅ Test that suspending one manager doesn't affect others

3. **Document Upload**:
   - ✅ Verify manager before allowing upload
   - ✅ Test that unverified managers cannot upload

4. **Directory Listing**:
   - ✅ Filter by `Manager.verificationStatus = 'verified'`
   - ✅ Test that unverified managers are excluded

---

## Migration Strategy (Design Only)

### Database Migration Steps

1. **Add new fields to `manager_instances` table**:
   - `display_name` (VARCHAR, NOT NULL)
   - `legal_name` (VARCHAR, nullable)
   - `address` (VARCHAR, nullable)
   - `latitude` (DECIMAL, nullable)
   - `longitude` (DECIMAL, nullable)
   - `phone_number` (VARCHAR, nullable)
   - `operating_hours` (VARCHAR, nullable)
   - `timezone` (VARCHAR, nullable)
   - `verification_status` (VARCHAR, NOT NULL, default 'pending')
   - `verified_at` (TIMESTAMP, nullable)
   - `verified_by_admin_id` (INTEGER, nullable)

2. **Migrate verification status from organizations**:
   - Copy `verification_status` from `manager_organizations` to `manager_instances`
   - Copy `verified_at` and `verified_by` from organizations to managers

3. **Migrate identity data**:
   - Use existing `display_name` if present
   - Populate `address` from existing location data if available

4. **Remove organization references**:
   - Drop `organization_id` column from `manager_instances`
   - Drop `organization_id` column from `manager_invitations`
   - Drop `manager_organizations` table

5. **Rename table**:
   - `manager_instances` → `managers`

### Application Code Migration

1. **Update entities** (domain + infrastructure)
2. **Update repositories** (ports + implementations)
3. **Update services** (remove organization logic)
4. **Update controllers** (remove organization endpoints)
5. **Update DTOs** (remove organizationId, add identity fields)
6. **Update tests** (remove organization setup, update verification logic)

---

## Validation & Constraints

### Manager Identity Validation

```typescript
// Validation rules
1. displayName is required (non-empty string)
2. At least one location method required:
   - address (non-empty string) OR
   - (latitude AND longitude) (both numbers)
3. If latitude provided, longitude must also be provided (and vice versa)
4. phoneNumber must be valid format (if provided)
5. timezone must be valid IANA format (if provided)
```

### Uniqueness Constraints

- Two managers may share `displayName` only if location differs
- Enforce uniqueness check: `(displayName, address)` OR `(displayName, latitude, longitude)`
- Database constraint: `UNIQUE(display_name, address, deleted_at)` OR similar

---

## Out of Scope (Explicitly)

- ❌ No organizations
- ❌ No multi-manager org suspension
- ❌ No tenant-style grouping
- ❌ No billing or enterprise modeling
- ❌ No hierarchical manager relationships

---

## Security & HIPAA Considerations

### No Changes to Security Model

- ✅ No PHI in OAuth flows
- ✅ No PHI in JWT tokens
- ✅ No PHI in logs
- ✅ Audit logging remains mandatory
- ✅ Session-based authentication unchanged

### Verification Security

- ✅ Only admins can verify managers
- ✅ Verification is audited (who, when, why)
- ✅ Suspension is audited (who, when, why)
- ✅ Unverified managers cannot access documents

---

## Next Steps After Approval

1. **PHASE 1**: Update domain entities and repositories
2. **PHASE 2**: Update services and controllers
3. **PHASE 3**: Update tests
4. **PHASE 4**: Database migration
5. **PHASE 5**: Documentation updates

---

## Summary

This design simplifies the Manager architecture by:

1. **Removing** the `ManagerOrganization` concept entirely
2. **Renaming** `ManagerInstance` → `Manager`
3. **Moving** verification to manager-level
4. **Adding** real-world identity fields for unique identification
5. **Preserving** all security, audit, and HIPAA constraints

The result is a simpler, more maintainable architecture that preserves all critical functionality while reducing complexity.

