# Phase 5: Implementation Steps - Quick Reference

## Branch Created
✅ **Branch**: `feature/phase-5-access-grant-manager-role-system`

## Implementation Order

### 🏗️ Phase 5.1: Foundation (Weeks 1-2)

**Start Here**: These modules have no dependencies and must be completed first.

#### Step 1: Manager Role & Entities
```bash
# Files to create/update:
- src/roles/roles.enum.ts (add manager = 3)
- src/database/seeds/relational/role/role-seed.service.ts (update)
- src/managers/domain/entities/manager-organization.entity.ts (new)
- src/managers/domain/entities/manager-instance.entity.ts (new)
- src/managers/infrastructure/persistence/relational/entities/*.ts (new)
- src/managers/managers.module.ts (new)

# Database migration:
- Create manager_organizations table
- Create manager_instances table
- Insert manager role (id=3)
```

**Acceptance**: Manager role exists, entities created, migrations run

#### Step 2: UserManagerAssignment Entity
```bash
# Files to create:
- src/users/domain/entities/user-manager-assignment.entity.ts
- src/users/infrastructure/persistence/relational/entities/user-manager-assignment.entity.ts
- src/users/domain/repositories/user-manager-assignment.repository.port.ts
- src/users/infrastructure/persistence/relational/repositories/user-manager-assignment.repository.ts

# Database migration:
- Create user_manager_assignments table with indexes
```

**Acceptance**: Entity created, repository methods work, migrations run

#### Step 3: AccessGrant Entity
```bash
# Files to create:
- src/access-control/domain/entities/access-grant.entity.ts
- src/access-control/infrastructure/persistence/relational/entities/access-grant.entity.ts
- src/access-control/domain/repositories/access-grant.repository.port.ts
- src/access-control/infrastructure/persistence/relational/repositories/access-grant.repository.ts
- src/access-control/access-control.module.ts

# Database migration:
- Create access_grants table with indexes and constraints
```

**Acceptance**: Entity created, repository methods work, migrations run

#### Step 4: Document originManagerId Migration
```bash
# Files to update:
- src/document-processing/infrastructure/persistence/relational/entities/document.entity.ts
- src/document-processing/domain/entities/document.entity.ts

# Database migration:
- Add origin_manager_id (NOT NULL, FK to users)
- Add origin_user_context_id (nullable)
- Add index on origin_manager_id
```

**Acceptance**: Fields added, immutability enforced, migrations run

---

### 🔐 Phase 5.2: Access Control Core (Weeks 3-4)

**Prerequisites**: Phase 5.1 complete

#### Step 5: AccessGrantService
```bash
# Files to create:
- src/access-control/domain/services/access-grant.domain.service.ts
- src/access-control/dto/create-access-grant.dto.ts
- src/access-control/dto/revoke-access-grant.dto.ts

# Key methods:
- createGrant()
- revokeGrant()
- hasAccess() - origin manager implicit + explicit grants
- getActiveGrants()
```

**Acceptance**: Access resolution works, origin manager has implicit access

#### Step 6: DocumentAccessService
```bash
# Files to create:
- src/document-processing/domain/services/document-access.domain.service.ts

# Key methods:
- getDocument() - enforces access control
- listDocuments() - filters by AccessGrants
- canPerformOperation() - Phase 1 decision matrix
```

**Acceptance**: Access control enforced, admins hard-denied

#### Step 7: UserManagerAssignmentService
```bash
# Files to create:
- src/users/domain/services/user-manager-assignment.service.ts
- src/users/dto/create-user-manager-assignment.dto.ts

# Key methods:
- assignUserToManager()
- removeAssignment()
- isManagerAssignedToUser()
- getAssignedUserIds()
```

**Acceptance**: Assignment works, validation prevents self-assignment

#### Step 8: Authorization Guards Updates
```bash
# Files to update:
- src/roles/roles.guard.ts (handle manager role)
- src/document-processing/document-processing.controller.ts (hard deny admins)

# Changes:
- Extract actor type from JWT (user/manager/admin)
- Pass actor to domain services
- Hard deny admins before domain service
```

**Acceptance**: Guards recognize manager role, admins hard-denied

---

### 📄 Phase 5.3: Document Lifecycle (Weeks 5-6)

**Prerequisites**: Phase 5.2 complete

#### Step 9: Document State Machine
```bash
# Files to update:
- src/document-processing/domain/services/document-processing.domain.service.ts
- src/document-processing/domain/entities/document.entity.ts

# State transitions:
- UPLOADED → STORED
- STORED → PROCESSING
- PROCESSING → PROCESSED/ERROR
- ERROR → PROCESSING (retry)
```

**Acceptance**: State machine enforced, invalid transitions rejected

#### Step 10: OCR Authority Rules
```bash
# Files to update:
- src/document-processing/domain/services/document-processing.domain.service.ts

# Rules:
- Only origin manager can trigger OCR
- Async processing
- Retry logic
```

**Acceptance**: OCR restricted to origin manager, retry works

#### Step 11: Retention Policy
```bash
# Files to create/update:
- src/document-processing/domain/services/document-processing.domain.service.ts
- src/document-processing/jobs/document-retention.job.ts (new)

# Implementation:
- Set scheduledDeletionAt at creation (8 years default)
- Background job deletes expired documents
```

**Acceptance**: Retention set, background job runs, hard delete works

---

### 🌐 Phase 5.4: API Surface (Weeks 7-8)

**Prerequisites**: Phase 5.2 and 5.3 complete

#### Step 12: Access Grant Endpoints
```bash
# Files to create:
- src/access-control/access-control.controller.ts
- src/access-control/dto/list-access-grants.dto.ts

# Endpoints:
- POST /v1/access-grants
- GET /v1/access-grants?documentId=uuid
- DELETE /v1/access-grants/:id
- GET /v1/access-grants/my-grants
```

