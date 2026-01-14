# Manager Identity & Assignment Architecture (Non-Custodial)

## Document Version
**Version**: 2.0 (Aligned with Phase 0-1 Design)  
**Last Updated**: January 2025  
**Classification**: Internal - Technical Architecture Documentation  
**Purpose**: Describe manager onboarding, verification, and user-manager assignment relationships

---

## ⚠️ CRITICAL ALIGNMENT NOTE

**This document has been updated to align with the origin-centered, AccessGrant-driven architecture designed in Phase 0-1.**

### Key Changes from Original:
1. ✅ **Document Access**: Now AccessGrant-driven (not ownership-based)
2. ✅ **Origin Manager Authority**: Immutable custodial authority (not user assignment)
3. ✅ **Admin Access**: Hard-denied (no document-level access)
4. ✅ **Repository Contracts**: AccessGrant-based queries (not ownership-based)
5. ✅ **Audit Metadata**: Origin/access terminology (not ownership language)

### What This Document Covers:
- ✅ Manager onboarding and verification
- ✅ ManagerOrganization + ManagerInstance model
- ✅ UserManagerAssignment (governance relationships)
- ✅ Manager authentication (shared OAuth infrastructure)

### What This Document Does NOT Cover:
- ❌ Document access control (see Phase 1: Access Control Design)
- ❌ AccessGrant system (see Phase 0: Domain Modeling)
- ❌ Document lifecycle (see Phase 2: Document Lifecycle Design)

**For complete system design, refer to Phase 0-2 design documents.**

---

## Executive Summary

This document describes the **Manager Identity & Assignment Architecture** for the HIPAA-compliant Document Identity Management Platform. This document focuses on manager onboarding, verification, and user-manager assignment relationships. **Document access is governed by the AccessGrant system** (see Phase 0-1 design documents), not by user-manager assignments.

**Key Principle**: UserManagerAssignment defines governance/supervision relationships, NOT document access. Document access is determined by AccessGrants and origin manager custodial authority.

**Architecture**: Origin-centered, AccessGrant-driven, RBAC-assisted document access with separate manager-user assignment for governance.

---

## Table of Contents

