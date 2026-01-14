# PHASE 5: Implementation Plan - Document Identity Management Platform

## Document Version
**Version**: 1.0  
**Phase**: 5 - Implementation Plan  
**Status**: Ready for Implementation  
**Classification**: Internal - Implementation Roadmap

---

## Executive Summary

This document provides the complete implementation roadmap for the HIPAA-compliant Document Identity Management Platform. It breaks down the work from Phases 0-4 and the Manager Role Architecture into incremental, testable modules that can be implemented and deployed independently.

**Key Principle**: Implement incrementally, test thoroughly, maintain HIPAA compliance at every step. Each module builds on previous work and can be validated independently.

**Implementation Strategy**: Bottom-up approach - start with foundational entities and domain models, then build access control, then API surface, then audit integration.

---

## Table of Contents

1. [Implementation Overview](#1-implementation-overview)
2. [Module Dependencies](#2-module-dependencies)
3. [Implementation Modules](#3-implementation-modules)
4. [Testing Strategy](#4-testing-strategy)
5. [Deployment Strategy](#5-deployment-strategy)
6. [Risk Mitigation](#6-risk-mitigation)
7. [Success Criteria](#7-success-criteria)

---

## 1. Implementation Overview

### 1.1 Current State Assessment

**Already Implemented**:
- ✅ Authentication infrastructure (Google, Apple, Facebook OAuth)
- ✅ User entity and persistence (PostgreSQL)
- ✅ Role system (admin, user) with RBAC guards
- ✅ Session management with refresh tokens
- ✅ Document processing module (basic structure)
- ✅ Audit service (basic structure)
- ✅ File storage infrastructure (GCS adapter)
- ✅ OCR infrastructure (Google Document AI adapter)

**Not Yet Implemented** (from Phases 0-4):
- ❌ Manager role (RoleEnum.manager = 3)
- ❌ ManagerOrganization + ManagerInstance entities
- ❌ UserManagerAssignment entity and service
- ❌ AccessGrant entity and service
- ❌ Document originManagerId field and immutability
- ❌ AccessGrant-driven document access resolution
- ❌ Revocation workflow (RevocationRequest entity)
- ❌ Complete audit event taxonomy (40+ event types)
- ❌ GCP Cloud Logging integration
- ❌ Audit query endpoints
- ❌ Manager assignment endpoints
- ❌ Access grant endpoints
- ❌ Revocation request endpoints

### 1.2 Implementation Phases

**Phase 5.1: Foundation** (Week 1-2)
- Manager role and entities
- AccessGrant entity and basic service
- Document originManagerId migration
- Database migrations

**Phase 5.2: Access Control Core** (Week 3-4)
- AccessGrant resolution service
- Document access control refactoring
- Manager assignment service
- Authorization guards updates

**Phase 5.3: Document Lifecycle** (Week 5-6)
- Document state machine enforcement
- OCR authority rules
- Re-share behavior
- Retention policy implementation

**Phase 5.4: API Surface** (Week 7-8)
- Access grant endpoints
- Revocation request endpoints
- Manager assignment endpoints
- Document endpoint updates

**Phase 5.5: Audit & Compliance** (Week 9-10)
- Complete audit event taxonomy
- PHI sanitization
- GCP Cloud Logging integration
- Audit query endpoints

**Phase 5.6: Testing & Hardening** (Week 11-12)
- E2E test suite
- Performance testing
- Security audit
- Documentation updates

---

## 2. Module Dependencies

### 2.1 Dependency Graph

```
Phase 5.1 (Foundation)
  ├─ Manager Role (RoleEnum.manager = 3)
  ├─ ManagerOrganization Entity
  ├─ ManagerInstance Entity
  ├─ UserManagerAssignment Entity
  ├─ AccessGrant Entity
  └─ Document.originManagerId Migration
      │
      ▼
Phase 5.2 (Access Control Core)
  ├─ AccessGrantService (depends on AccessGrant Entity)
  ├─ DocumentAccessService (depends on AccessGrantService)
  ├─ UserManagerAssignmentService (depends on UserManagerAssignment Entity)
  └─ Authorization Guards Updates (depends on all above)
      │
      ▼
Phase 5.3 (Document Lifecycle)
  ├─ Document State Machine (depends on Document entity)
  ├─ OCR Authority Rules (depends on Access Control)
  └─ Retention Policy (depends on Document entity)
      │
      ▼
Phase 5.4 (API Surface)
  ├─ Access Grant Endpoints (depends on AccessGrantService)
  ├─ Revocation Request Endpoints (depends on RevocationRequest Entity)
  ├─ Manager Assignment Endpoints (depends on UserManagerAssignmentService)
  └─ Document Endpoint Updates (depends on DocumentAccessService)
      │
      ▼
Phase 5.5 (Audit & Compliance)
  ├─ Audit Event Taxonomy (depends on all modules)
  ├─ PHI Sanitization (depends on AuditService)
  ├─ GCP Cloud Logging (depends on AuditService)
  └─ Audit Query Endpoints (depends on AuditService)
      │
      ▼
Phase 5.6 (Testing & Hardening)
  └─ All modules tested together
```

### 2.2 Critical Path

**Must Complete in Order**:
1. Phase 5.1 (Foundation) - No dependencies
2. Phase 5.2 (Access Control Core) - Depends on 5.1
3. Phase 5.3 (Document Lifecycle) - Depends on 5.2
4. Phase 5.4 (API Surface) - Depends on 5.2 and 5.3
5. Phase 5.5 (Audit & Compliance) - Depends on all previous
6. Phase 5.6 (Testing & Hardening) - Depends on all previous

---

## 3. Implementation Modules

### 3.1 Phase 5.1: Foundation

#### Module 5.1.1: Manager Role & Entities

**Files to Create**:
- `src/roles/roles.enum.ts` (update: add `manager = 3`)
- `src/database/seeds/relational/role/role-seed.service.ts` (update: seed manager role)
- `src/managers/domain/entities/manager-organization.entity.ts` (new)
- `src/managers/domain/entities/manager-instance.entity.ts` (new)
- `src/managers/infrastructure/persistence/relational/entities/manager-organization.entity.ts` (new)
- `src/managers/infrastructure/persistence/relational/entities/manager-instance.entity.ts` (new)
- `src/managers/managers.module.ts` (new)

**Database Migration**:
```sql
-- Add manager role
INSERT INTO roles (id, name) VALUES (3, 'manager') ON CONFLICT (id) DO NOTHING;

-- Create manager_organizations table
CREATE TABLE manager_organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  verification_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMP,
  verified_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- Create manager_instances table
CREATE TABLE manager_instances (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES manager_organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  UNIQUE(organization_id, user_id, deleted_at)
);
```

**Acceptance Criteria**:
- ✅ Manager role exists in RoleEnum and database
- ✅ ManagerOrganization entity with verification status
- ✅ ManagerInstance entity linking organization to user
- ✅ Database migrations run successfully
- ✅ Seed service creates manager role

#### Module 5.1.2: UserManagerAssignment Entity

**Files to Create**:
- `src/users/domain/entities/user-manager-assignment.entity.ts` (new)
- `src/users/infrastructure/persistence/relational/entities/user-manager-assignment.entity.ts` (new)
- `src/users/domain/repositories/user-manager-assignment.repository.port.ts` (new)
- `src/users/infrastructure/persistence/relational/repositories/user-manager-assignment.repository.ts` (new)

**Database Migration**:
```sql
CREATE TABLE user_manager_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  UNIQUE(user_id, manager_id, deleted_at)
);

CREATE INDEX idx_user_manager_assignments_user_id ON user_manager_assignments(user_id);
CREATE INDEX idx_user_manager_assignments_manager_id ON user_manager_assignments(manager_id);
CREATE INDEX idx_user_manager_assignments_deleted_at ON user_manager_assignments(deleted_at);
```

**Acceptance Criteria**:
- ✅ UserManagerAssignment entity with soft delete
- ✅ Repository with findActive, findByManagerId, findByUserId methods
- ✅ Validation: user cannot be assigned to themselves
- ✅ Validation: manager must have role 'manager'

#### Module 5.1.3: AccessGrant Entity

**Files to Create**:
- `src/access-control/domain/entities/access-grant.entity.ts` (new)
- `src/access-control/infrastructure/persistence/relational/entities/access-grant.entity.ts` (new)
- `src/access-control/domain/repositories/access-grant.repository.port.ts` (new)
- `src/access-control/infrastructure/persistence/relational/repositories/access-grant.repository.ts` (new)
- `src/access-control/access-control.module.ts` (new)

**Database Migration**:
```sql
CREATE TABLE access_grants (
  id SERIAL PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('user', 'manager')),
  subject_id INTEGER NOT NULL,
  grant_type VARCHAR(20) NOT NULL CHECK (grant_type IN ('owner', 'delegated', 'derived')),
  granted_by_type VARCHAR(20) NOT NULL CHECK (granted_by_type IN ('user', 'manager')),
  granted_by_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP,
  revoked_by_type VARCHAR(20),
  revoked_by_id INTEGER,
  UNIQUE(document_id, subject_type, subject_id, revoked_at)
);

CREATE INDEX idx_access_grants_document_id ON access_grants(document_id);
CREATE INDEX idx_access_grants_subject ON access_grants(subject_type, subject_id);
CREATE INDEX idx_access_grants_revoked_at ON access_grants(revoked_at);
```

**Acceptance Criteria**:
- ✅ AccessGrant entity with subject_type, subject_id, grant_type
- ✅ Repository with findActive, findByDocument, findBySubject methods
- ✅ Soft revocation (revoked_at timestamp)
- ✅ Unique constraint on (document_id, subject_type, subject_id, revoked_at)

#### Module 5.1.4: Document originManagerId Migration

**Files to Update**:
- `src/document-processing/infrastructure/persistence/relational/entities/document.entity.ts` (add originManagerId, originUserContextId)
- `src/document-processing/domain/entities/document.entity.ts` (add originManagerId, originUserContextId)

**Database Migration**:
```sql
-- Add origin manager fields to documents
ALTER TABLE documents
  ADD COLUMN origin_manager_id INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN origin_user_context_id INTEGER;

-- Update existing documents (set origin_manager_id to a default manager or require migration)
-- NOTE: This requires business logic to determine origin manager for existing documents

-- Add foreign key constraint
ALTER TABLE documents
  ADD CONSTRAINT fk_documents_origin_manager
  FOREIGN KEY (origin_manager_id) REFERENCES users(id);

-- Add index
CREATE INDEX idx_documents_origin_manager_id ON documents(origin_manager_id);

-- Make origin_manager_id immutable (application-level enforcement)
-- Add CHECK constraint to prevent updates (PostgreSQL doesn't support immutable columns)
-- Application must enforce: originManagerId cannot be updated after creation
```

**Acceptance Criteria**:
- ✅ Document entity has originManagerId (required, immutable)
- ✅ Document entity has originUserContextId (optional, immutable)
- ✅ Database migration runs successfully
- ✅ Application enforces immutability (no updates to originManagerId)

---

### 3.2 Phase 5.2: Access Control Core

#### Module 5.2.1: AccessGrantService

**Files to Create**:
- `src/access-control/domain/services/access-grant.domain.service.ts` (new)
- `src/access-control/dto/create-access-grant.dto.ts` (new)
- `src/access-control/dto/revoke-access-grant.dto.ts` (new)

**Key Methods**:
```typescript
class AccessGrantDomainService {
  async createGrant(dto: CreateAccessGrantDto): Promise<AccessGrant>;
  async revokeGrant(grantId: number, revokedBy: Actor): Promise<void>;
  async hasAccess(documentId: string, actorType: 'user' | 'manager', actorId: number): Promise<boolean>;
  async getActiveGrants(documentId: string): Promise<AccessGrant[]>;
  async getActiveGrantsForSubject(subjectType: 'user' | 'manager', subjectId: number): Promise<AccessGrant[]>;
}
```

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

**Acceptance Criteria**:
- ✅ AccessGrantService resolves access correctly
- ✅ Origin manager has implicit access (no grant needed)
- ✅ Other actors require explicit AccessGrant
- ✅ Revocation sets revoked_at (soft delete)
- ✅ Cascade revocation logic (if required by design)

#### Module 5.2.2: DocumentAccessService

**Files to Create**:
- `src/document-processing/domain/services/document-access.domain.service.ts` (new)

**Key Methods**:
```typescript
class DocumentAccessDomainService {
  async getDocument(documentId: string, actor: Actor): Promise<Document>;
  async listDocuments(actor: Actor, options?: ListOptions): Promise<PaginatedResult<Document>>;
  async canPerformOperation(documentId: string, operation: Operation, actor: Actor): Promise<boolean>;
}
```

**Authorization Logic**:
- Implements access decision matrix from Phase 1
- Uses AccessGrantService for access resolution
- Enforces origin manager authority rules
- Hard denies admin document access

**Acceptance Criteria**:
- ✅ getDocument() enforces access control
- ✅ listDocuments() filters by AccessGrants
- ✅ canPerformOperation() implements Phase 1 decision matrix
- ✅ Admins are hard-denied (403 before domain service)

#### Module 5.2.3: UserManagerAssignmentService

**Files to Create**:
- `src/users/domain/services/user-manager-assignment.service.ts` (new)
- `src/users/dto/create-user-manager-assignment.dto.ts` (new)

**Key Methods**:
```typescript
class UserManagerAssignmentService {
  async assignUserToManager(userId: number, managerId: number, assignedById: number): Promise<UserManagerAssignment>;
  async removeAssignment(userId: number, managerId: number): Promise<void>;
  async isManagerAssignedToUser(managerId: number, userId: number): Promise<boolean>;
  async getAssignedUserIds(managerId: number): Promise<number[]>;
  async getAssignedManagerIds(userId: number): Promise<number[]>;
}
```

**Acceptance Criteria**:
- ✅ Assignment creation with validation
- ✅ Self-assignment prevention
- ✅ Manager role validation
- ✅ Soft delete on removal
- ✅ Audit logging on assignment changes

#### Module 5.2.4: Authorization Guards Updates

**Files to Update**:
- `src/roles/roles.guard.ts` (update: handle manager role)
- `src/document-processing/document-processing.controller.ts` (update: hard deny admins)
- Create new guards if needed:
  - `src/document-processing/guards/document-access.guard.ts` (new, optional)

**Changes**:
- Update RolesGuard to recognize RoleEnum.manager
- Add admin hard-deny logic to document endpoints
- Extract actor from JWT (user/manager/admin)
- Pass actor to domain services

**Acceptance Criteria**:
- ✅ RolesGuard recognizes manager role
- ✅ Document endpoints hard-deny admins (403 before domain service)
- ✅ Actor type correctly extracted from JWT
- ✅ Actor passed to domain services

---

### 3.3 Phase 5.3: Document Lifecycle

#### Module 5.3.1: Document State Machine

**Files to Update**:
- `src/document-processing/domain/services/document-processing.domain.service.ts` (update: enforce state machine)
- `src/document-processing/domain/entities/document.entity.ts` (update: add state transition methods)

**State Transitions** (from Phase 2):
- UPLOADED → STORED (file stored to GCS)
- STORED → PROCESSING (OCR triggered)
- PROCESSING → PROCESSED (OCR success)
- PROCESSING → ERROR (OCR failure)
- ERROR → PROCESSING (retry)

**Enforcement**:
- State transitions validated in domain service
- Invalid transitions throw BadRequestException
- State machine rules from Phase 2 enforced

**Acceptance Criteria**:
- ✅ State machine transitions validated
- ✅ Invalid transitions rejected
- ✅ State history tracked (optional, for audit)

#### Module 5.3.2: OCR Authority Rules

**Files to Update**:
- `src/document-processing/domain/services/document-processing.domain.service.ts` (update: OCR trigger method)

**Rules** (from Phase 2):
- Only origin manager can trigger OCR
- OCR processing is async (queue-based)
- Processing method determined by document size/type
- Retry logic for failed processing

**Acceptance Criteria**:
- ✅ Only origin manager can trigger OCR
- ✅ Other actors (users, secondary managers) cannot trigger OCR
- ✅ OCR processing is async
- ✅ Retry logic implemented

#### Module 5.3.3: Retention Policy

**Files to Update**:
- `src/document-processing/domain/services/document-processing.domain.service.ts` (update: add retention logic)
- Create background job:
  - `src/document-processing/jobs/document-retention.job.ts` (new)

**Retention Rules** (from Phase 0):
- Default retention: 8 years
- Configurable per document type
- scheduledDeletionAt set at creation
- Hard delete after retention period
- Background job runs daily to delete expired documents

**Acceptance Criteria**:
- ✅ scheduledDeletionAt set at document creation
- ✅ Retention period configurable
- ✅ Background job deletes expired documents
- ✅ Audit log created on hard delete

---

### 3.4 Phase 5.4: API Surface

#### Module 5.4.1: Access Grant Endpoints

**Files to Create**:
- `src/access-control/access-control.controller.ts` (new)
- `src/access-control/dto/list-access-grants.dto.ts` (new)

**Endpoints** (from Phase 3):
- `POST /v1/access-grants` - Create access grant
- `GET /v1/access-grants?documentId=uuid` - List grants for document
- `DELETE /v1/access-grants/:id` - Revoke access grant
- `GET /v1/access-grants/my-grants` - List my active grants

**Authorization**:
- Create: Origin manager or user with delegated grant authority
- List: Origin manager (all grants) or grant subject (own grants)
- Revoke: Origin manager or grant creator (for delegated grants)

**Acceptance Criteria**:
- ✅ All endpoints implemented per Phase 3 spec
- ✅ Authorization enforced correctly
- ✅ Audit events logged
- ✅ DTOs validated

#### Module 5.4.2: Revocation Request Endpoints

**Files to Create**:
- `src/revocation/domain/entities/revocation-request.entity.ts` (new)
- `src/revocation/infrastructure/persistence/relational/entities/revocation-request.entity.ts` (new)
- `src/revocation/domain/services/revocation.domain.service.ts` (new)
- `src/revocation/revocation.controller.ts` (new)
- `src/revocation/revocation.module.ts` (new)

**Database Migration**:
```sql
CREATE TABLE revocation_requests (
  id SERIAL PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL REFERENCES documents(id),
  requested_by_type VARCHAR(20) NOT NULL CHECK (requested_by_type IN ('user', 'manager')),
  requested_by_id INTEGER NOT NULL,
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('self_revocation', 'user_revocation', 'manager_revocation')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  cascade_to_secondary_managers BOOLEAN NOT NULL DEFAULT false,
  review_notes TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);
```

**Endpoints** (from Phase 3):
- `POST /v1/revocation-requests` - Create revocation request
- `GET /v1/revocation-requests?documentId=uuid` - List requests
- `PATCH /v1/revocation-requests/:id/approve` - Approve request (origin manager only)
- `PATCH /v1/revocation-requests/:id/deny` - Deny request (origin manager only)
- `DELETE /v1/revocation-requests/:id` - Cancel request (requester only)

**Acceptance Criteria**:
- ✅ All endpoints implemented per Phase 3 spec
- ✅ Workflow state machine enforced
- ✅ Origin manager approval required
- ✅ Cascade revocation logic (if approved)

#### Module 5.4.3: Manager Assignment Endpoints

**Files to Create**:
- `src/users/users-manager.controller.ts` (new) OR extend `src/users/users.controller.ts`

**Endpoints** (from manager-role-architecture.md):
- `POST /v1/users/:userId/assign-manager/:managerId` - Assign user to manager (admin only)
- `GET /v1/users/managers/:managerId/assigned-users` - List assigned users
- `DELETE /v1/users/:userId/manager/:managerId` - Remove assignment (admin only)

**Acceptance Criteria**:
- ✅ All endpoints implemented
- ✅ Admin-only authorization enforced
- ✅ Validation: manager role, no self-assignment
- ✅ Audit events logged

#### Module 5.4.4: Document Endpoint Updates

**Files to Update**:
- `src/document-processing/document-processing.controller.ts` (update: add originManagerId to upload, enforce access control)

**Changes**:
- `POST /v1/documents/upload` - Require originManagerId in request
- `GET /v1/documents` - Filter by AccessGrants (not ownership)
- `GET /v1/documents/:id` - Enforce access control via AccessGrantService
- `GET /v1/documents/:id/download` - Enforce access control
- `POST /v1/documents/:id/trigger-ocr` - Only origin manager

**Acceptance Criteria**:
- ✅ Upload requires originManagerId
- ✅ List filters by AccessGrants
- ✅ Get enforces access control
- ✅ OCR trigger restricted to origin manager
- ✅ All operations audit logged

---

### 3.5 Phase 5.5: Audit & Compliance

#### Module 5.5.1: Complete Audit Event Taxonomy

**Files to Update**:
- `src/audit/audit.service.ts` (update: add all event types from Phase 4)
- `src/audit/domain/entities/audit-event.entity.ts` (new)
- `src/audit/audit-event-type.enum.ts` (new)

**Event Types** (from Phase 4):
- Document lifecycle: DOCUMENT_UPLOADED, DOCUMENT_INTAKE_BY_USER, DOCUMENT_STORED, DOCUMENT_PROCESSING_STARTED, etc.
- Access control: ACCESS_GRANTED, ACCESS_REVOKED, DOCUMENT_VIEWED, DOCUMENT_DOWNLOADED, etc.
- Revocation workflow: REVOCATION_REQUESTED, REVOCATION_APPROVED, REVOCATION_DENIED, etc.
- Authority violations: UNAUTHORIZED_ACCESS_ATTEMPT, ORIGIN_AUTHORITY_VIOLATION, etc.
- System events: MANAGER_ASSIGNMENT_CREATED, MANAGER_VERIFIED, etc.

**Acceptance Criteria**:
- ✅ All 40+ event types defined
- ✅ Event type enum matches Phase 4 taxonomy
- ✅ Event creation methods for each category

#### Module 5.5.2: PHI Sanitization

**Files to Create**:
- `src/audit/utils/phi-sanitizer.ts` (new)

**Sanitization Functions** (from Phase 4):
- `sanitizeErrorMessage()` - Remove emails, tokens, SSN patterns
- `sanitizeUserAgent()` - Truncate to 200 chars
- `sanitizeMetadata()` - Remove field values, user names, PHI

**Integration**:
- AuditService calls sanitizers before logging
- All metadata sanitized before storage
- Error messages sanitized

**Acceptance Criteria**:
- ✅ All sanitization functions implemented
- ✅ PHI patterns removed from logs
- ✅ No PHI in audit events (verified by tests)

#### Module 5.5.3: GCP Cloud Logging Integration

**Files to Create**:
- `src/audit/infrastructure/cloud-logging.client.ts` (new)
- `src/audit/config/cloud-logging.config.ts` (new)

**Integration**:
- Async, non-blocking forward to Cloud Logging
- Retry logic with exponential backoff
- Dead letter queue for failed events
- Log structure matches Phase 4 spec

**Configuration**:
- GCP project ID from env
- Log name: `keystone-core-api-audit`
- Retention: 7 years (configured in GCP)

**Acceptance Criteria**:
- ✅ Events forwarded to Cloud Logging (async)
- ✅ Retry logic implemented
- ✅ Failed events handled gracefully
- ✅ Log structure matches Phase 4 spec

#### Module 5.5.4: Audit Query Endpoints

**Files to Create**:
- `src/audit/audit.controller.ts` (new)

**Endpoints** (from Phase 4):
- `GET /v1/audit/events` - Query audit events (admin or origin manager)
- `GET /v1/audit/events/:id` - Get specific event
- `GET /v1/audit/reports/access` - Generate access report (CSV/JSON)

**Authorization**:
- Admins: Can query all events
- Origin managers: Can query events for their documents only
- Users: No access

**Query Parameters**:
- eventType, documentId, actorType, actorId, originManagerId
- startDate, endDate, success, page, limit

**Acceptance Criteria**:
- ✅ All endpoints implemented per Phase 4 spec
- ✅ Authorization enforced correctly
- ✅ Query filtering works (origin managers see only their documents)
- ✅ Reports generated in CSV/JSON format

---

### 3.6 Phase 5.6: Testing & Hardening

#### Module 5.6.1: E2E Test Suite

**Files to Create**:
- `test/access-control/access-grant.e2e-spec.ts` (new)
- `test/access-control/document-access.e2e-spec.ts` (new)
- `test/revocation/revocation-request.e2e-spec.ts` (new)
- `test/managers/manager-assignment.e2e-spec.ts` (new)
- `test/audit/audit-query.e2e-spec.ts` (new)

**Test Scenarios**:
- Access grant creation and revocation
- Document access enforcement (origin manager, granted access, denied access)
- Revocation workflow (request, approve, deny, cancel)
- Manager assignment and document access
- Audit event creation and querying
- PHI sanitization verification

**Acceptance Criteria**:
- ✅ All critical paths covered by E2E tests
- ✅ Tests run in CI/CD pipeline
- ✅ Tests verify HIPAA compliance (no PHI in logs)

#### Module 5.6.2: Performance Testing

**Files to Create**:
- `test/performance/access-resolution.benchmark.ts` (new)
- `test/performance/document-listing.benchmark.ts` (new)

**Performance Targets**:
- Access resolution: < 50ms (with database indexes)
- Document listing: < 200ms (100 documents)
- Audit event creation: < 10ms (synchronous)
- Cloud Logging forward: Non-blocking (async)

**Acceptance Criteria**:
- ✅ Performance benchmarks meet targets
- ✅ Database indexes optimized
- ✅ Query performance acceptable

#### Module 5.6.3: Security Audit

**Checklist**:
- ✅ No PHI in logs (automated test)
- ✅ No PHI in JWT payloads
- ✅ Access control enforced at all layers
- ✅ Admin hard-deny verified
- ✅ Origin manager immutability enforced
- ✅ SQL injection prevention (parameterized queries)
- ✅ XSS prevention (input sanitization)
- ✅ Rate limiting on all endpoints
- ✅ HTTPS enforcement in production

**Acceptance Criteria**:
- ✅ Security audit checklist completed
- ✅ All vulnerabilities addressed
- ✅ HIPAA compliance verified

#### Module 5.6.4: Documentation Updates

**Files to Update**:
- `docs/authentication.md` - Document manager role
- `docs/document-processing.md` - Document access patterns, origin manager authority
- `docs/access-control.md` (new) - AccessGrant system documentation
- `docs/audit.md` (new) - Audit logging documentation
- `README.md` - Update with new features
- API docs (Swagger) - All new endpoints documented

**Acceptance Criteria**:
- ✅ All documentation updated
- ✅ API docs complete
- ✅ Architecture diagrams updated (if applicable)

---

## 4. Testing Strategy

### 4.1 Unit Tests

**Coverage Targets**:
- Domain services: 90%+
- Repository implementations: 85%+
- DTOs: 100% (validation)
- Guards: 90%+

**Key Test Areas**:
- AccessGrantService access resolution logic
- DocumentAccessService authorization rules
- PHI sanitization functions
- State machine transitions
- Retention policy calculations

### 4.2 Integration Tests

**Test Scenarios**:
- Database migrations run successfully
- Entity relationships work correctly
- Repository queries return expected results
- Transaction rollback on errors
- Soft delete functionality

### 4.3 E2E Tests

**Critical Paths**:
1. User uploads document → Origin manager assigned → Access granted → Document accessed
2. Manager assigns user → User uploads document → Manager accesses document
3. User requests revocation → Origin manager approves → Access revoked
4. Audit events created → Queryable by admin/origin manager

### 4.4 HIPAA Compliance Tests

**Automated Checks**:
- No PHI in audit logs (pattern matching)
- No PHI in JWT payloads
- Access control enforced (unauthorized requests rejected)
- Audit events created for all mutations
- Immutability enforced (originManagerId cannot be updated)

---

## 5. Deployment Strategy

### 5.1 Database Migrations

**Migration Order**:
1. Phase 5.1.1: Manager role and entities
2. Phase 5.1.2: UserManagerAssignment table
3. Phase 5.1.3: AccessGrant table
4. Phase 5.1.4: Document originManagerId fields
5. Phase 5.3.3: RevocationRequest table (if not in 5.4.2)

**Migration Safety**:
- All migrations backward compatible (additive only)
- No data loss
- Rollback scripts prepared
- Tested in staging first

### 5.2 Feature Flags

**Consider Feature Flags For**:
- AccessGrant system (gradual rollout)
- Manager role (enable for specific users first)
- Revocation workflow (beta testing)
- GCP Cloud Logging (canary deployment)

### 5.3 Deployment Phases

**Phase 1: Foundation** (Week 1-2)
- Deploy database migrations
- Deploy manager role and entities
- Monitor for errors

**Phase 2: Access Control** (Week 3-4)
- Deploy AccessGrant system
- Deploy document access refactoring
- Enable for new documents only (feature flag)

**Phase 3: API Surface** (Week 7-8)
- Deploy new endpoints
- Enable for beta users first
- Monitor API usage

**Phase 4: Audit & Compliance** (Week 9-10)
- Deploy audit enhancements
- Enable GCP Cloud Logging
- Verify audit event creation

**Phase 5: Full Rollout** (Week 11-12)
- Enable all features
- Remove feature flags
- Full production deployment

---

## 6. Risk Mitigation

### 6.1 Technical Risks

**Risk**: AccessGrant migration breaks existing document access
- **Mitigation**: Feature flag, gradual rollout, extensive testing
- **Rollback**: Keep old access logic until migration complete

**Risk**: Performance degradation from AccessGrant queries
- **Mitigation**: Database indexes, query optimization, caching (if needed)
- **Monitoring**: Query performance metrics

**Risk**: GCP Cloud Logging failures block operations
- **Mitigation**: Async, non-blocking forward, retry logic, dead letter queue
- **Monitoring**: Cloud Logging forward success rate

### 6.2 Compliance Risks

**Risk**: PHI leakage in audit logs
- **Mitigation**: Automated PHI detection tests, sanitization functions, code review
- **Monitoring**: Regular audit log reviews

**Risk**: Access control bypass
- **Mitigation**: Multi-layer enforcement (guards + domain services), comprehensive testing
- **Monitoring**: Unauthorized access attempt alerts

### 6.3 Business Risks

**Risk**: Breaking changes to existing API
- **Mitigation**: Backward compatibility, API versioning, gradual deprecation
- **Communication**: API changelog, migration guide

**Risk**: Manager onboarding complexity
- **Mitigation**: Clear documentation, admin tools, support process
- **Training**: Manager onboarding guide

---

## 7. Success Criteria

### 7.1 Functional Requirements

- ✅ All endpoints from Phase 3 implemented and tested
- ✅ Access control from Phase 1 fully enforced
- ✅ Document lifecycle from Phase 2 working correctly
- ✅ Audit logging from Phase 4 complete
- ✅ Manager role and assignments working

### 7.2 Non-Functional Requirements

- ✅ HIPAA compliance verified (no PHI in logs, access control enforced)
- ✅ Performance targets met (access resolution < 50ms, listing < 200ms)
- ✅ Security audit passed (no vulnerabilities)
- ✅ Documentation complete and accurate
- ✅ E2E test coverage > 80%

### 7.3 Compliance Requirements

- ✅ Audit events immutable and retained (6+ years)
- ✅ PHI sanitization verified (automated tests)
- ✅ Access control audited (all mutations logged)
- ✅ GCP Cloud Logging integrated and working
- ✅ Audit query endpoints functional

---

## Summary

### Implementation Timeline

**Total Duration**: 12 weeks (3 months)

**Phase Breakdown**:
- Phase 5.1 (Foundation): 2 weeks
- Phase 5.2 (Access Control Core): 2 weeks
- Phase 5.3 (Document Lifecycle): 2 weeks
- Phase 5.4 (API Surface): 2 weeks
- Phase 5.5 (Audit & Compliance): 2 weeks
- Phase 5.6 (Testing & Hardening): 2 weeks

### Key Deliverables

1. **Manager Role System**: ManagerOrganization, ManagerInstance, UserManagerAssignment
2. **AccessGrant System**: Complete access control with origin manager authority
3. **Document Lifecycle**: State machine, OCR authority, retention policy
4. **API Surface**: All endpoints from Phase 3 implemented
5. **Audit System**: Complete event taxonomy, PHI sanitization, GCP Cloud Logging
6. **Testing**: Comprehensive E2E test suite, performance benchmarks, security audit

### Next Steps

1. **Review and Approve**: This implementation plan
2. **Set Up Development Environment**: Database, GCP credentials, test data
3. **Begin Phase 5.1**: Start with foundation modules
4. **Weekly Progress Reviews**: Track implementation against plan
5. **Iterate and Adjust**: Adapt plan based on learnings

---

**Document Status**: ✅ Ready for Implementation  
**Approval Required**: Yes (before starting Phase 5.1)  
**Implementation Blocking**: No (can begin after approval)

---

**Prepared For**: Development Team  
**Review Cycle**: Before implementation begins  
**Questions/Clarifications**: Address before coding