**Acceptance**: All endpoints work, authorization enforced, audit logged

#### Step 13: Revocation Request Endpoints
```bash
# Files to create:
- src/revocation/domain/entities/revocation-request.entity.ts
- src/revocation/infrastructure/persistence/relational/entities/revocation-request.entity.ts
- src/revocation/domain/services/revocation.domain.service.ts
- src/revocation/revocation.controller.ts
- src/revocation/revocation.module.ts

# Database migration:
- Create revocation_requests table

# Endpoints:
- POST /v1/revocation-requests
- GET /v1/revocation-requests
- PATCH /v1/revocation-requests/:id/approve
- PATCH /v1/revocation-requests/:id/deny
- DELETE /v1/revocation-requests/:id
```

**Acceptance**: Workflow works, origin manager approval required

#### Step 14: Manager Assignment Endpoints
```bash
# Files to create/update:
- src/users/users-manager.controller.ts (new) OR extend users.controller.ts

# Endpoints:
- POST /v1/users/:userId/assign-manager/:managerId
- GET /v1/users/managers/:managerId/assigned-users
- DELETE /v1/users/:userId/manager/:managerId
```

**Acceptance**: Endpoints work, admin-only enforced, audit logged

#### Step 15: Document Endpoint Updates
```bash
# Files to update:
- src/document-processing/document-processing.controller.ts

# Changes:
- POST /v1/documents/upload - require originManagerId
- GET /v1/documents - filter by AccessGrants
- GET /v1/documents/:id - enforce access control
- POST /v1/documents/:id/trigger-ocr - origin manager only
```

**Acceptance**: All endpoints updated, access control enforced

---

### 📊 Phase 5.5: Audit & Compliance (Weeks 9-10)

**Prerequisites**: All previous phases complete

#### Step 16: Complete Audit Event Taxonomy
```bash
# Files to create/update:
- src/audit/audit-event-type.enum.ts (new)
- src/audit/audit.service.ts (add all event types)
- src/audit/domain/entities/audit-event.entity.ts (new)

# Event types: 40+ from Phase 4
- Document lifecycle events
- Access control events
- Revocation workflow events
- Authority violation events
- System events
```

**Acceptance**: All event types defined, methods created

#### Step 17: PHI Sanitization
```bash
# Files to create:
- src/audit/utils/phi-sanitizer.ts

# Functions:
- sanitizeErrorMessage()
- sanitizeUserAgent()
- sanitizeMetadata()
```

**Acceptance**: PHI removed from all logs, tests verify no PHI

#### Step 18: GCP Cloud Logging Integration
```bash
# Files to create:
- src/audit/infrastructure/cloud-logging.client.ts
- src/audit/config/cloud-logging.config.ts

# Implementation:
- Async, non-blocking forward
- Retry with exponential backoff
- Dead letter queue
```

**Acceptance**: Events forwarded to Cloud Logging, retry works

#### Step 19: Audit Query Endpoints
```bash
# Files to create:
- src/audit/audit.controller.ts

# Endpoints:
- GET /v1/audit/events (admin/origin manager)
- GET /v1/audit/events/:id
- GET /v1/audit/reports/access (CSV/JSON)
```

**Acceptance**: Query endpoints work, authorization enforced

---

### ✅ Phase 5.6: Testing & Hardening (Weeks 11-12)

**Prerequisites**: All previous phases complete

#### Step 20: E2E Test Suite
```bash
# Files to create:
- test/access-control/access-grant.e2e-spec.ts
- test/access-control/document-access.e2e-spec.ts
- test/revocation/revocation-request.e2e-spec.ts
- test/managers/manager-assignment.e2e-spec.ts
- test/audit/audit-query.e2e-spec.ts
```

**Acceptance**: All critical paths covered, tests pass

#### Step 21: Performance Testing
```bash
# Files to create:
- test/performance/access-resolution.benchmark.ts
- test/performance/document-listing.benchmark.ts

# Targets:
- Access resolution < 50ms
- Document listing < 200ms
```

**Acceptance**: Performance targets met, indexes optimized

#### Step 22: Security Audit
```bash
# Checklist:
- No PHI in logs (automated test)
- No PHI in JWT payloads
- Access control enforced
- Admin hard-deny verified
- Origin manager immutability enforced
- SQL injection prevention
- XSS prevention
```

**Acceptance**: Security audit passed, all checks pass

#### Step 23: Documentation Updates
```bash
# Files to update/create:
- docs/authentication.md (manager role)
- docs/document-processing.md (access patterns)
- docs/access-control.md (new)
- docs/audit.md (new)
- README.md
- Swagger API docs
```

**Acceptance**: All documentation updated and accurate

---

## Quick Start Commands

### Create Migration
```bash
npm run migration:generate -- -n MigrationName
npm run migration:run
```

### Run Tests
```bash
npm run test
npm run test:e2e
npm run test:cov
```

### Start Development
```bash
npm run start:dev
```

## Critical Path

**Must Complete in Order**:
1. Phase 5.1 (Foundation) → No dependencies
2. Phase 5.2 (Access Control) → Depends on 5.1
3. Phase 5.3 (Document Lifecycle) → Depends on 5.2
4. Phase 5.4 (API Surface) → Depends on 5.2 and 5.3
5. Phase 5.5 (Audit) → Depends on all previous
6. Phase 5.6 (Testing) → Depends on all previous

## Next Action

**Start with Step 1**: Manager Role & Entities
- This is the foundation for everything else
- No dependencies
- Can be tested independently

---

**Last Updated**: January 2025  
**Branch**: `feature/phase-5-access-grant-manager-role-system`