1. [Current HIPAA-Compliant System Architecture](#1-current-hipaa-compliant-system-architecture)
2. [Current Role System](#2-current-role-system)
3. [Current Document Ownership Model](#3-current-document-ownership-model)
4. [Proposed Manager Role Architecture](#4-proposed-manager-role-architecture)
5. [Data Model Changes Required](#5-data-model-changes-required)
6. [Access Control Logic Changes](#6-access-control-logic-changes)
7. [HIPAA Compliance Considerations](#7-hipaa-compliance-considerations)
8. [Implementation Considerations](#8-implementation-considerations)

---

## 1. Current HIPAA-Compliant System Architecture

### 1.1 Authentication Architecture

The system uses a **mobile-first OAuth 2.0 flow** (not browser redirects):

1. **Client Flow**:
   - Flutter app performs native Google Sign-In / Apple Sign-In
   - Client receives ID token from provider
   - Client sends ID token to Keystone Core API: `POST /v1/auth/google/login` or `POST /v1/auth/apple/login`
   - Server verifies token using provider's public keys
   - Server creates/finds user, creates session, returns JWT + refresh token

2. **Token Structure**:
   - **Access Token (JWT)**: Short-lived (~15 minutes)
     - Payload contains: `{ id: userId, role: roleId, sessionId: sessionHash }`
     - **NO PHI in JWT** (no email, name, health data)
   - **Refresh Token**: Long-lived (~years), tied to session hash
   - **Session**: Database record with random hash, user ID, timestamps

3. **Security Controls**:
   - Session-based authentication (not pure stateless JWT)
   - Rate limiting on auth endpoints (`@nestjs/throttler`)
   - Audit logging via `AuditService` (no PHI in logs)
   - HTTPS enforcement in production
   - Secrets via `ConfigService` (TODO: migrate to GCP Secret Manager)

### 1.2 Authorization Architecture

**Current Implementation**:
- **Role-Based Access Control (RBAC)** using `RolesGuard`
- Roles defined in `src/roles/roles.enum.ts`: `admin = 1`, `user = 2`
- Role checking via `@Roles(RoleEnum.admin)` decorator on controllers
- User entity has `role` field (ManyToOne relationship to `RoleEntity`)

**Access Control Pattern**:
```typescript
// Example: Admin-only endpoint
@Roles(RoleEnum.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Get('/admin/users')
getAllUsers() { ... }
```

### 1.3 Document Processing Architecture

**Module Structure**:
- `src/document-processing/` - Core document domain logic
- `src/document-processing/infrastructure/persistence/` - Repository implementations
- `src/document-processing/infrastructure/storage/` - GCP Cloud Storage adapter
- `src/document-processing/infrastructure/ocr/` - Google Document AI adapter

**Document Lifecycle**:
1. Upload: `POST /v1/documents/upload` → Creates document with `status: UPLOADED`
2. Storage: File uploaded to GCS, document updated to `status: STORED`
3. Processing: Async OCR via Document AI, document updated to `status: PROCESSED`
4. Access: Users can view/download their own documents

**HIPAA Compliance Measures**:
- Documents stored in GCS with encryption at rest
- OCR JSON output stored in PostgreSQL `jsonb` column (encrypted at rest)
- All document access logged via `AuditService`
- No PHI in logs (only `userId`, `documentId`, `event`, `timestamp`)
- Soft deletes with retention period (8 years)
- Signed URLs for downloads (24-hour expiration)

---

## 2. Current Role System

### 2.1 Role Enumeration

**Location**: `src/roles/roles.enum.ts`

```typescript
export enum RoleEnum {
  'admin' = 1,
  'user' = 2,
}
```

**Database Seeding**: `src/database/seeds/relational/role/role-seed.service.ts`
- Seeds `RoleEntity` records with `id: 1` (Admin) and `id: 2` (User)

### 2.2 User-Role Relationship

**User Entity** (`src/users/infrastructure/persistence/relational/entities/user.entity.ts`):
- `role?: RoleEntity` - ManyToOne relationship to `RoleEntity`
- Eager loaded by default
- Role ID stored in JWT payload: `{ id: userId, role: roleId, sessionId }`

### 2.3 Role-Based Access Control

**RolesGuard** (`src/roles/roles.guard.ts`):
- Checks `request.user.role.id` against allowed roles from `@Roles()` decorator
- Returns `true` if user's role ID matches any allowed role

**Current Usage**:
- Admin endpoints: `@Roles(RoleEnum.admin)`
- User endpoints: No decorator (any authenticated user) OR `@Roles(RoleEnum.user)`
- No hierarchical relationships between roles

---

## 3. Document Access Model (Origin-Centered, AccessGrant-Driven)

### 3.1 Document Entity Structure

**Location**: `src/document-processing/infrastructure/persistence/relational/entities/document.entity.ts`

**Key Fields**:
```typescript
@Column({ name: 'origin_manager_id', nullable: false })
originManagerId: number;  // IMMUTABLE - set at creation, never changes

@Column({ name: 'origin_user_context_id', nullable: true })
originUserContextId?: number;  // Optional: user who uploaded (intake context, not ownership)
// Note: originUserContextId is optional, immutable, and visible only to the origin manager and auditors.
```

**Access Model**: **Origin-Centered with AccessGrants**
- Each document has exactly one `originManagerId` (the custodian, immutable)
- Documents are **NOT owned by users** - users hold access grants, not ownership
- Access is resolved via `AccessGrant` table, not ownership
- Origin manager has implicit access (no explicit grant needed)
- All other access requires explicit `AccessGrant` record

### 3.2 Document Access Control (AccessGrant-Driven)

**Correct Authorization Logic** (`src/document-processing/domain/services/document-processing.domain.service.ts`):

```typescript
async getDocument(documentId: string, actorType: 'user' | 'manager', actorId: number): Promise<Document> {
  // Step 1: Get document (no ownership filter)
  const document = await this.documentRepository.findById(documentId);
  if (!document) {
    throw new NotFoundException('Document not found');
  }
  
  // Step 2: Check access via AccessGrant resolution
  const hasAccess = await this.accessGrantService.hasAccess(documentId, actorType, actorId);
  
  if (!hasAccess) {
    // Log unauthorized access attempt
    this.auditService.logAuthEvent({
      actorType,
      actorId,
      event: 'UNAUTHORIZED_DOCUMENT_ACCESS',
      success: false,
      metadata: {
        documentId,
        originManagerId: document.originManagerId,
        accessSubjectType: actorType,
        accessSubjectId: actorId,
      },
    });
    throw new NotFoundException('Document not found');
  }
  
  // Log successful access
  this.auditService.logAuthEvent({
    actorType,
    actorId,
    event: 'DOCUMENT_ACCESSED',
    success: true,
    metadata: {
      documentId,
      originManagerId: document.originManagerId,
      accessSubjectType: actorType,
      accessSubjectId: actorId,
    },
  });
  
  return document;
}
```

**Key Characteristics**:
- **AccessGrant-based resolution**: Access determined by AccessGrant table, not ownership
- **Origin manager implicit access**: Origin manager has access without explicit grant
- **No admin bypass**: Admins have NO document-level access (system-level only)
- **Audit logging**: All access attempts logged with origin/access context
- **No PHI in logs**: Only IDs, event types, timestamps (no ownership language)

### 3.3 Document Listing (AccessGrant-Based)

**Correct Implementation**:
```typescript
async listDocuments(
  actorType: 'user' | 'manager',
  actorId: number,
  options?: { page?: number; limit?: number; status?: DocumentStatus[] }
): Promise<{ data: Document[]; total: number; page: number; limit: number }> {
  // Query documents via AccessGrants, not ownership
  // For origin managers: include documents where originManagerId = actorId
  // For all others: include documents with active AccessGrants
  return this.documentRepository.findByAccessSubject(actorType, actorId, options);
}
```

**Result**: Users and managers see documents they have access grants for (or are origin manager for)

---

## 4. Proposed Manager Role Architecture

### 4.1 Three-Tier Role Hierarchy

**New Role Enum**:
```typescript
export enum RoleEnum {
  'admin' = 1,      // System administrators (unchanged)
  'manager' = 3,    // NEW: Managers who supervise users
  'user' = 2,       // Regular users (unchanged)
}
```

**Role Hierarchy**:
```
Admin (Level 1)
  └─ Full system access (unchanged)
  
Manager (Level 2) - NEW
  └─ Can view/manage documents of assigned users
  └─ Cannot access other managers' users
  └─ Cannot access admin functions
  
User (Level 3)
  └─ Can only access own documents (unchanged)
  └─ Can be assigned to one or more managers
```

### 4.2 Manager-User Relationship Model

**Relationship Type**: **Many-to-Many** (a user can have multiple managers, a manager can have multiple users)

**New Database Table**: `user_manager_assignments`

```sql
CREATE TABLE user_manager_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_by INTEGER REFERENCES users(id), -- Who assigned this (admin or another manager)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP, -- Soft delete
  UNIQUE(user_id, manager_id, deleted_at) -- Prevent duplicate active assignments
);

CREATE INDEX idx_user_manager_assignments_user_id ON user_manager_assignments(user_id);
CREATE INDEX idx_user_manager_assignments_manager_id ON user_manager_assignments(manager_id);
CREATE INDEX idx_user_manager_assignments_deleted_at ON user_manager_assignments(deleted_at);
```

**Key Constraints**:
- A user cannot be assigned to themselves as a manager
- A user with role `user` cannot be a manager (must have role `manager`)
- Soft delete support for assignment history
- Audit trail: `assigned_by` tracks who created the assignment

### 4.3 Document Access Model with Managers (AccessGrant-Driven)

**Correct Access Rules**:

1. **Origin Manager Access**:
   - Managers can access documents where `document.originManagerId === managerId`
   - Implicit access (no AccessGrant needed)
   - Query: `SELECT * FROM documents WHERE id = ? AND origin_manager_id = ?`

2. **Secondary Manager Access**:
   - Managers can access documents where they have active AccessGrant
   - Explicit access only (must have AccessGrant record)
   - Query: `SELECT d.* FROM documents d INNER JOIN access_grants ag ON d.id = ag.document_id WHERE d.id = ? AND ag.subject_type = 'manager' AND ag.subject_id = ? AND ag.revoked_at IS NULL`

3. **User Access**:
   - Users can access documents where they have active AccessGrant
   - Explicit access only (must have AccessGrant record)
   - Query: `SELECT d.* FROM documents d INNER JOIN access_grants ag ON d.id = ag.document_id WHERE d.id = ? AND ag.subject_type = 'user' AND ag.subject_id = ? AND ag.revoked_at IS NULL`

4. **Admin Access** (HARD-DENIED):
   - Admins have NO document-level access
   - Admins can only manage system configuration, managers, policies
   - Query: N/A (admins cannot query documents)

**Correct Authorization Logic** (AccessGrant-Driven):

```typescript
async getDocument(
  documentId: string,
  actorType: 'user' | 'manager',  // Admins excluded - never enter document access flows
  actorId: number
): Promise<Document> {
  // 1. Check if document exists
  const document = await this.documentRepository.findById(documentId);
  if (!document) {
    throw new NotFoundException('Document not found');
  }
  
  // Note: Admins are excluded from all document access flows and never appear as AccessGrant subjects.
  // Admin access is hard-denied at controller/guard level before reaching domain service.
  
  // 3. Check access via AccessGrant resolution
  const hasAccess = await this.accessGrantService.hasAccess(
    documentId,
    actorType,
    actorId
  );
  
  if (!hasAccess) {
    // Audit log unauthorized access
    this.auditService.logAuthEvent({
      actorType,
      actorId,
      event: 'UNAUTHORIZED_DOCUMENT_ACCESS',
      success: false,
      metadata: {
        documentId,
        originManagerId: document.originManagerId,
        accessSubjectType: actorType,
        accessSubjectId: actorId,
      },
    });
    throw new NotFoundException('Document not found');
  }
  
  // Audit log successful access
  this.auditService.logAuthEvent({
    actorType,
    actorId,
    event: 'DOCUMENT_ACCESSED',
    success: true,
    metadata: {
      documentId,
      originManagerId: document.originManagerId,
      accessSubjectType: actorType,
      accessSubjectId: actorId,
    },
  });
  
  return document;
}
```

### 4.4 Document Listing with Managers

**Correct List Logic** (AccessGrant-Driven):

```typescript
async listDocuments(
  actorType: 'user' | 'manager',  // Admins excluded - never enter document access flows
  actorId: number,
  options?: { page?: number; limit?: number; status?: DocumentStatus[] }
): Promise<{ data: Document[]; total: number; page: number; limit: number }> {
  // Note: Admins are excluded from all document access flows and never appear as AccessGrant subjects.
  // Admin access is hard-denied at controller/guard level before reaching domain service.
  
  // List documents via AccessGrants
  // Includes: documents where actor is origin manager OR has active AccessGrant
  return this.documentRepository.findByAccessSubject(actorType, actorId, options);
}
```

**Manager View Considerations**:
- Managers should see which user owns each document
- Response should include `document.userId` and optionally `document.user.email` (if permitted by HIPAA)
- Filtering by assigned user: `GET /v1/documents?assignedUserId=123`

---

## 5. Data Model Changes Required

### 5.1 Role Enum Update

**File**: `src/roles/roles.enum.ts`

```typescript
export enum RoleEnum {
  'admin' = 1,
  'user' = 2,
  'manager' = 3,  // NEW
}
```

**Migration**: Update seed service to create manager role

### 5.2 User Manager Assignment Entity

**New File**: `src/users/infrastructure/persistence/relational/entities/user-manager-assignment.entity.ts`

```typescript
@Entity({ name: 'user_manager_assignments' })
export class UserManagerAssignmentEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;
  
  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;
  
  @Column({ name: 'user_id' })
  userId: number;
  
  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'manager_id' })
  manager: UserEntity;
  
  @Column({ name: 'manager_id' })
  managerId: number;
  
  @Column({ name: 'assigned_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  assignedAt: Date;
  
  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'assigned_by' })
  assignedBy?: UserEntity;
  
  @Column({ name: 'assigned_by', nullable: true })
  assignedById?: number;
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
  
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
  
  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
```

### 5.3 User Entity Extensions (Optional)

**Considerations**:
- Add helper methods to `UserEntity`:
  - `getAssignedManagers()` - Get all managers for this user
  - `getAssignedUsers()` - Get all users assigned to this manager (if role is manager)
- Add validation: User with role `user` cannot be assigned as manager

### 5.4 Document Repository Extensions (AccessGrant-Based)

**Correct Methods Required**:

```typescript
interface DocumentRepositoryPort {
  // Core methods (no ownership assumptions)
  findById(documentId: string): Promise<Document | null>;
  save(document: Document): Promise<Document>;
  update(id: string, partial: Partial<Document>): Promise<void>;
  
  // AccessGrant-based query methods
  findByAccessSubject(
    subjectType: 'user' | 'manager',
    subjectId: number,
    options?: ListOptions
  ): Promise<PaginatedResult<Document>>;
  
  // AccessGrant service handles access resolution
  // Repository only provides data access, not access control
}
```

**Key Principle**: Repository provides data access only. Access resolution belongs in domain service layer via AccessGrantService.

---

## 6. Access Control Logic Changes

### 6.1 Updated Authorization Service

**New Service**: `src/users/domain/services/user-manager-assignment.service.ts`

```typescript
@Injectable()
export class UserManagerAssignmentService {
  /**
   * Check if a manager is assigned to a user (governance relationship only)
   * 
   * ⚠️ CRITICAL: This method must NEVER be used to infer document access.
   * Document access is determined by AccessGrantService, not UserManagerAssignment.
   * This method is for governance/supervision relationships only.
   */
  async isManagerAssignedToUser(
    managerId: number,
    userId: number
  ): Promise<boolean> {
    const assignment = await this.assignmentRepository.findActive(
      userId,
      managerId
    );
    return !!assignment;
  }
  
  /**
   * Get all user IDs assigned to a manager
   */
  async getAssignedUserIds(managerId: number): Promise<number[]> {
    const assignments = await this.assignmentRepository.findByManagerId(managerId);
    return assignments.map(a => a.userId);
  }
  
  /**
   * Assign a user to a manager (admin or manager with permission)
   */
  async assignUserToManager(
    userId: number,
    managerId: number,
    assignedById: number
  ): Promise<UserManagerAssignment> {
    // Validation:
    // - managerId must have role 'manager'
    // - userId cannot be managerId (self-assignment)
    // - Check for existing active assignment
    
    return this.assignmentRepository.create({
      userId,
      managerId,
      assignedById,
      assignedAt: new Date(),
    });
  }
  
  /**
   * Remove assignment (soft delete)
   */
  async removeAssignment(
    userId: number,
    managerId: number
  ): Promise<void> {
    await this.assignmentRepository.softDelete(userId, managerId);
  }
}
```

### 6.2 Updated Document Domain Service

**File**: `src/document-processing/domain/services/document-processing.domain.service.ts`

**Changes**:
1. Inject `UserManagerAssignmentService`
2. Update `getDocument()` to check manager access
3. Update `listDocuments()` to include manager's assigned users
4. Add audit logging for manager access

### 6.3 Updated Controllers

**File**: `src/document-processing/document-processing.controller.ts`

**Changes**:
- Extract `userRole` from JWT payload (already available via `request.user.role.id`)
- Pass `userRole` to domain service methods
- Add manager-specific endpoints (optional):
  - `GET /v1/documents?assignedUserId=123` - Filter by assigned user
  - `GET /v1/documents/assigned-users` - List all assigned user IDs

### 6.4 New Manager Assignment Endpoints

**New Controller**: `src/users/users-manager.controller.ts` (or extend existing)

```typescript
@Controller('v1/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersManagerController {
  /**
   * Assign user to manager (admin only)
   */
  @Post(':userId/assign-manager/:managerId')
  @Roles(RoleEnum.admin)
  async assignManager(
    @Param('userId') userId: number,
    @Param('managerId') managerId: number,
    @Request() req
  ) {
    return this.userManagerAssignmentService.assignUserToManager(
      userId,
      managerId,
      req.user.id
    );
  }
  
  /**
   * List users assigned to a manager
   */
  @Get('managers/:managerId/assigned-users')
  @Roles(RoleEnum.admin, RoleEnum.manager)
  async getAssignedUsers(@Param('managerId') managerId: number) {
    // If requester is manager, only return their own assigned users
    // If requester is admin, return any manager's assigned users
  }
  
  /**
   * Remove assignment
   */
  @Delete(':userId/manager/:managerId')
  @Roles(RoleEnum.admin)
  async removeAssignment(
    @Param('userId') userId: number,
    @Param('managerId') managerId: number
  ) {
    return this.userManagerAssignmentService.removeAssignment(userId, managerId);
  }
}
```

---

## 7. HIPAA Compliance Considerations

### 7.1 Audit Logging Requirements

**Enhanced Audit Events**:

```typescript
// New event types in AuditService
export enum AuthEventType {
  // ... existing events
  MANAGER_ASSIGNMENT_CREATED = 'MANAGER_ASSIGNMENT_CREATED',
  MANAGER_ASSIGNMENT_REMOVED = 'MANAGER_ASSIGNMENT_REMOVED',
  MANAGER_DOCUMENT_ACCESS = 'MANAGER_DOCUMENT_ACCESS', // Specific event for manager access
}
```

**Correct Audit Log Format** (No Ownership Language):
```json
{
  "timestamp": "2025-01-20T10:30:00Z",
  "service": "keystone-core-api",
  "component": "document-processing",
  "actorType": "manager",
  "actorId": 5,
  "event": "DOCUMENT_ACCESSED",
  "success": true,
  "metadata": {
    "documentId": "uuid-here",
    "originManagerId": 3,  // Origin manager (custodian)
    "accessSubjectType": "manager",
    "accessSubjectId": 5,  // Manager accessing document
    "accessType": "explicit_grant"  // or "implicit_origin" if origin manager
  }
}
```

**HIPAA Requirements**:
- ✅ Log who accessed what document (actor ID, origin manager ID)
- ✅ Log when access occurred
- ✅ Log access type (implicit origin vs explicit grant)
- ✅ NO PHI in logs (no document contents, no user names/emails in logs)
- ✅ NO ownership language (use origin/access terminology)
- ✅ Retention: 6+ years (forward to GCP Cloud Logging)

### 7.2 Access Control Validation

**Business Rules**:
1. **Manager Role Validation**: Only users with `role.id === RoleEnum.manager` can be assigned as managers
2. **Self-Assignment Prevention**: A user cannot be assigned to themselves
3. **Circular Assignment Prevention**: A manager cannot be assigned to another manager (unless explicitly allowed)
4. **Assignment History**: Track who assigned the relationship (`assigned_by`)
5. **Soft Delete**: Preserve assignment history for audit (soft delete, not hard delete)

### 7.3 Data Minimization

**Manager View of Documents** (AccessGrant-Based):
- Managers can see documents they have AccessGrants for (or are origin manager for)
- Managers can see document metadata (filename, type, status, dates)
- Managers can see extracted fields (OCR results) - read-only if secondary manager
- Managers can download documents (if granted) via signed URLs
- **Access is explicit**: No automatic access from UserManagerAssignment

**User Information Visibility**:
- Managers see `originUserContextId` if document was uploaded by user (intake context)
- **Note**: This is context, not ownership
- **HIPAA Note**: Email/name are PII, not PHI, but still sensitive
- **Recommendation**: Include user ID only, no names/emails in document responses
- **Audit**: Log when manager views document (includes originUserContextId if present)

### 7.4 Encryption & Storage

**No Changes Required**:
- Documents still encrypted at rest in GCS
- Database still encrypted at rest (PostgreSQL)
- Signed URLs still time-limited (24 hours)
- All existing encryption measures remain

**New Considerations**:
- Assignment table contains user IDs (not PHI, but still sensitive)
- Ensure assignment table is included in database encryption
- Consider encrypting `assigned_by` field if it contains sensitive audit info

---

## 8. Implementation Considerations

### 8.1 Backward Compatibility

**Critical**: Existing users and documents must continue to work

**Migration Strategy**:
1. Add `manager = 3` to `RoleEnum` (non-breaking)
2. Create `user_manager_assignments` table (new table, no impact on existing)
3. Update document access logic to check manager assignments (backward compatible if no assignments exist)
4. Existing users continue to work as before (no assignments = no manager access)

**Rollout Plan**:
1. Deploy database migration (add table, add role)
2. Deploy code changes (new logic, but defaults to old behavior)
3. Assign managers to users via admin interface
4. Test manager access
5. Monitor audit logs

### 8.2 Performance Considerations

**Query Optimization**:
- Index on `user_manager_assignments(manager_id, deleted_at)` for fast manager lookups
- Index on `user_manager_assignments(user_id, deleted_at)` for reverse lookups
- Consider caching manager assignments in Redis (if implemented)
- Batch queries: When listing documents for manager, use `IN (SELECT ...)` or JOIN

**Example Optimized Query** (AccessGrant-Based):
```sql
-- Get all documents accessible to a manager
-- Includes: documents where manager is origin OR has active AccessGrant
SELECT DISTINCT d.*
FROM documents d
LEFT JOIN access_grants ag ON d.id = ag.document_id
WHERE (
  -- Origin manager implicit access
  d.origin_manager_id = ?
  OR (
    -- Explicit AccessGrant
    ag.subject_type = 'manager'
    AND ag.subject_id = ?
    AND ag.revoked_at IS NULL
  )
)
AND d.deleted_at IS NULL
ORDER BY d.created_at DESC
LIMIT ? OFFSET ?;
```

### 8.3 API Versioning

**Current API**: `/v1/documents/*`

**Considerations**:
- New manager endpoints could be `/v1/managers/*` or `/v1/users/*/managers/*`
- Document endpoints remain `/v1/documents/*` but behavior changes based on role
- No breaking changes to existing endpoints (backward compatible)

### 8.4 Testing Strategy

**Unit Tests**:
- `UserManagerAssignmentService` methods
- `DocumentProcessingDomainService.getDocument()` with manager role
- `DocumentProcessingDomainService.listDocuments()` with manager role
- Role validation logic

**Integration Tests**:
- Assign user to manager → Manager can access user's documents
- Remove assignment → Manager loses access
- Manager cannot access non-assigned user's documents
- User still has access to own documents (unchanged)

**E2E Tests**:
- Full flow: Assign → Access → Remove → Verify access lost
- Multiple managers for one user
- One manager with multiple users
- Audit log verification

### 8.5 Documentation Updates

**Required Updates**:
1. `docs/authentication.md` - Document manager role
2. `docs/document-processing.md` - Document manager access patterns
3. API docs (Swagger) - New endpoints, updated responses
4. `.env.example` - No new env vars needed (role-based, not config-based)

---

## Summary

### Current State (Aligned with Phase 0-1 Design)
- **Origin-centered document model**: Documents have immutable originManagerId
- **AccessGrant-driven access**: All access (except origin manager) requires explicit AccessGrant
- **Manager-user assignment**: Separate governance relationship (not document access)
- **HIPAA-compliant**: Audit logging, encryption, no PHI in logs
- **No admin document access**: Admins have system-level authority only

### Architecture Alignment
- **ManagerOrganization + ManagerInstance**: Canonical org identity + specific instances
- **UserManagerAssignment**: Governance/supervision (separate from AccessGrants)
- **AccessGrants**: Document-level permissions (separate from assignments)
- **Origin Manager Authority**: Immutable custodial authority
- **Enhanced audit logging**: Track access by origin/access context (not ownership)

### Key Implementation Points (Aligned with Phase 0-1)
1. Implement ManagerOrganization + ManagerInstance entities
2. Create `user_manager_assignments` table (governance only, not access)
3. Implement AccessGrant system for document access resolution
4. Update document access logic to use AccessGrants (not ownership)
5. Hard deny admin document access
6. Update repository contracts to remove ownership-based methods
7. Update audit logging to use origin/access terminology (not ownership)
8. Maintain all HIPAA compliance measures

### HIPAA Compliance Maintained
- ✅ Access control: All access (manager, user) resolved via AccessGrants, fully audited
- ✅ Audit logging: All access events logged with origin/access context (no ownership language)
- ✅ Encryption: No changes to encryption (documents, database)
- ✅ Data minimization: Managers see only documents they have AccessGrants for
- ✅ No PHI in logs: Only IDs, timestamps, event types
- ✅ Origin authority preserved: Immutable origin manager custodial authority

---

**Next Steps for Implementation**:
1. Review this architecture document
2. Create database migration for `user_manager_assignments` table
3. Update `RoleEnum` and seed service
4. Implement `UserManagerAssignmentService`
5. Update `DocumentProcessingDomainService` access logic
6. Add manager assignment endpoints
7. Update audit logging
8. Write tests (unit, integration, E2E)
9. Update documentation

---

**Document Prepared For**: LLM Implementation  
**Review Cycle**: Before implementation begins  
**Questions/Clarifications**: Address before coding

