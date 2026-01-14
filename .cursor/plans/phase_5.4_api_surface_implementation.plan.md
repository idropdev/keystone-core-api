# Phase 5.4: API Surface Implementation - Detailed Step-by-Step Plan

## Status
**Phase**: 5.4 - API Surface  
**Status**: Ready for Implementation  
**Prerequisites**: Phase 5.1, 5.2, 5.3 complete

---

## Overview

This phase implements all REST API endpoints for the Document Identity Management Platform. Each module is broken down into detailed implementation steps following NestJS best practices and the existing codebase patterns.

---

## Phase 5.4.1: Access Grant Endpoints

### Step 5.4.1.1: Create Access Grant DTOs

**Files to Create**:
- `src/access-control/dto/list-access-grants.dto.ts` (new)
- `src/access-control/dto/access-grant-response.dto.ts` (new)

**Implementation Steps**:
1. Create `ListAccessGrantsDto` with query parameters:
   - `documentId?: string` (UUID, optional - filter by document)
   - `subjectType?: 'user' | 'manager'` (optional - filter by subject type)
   - `subjectId?: number` (optional - filter by subject ID)
   - `page?: number` (default: 1)
   - `limit?: number` (default: 20, max: 100)
   - Use `class-validator` decorators for validation

2. Create `AccessGrantResponseDto` with fields:
   - `id: number`
   - `documentId: string`
   - `subjectType: 'user' | 'manager'`
   - `subjectId: number`
   - `grantType: 'owner' | 'delegated' | 'derived'`
   - `grantedByType: 'user' | 'manager'`
   - `grantedById: number`
   - `createdAt: Date`
   - `revokedAt?: Date`
   - Use `@ApiProperty()` decorators for Swagger

**Acceptance Criteria**:
- ✅ DTOs use class-validator
- ✅ DTOs have Swagger documentation
- ✅ Validation rules match Phase 3 spec

---

### Step 5.4.1.2: Create Access Control Service (Application Layer)

**Files to Create**:
- `src/access-control/access-control.service.ts` (new)

**Implementation Steps**:
1. Create `AccessControlService` that wraps `AccessGrantDomainService`
2. Add methods:
   - `createGrant(dto: CreateAccessGrantDto, actor: Actor): Promise<AccessGrantResponseDto>`
   - `revokeGrant(grantId: number, actor: Actor): Promise<void>`
   - `listGrants(query: ListAccessGrantsDto, actor: Actor): Promise<PaginatedResult<AccessGrantResponseDto>>`
   - `getMyGrants(actor: Actor, query?: ListOptions): Promise<PaginatedResult<AccessGrantResponseDto>>`
3. Handle DTO transformations (domain → response DTO)
4. Call `AccessGrantDomainService` for business logic
5. Inject `AccessGrantDomainService` and `DocumentAccessDomainService`

**Acceptance Criteria**:
- ✅ Service transforms domain entities to DTOs
- ✅ Service handles pagination
- ✅ Service calls domain service for business logic

---

### Step 5.4.1.3: Create Access Control Controller

**Files to Create**:
- `src/access-control/access-control.controller.ts` (new)

**Implementation Steps**:
1. Create controller with decorators:
   - `@Controller({ path: 'access-grants', version: '1' })`
   - `@ApiTags('Access Grants')`
   - `@UseGuards(AuthGuard('jwt'))`
   - `@ApiBearerAuth()`

2. Implement `POST /v1/access-grants`:
   - Extract actor from request using `extractActorFromRequest()`
   - Hard-deny admins (403 before domain service)
   - Validate DTO with `@Body()` and `CreateAccessGrantDto`
   - Call `AccessControlService.createGrant()`
   - Return 201 Created with `AccessGrantResponseDto`
   - Swagger: `@ApiOperation()`, `@ApiCreatedResponse()`, `@ApiBadRequestResponse()`, `@ApiForbiddenResponse()`

3. Implement `GET /v1/access-grants`:
   - Extract actor from request
   - Hard-deny admins
   - Validate query params with `@Query()` and `ListAccessGrantsDto`
   - Authorization check:
     - If `documentId` provided: actor must be origin manager OR grant subject
     - If no `documentId`: return actor's own grants only
   - Call `AccessControlService.listGrants()`
   - Return 200 OK with paginated results
   - Swagger: `@ApiOperation()`, `@ApiOkResponse()`, `@ApiQuery()`

4. Implement `DELETE /v1/access-grants/:id`:
   - Extract actor from request
   - Hard-deny admins
   - Validate `grantId` with `@Param('id', ParseIntPipe)`
   - Call `AccessControlService.revokeGrant()`
   - Return 204 No Content
   - Swagger: `@ApiOperation()`, `@ApiNoContentResponse()`, `@ApiParam()`, `@ApiForbiddenResponse()`

5. Implement `GET /v1/access-grants/my-grants`:
   - Extract actor from request
   - Hard-deny admins
   - Call `AccessControlService.getMyGrants()`
   - Return 200 OK with paginated results
   - Swagger: `@ApiOperation()`, `@ApiOkResponse()`

**Acceptance Criteria**:
- ✅ All endpoints implemented per Phase 3 spec
- ✅ Authorization enforced correctly
- ✅ Swagger documentation complete
- ✅ Error responses properly typed

---

### Step 5.4.1.4: Update Access Control Module

**Files to Update**:
- `src/access-control/access-control.module.ts`

**Implementation Steps**:
1. Add `AccessControlService` to providers
2. Add `AccessControlController` to controllers
3. Import `DocumentProcessingModule` (for DocumentAccessDomainService)
4. Export `AccessControlService` if needed

**Acceptance Criteria**:
- ✅ Module wires all dependencies
- ✅ Controller registered
- ✅ Service registered
- ✅ No circular dependencies

---

## Phase 5.4.2: Revocation Request Endpoints

### Step 5.4.2.1: Create Revocation Request Domain Entity

**Files to Create**:
- `src/revocation/domain/entities/revocation-request.entity.ts` (new)

**Implementation Steps**:
1. Create domain entity with fields:
   - `id: number`
   - `documentId: string` (UUID)
   - `requestedByType: 'user' | 'manager'`
   - `requestedById: number`
   - `requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation'`
   - `status: 'pending' | 'approved' | 'denied' | 'cancelled'`
   - `cascadeToSecondaryManagers: boolean`
   - `reviewNotes?: string`
   - `reviewedBy?: number`
   - `reviewedAt?: Date`
   - `createdAt: Date`
   - `updatedAt: Date`
   - `deletedAt?: Date`

**Acceptance Criteria**:
- ✅ Entity matches Phase 0 domain model
- ✅ All fields typed correctly

---

### Step 5.4.2.2: Create Revocation Request Database Entity

**Files to Create**:
- `src/revocation/infrastructure/persistence/relational/entities/revocation-request.entity.ts` (new)

**Implementation Steps**:
1. Create TypeORM entity with:
   - `@Entity({ name: 'revocation_requests' })`
   - `@PrimaryGeneratedColumn()` for id
   - `@Column()` for all fields
   - `@ManyToOne()` for document relationship
   - `@ManyToOne()` for reviewedBy user relationship
   - `@Index()` on documentId, requestedById, status
   - `@Check()` constraints for enum values
   - Extend `EntityRelationalHelper`

2. Add database migration:
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
   
   CREATE INDEX idx_revocation_requests_document_id ON revocation_requests(document_id);
   CREATE INDEX idx_revocation_requests_requested_by ON revocation_requests(requested_by_type, requested_by_id);
   CREATE INDEX idx_revocation_requests_status ON revocation_requests(status);
   ```

**Acceptance Criteria**:
- ✅ Entity matches database schema
- ✅ Migration runs successfully
- ✅ Indexes created for performance

---

### Step 5.4.2.3: Create Revocation Request Repository

**Files to Create**:
- `src/revocation/domain/repositories/revocation-request.repository.port.ts` (new)
- `src/revocation/infrastructure/persistence/relational/repositories/revocation-request.repository.ts` (new)

**Implementation Steps**:
1. Create repository port interface with methods:
   - `findById(id: number): Promise<NullableType<RevocationRequest>>`
   - `findByDocumentId(documentId: string): Promise<RevocationRequest[]>`
   - `findByRequester(requesterType: 'user' | 'manager', requesterId: number): Promise<RevocationRequest[]>`
   - `findPendingByDocumentId(documentId: string): Promise<RevocationRequest[]>`
   - `create(data: Omit<RevocationRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<RevocationRequest>`
   - `update(id: number, partial: Partial<RevocationRequest>): Promise<void>`
   - `softDelete(id: number): Promise<void>`

2. Implement relational repository:
   - Inject TypeORM repository
   - Implement all port methods
   - Add mapper methods (toDomain, toPersistence)
   - Handle soft deletes

**Acceptance Criteria**:
- ✅ Repository implements all port methods
- ✅ Mapper methods work correctly
- ✅ Soft delete implemented

---

### Step 5.4.2.4: Create Revocation Domain Service

**Files to Create**:
- `src/revocation/domain/services/revocation.domain.service.ts` (new)

**Implementation Steps**:
1. Create service with methods:
   - `createRequest(dto: CreateRevocationRequestDto, actor: Actor): Promise<RevocationRequest>`
   - `approveRequest(requestId: number, actor: Actor, reviewNotes?: string): Promise<void>`
   - `denyRequest(requestId: number, actor: Actor, reviewNotes?: string): Promise<void>`
   - `cancelRequest(requestId: number, actor: Actor): Promise<void>`
   - `listRequests(query: ListRevocationRequestsDto, actor: Actor): Promise<PaginatedResult<RevocationRequest>>`

2. Implement `createRequest()`:
   - Validate document exists
   - Validate actor has access to document
   - Determine request type based on actor and document
   - Create request with status 'pending'
   - Audit log: `REVOCATION_REQUESTED`

3. Implement `approveRequest()`:
   - Validate request exists and is pending
   - Validate actor is origin manager
   - Update request status to 'approved'
   - Revoke AccessGrants (via AccessGrantDomainService)
   - If cascade enabled, revoke secondary manager grants
   - Audit log: `REVOCATION_APPROVED`

4. Implement `denyRequest()`:
   - Validate request exists and is pending
   - Validate actor is origin manager
   - Update request status to 'denied'
   - Audit log: `REVOCATION_DENIED`

5. Implement `cancelRequest()`:
   - Validate request exists and is pending
   - Validate actor is requester
   - Soft delete request
   - Audit log: `REVOCATION_CANCELLED`

**Acceptance Criteria**:
- ✅ All workflow states enforced
- ✅ Origin manager approval required
- ✅ Cascade revocation logic implemented
- ✅ Audit events logged

---

### Step 5.4.2.5: Create Revocation DTOs

**Files to Create**:
- `src/revocation/dto/create-revocation-request.dto.ts` (new)
- `src/revocation/dto/list-revocation-requests.dto.ts` (new)
- `src/revocation/dto/revocation-request-response.dto.ts` (new)
- `src/revocation/dto/approve-revocation-request.dto.ts` (new)
- `src/revocation/dto/deny-revocation-request.dto.ts` (new)

**Implementation Steps**:
1. Create `CreateRevocationRequestDto`:
   - `documentId: string` (UUID, required)
   - `cascadeToSecondaryManagers?: boolean` (default: false)
   - Validation: documentId must be UUID

2. Create `ListRevocationRequestsDto`:
   - `documentId?: string` (optional)
   - `status?: 'pending' | 'approved' | 'denied' | 'cancelled'` (optional)
   - `page?: number` (default: 1)
   - `limit?: number` (default: 20)

3. Create `RevocationRequestResponseDto`:
   - All fields from domain entity
   - Use `@ApiProperty()` for Swagger

4. Create `ApproveRevocationRequestDto`:
   - `reviewNotes?: string` (optional)

5. Create `DenyRevocationRequestDto`:
   - `reviewNotes?: string` (optional)

**Acceptance Criteria**:
- ✅ All DTOs validated
- ✅ Swagger documentation complete

---

### Step 5.4.2.6: Create Revocation Controller

**Files to Create**:
- `src/revocation/revocation.controller.ts` (new)

**Implementation Steps**:
1. Create controller with decorators:
   - `@Controller({ path: 'revocation-requests', version: '1' })`
   - `@ApiTags('Revocation Requests')`
   - `@UseGuards(AuthGuard('jwt'))`
   - `@ApiBearerAuth()`

2. Implement `POST /v1/revocation-requests`:
   - Extract actor
   - Hard-deny admins
   - Validate DTO
   - Call domain service `createRequest()`
   - Return 201 Created

3. Implement `GET /v1/revocation-requests`:
   - Extract actor
   - Hard-deny admins
   - Validate query params
   - Authorization: origin manager sees all for their documents, others see own requests
   - Call domain service `listRequests()`
   - Return 200 OK with paginated results

4. Implement `PATCH /v1/revocation-requests/:id/approve`:
   - Extract actor
   - Hard-deny admins
   - Validate request ID
   - Validate DTO (reviewNotes optional)
   - Call domain service `approveRequest()`
   - Return 204 No Content

5. Implement `PATCH /v1/revocation-requests/:id/deny`:
   - Extract actor
   - Hard-deny admins
   - Validate request ID
   - Validate DTO
   - Call domain service `denyRequest()`
   - Return 204 No Content

6. Implement `DELETE /v1/revocation-requests/:id`:
   - Extract actor
   - Hard-deny admins
   - Validate request ID
   - Call domain service `cancelRequest()`
   - Return 204 No Content

**Acceptance Criteria**:
- ✅ All endpoints implemented
- ✅ Authorization enforced
- ✅ Swagger docs complete

---

### Step 5.4.2.7: Create Revocation Module

**Files to Create**:
- `src/revocation/revocation.module.ts` (new)

**Implementation Steps**:
1. Create module with:
   - Import `TypeOrmModule.forFeature([RevocationRequestEntity])`
   - Import `AccessControlModule` (for AccessGrantDomainService)
   - Import `DocumentProcessingModule` (for DocumentAccessDomainService)
   - Import `AuditModule`
   - Providers: repository port → implementation, domain service
   - Controllers: RevocationController
   - Exports: domain service (if needed)

**Acceptance Criteria**:
- ✅ Module wires all dependencies
- ✅ No circular dependencies

---

## Phase 5.4.3: Manager Assignment Endpoints

### Step 5.4.3.1: Create Manager Assignment DTOs

**Files to Create**:
- `src/users/dto/list-manager-assignments.dto.ts` (new)
- `src/users/dto/user-manager-assignment-response.dto.ts` (new)

**Implementation Steps**:
1. Create `ListManagerAssignmentsDto`:
   - `managerId?: number` (optional - filter by manager)
   - `userId?: number` (optional - filter by user)
   - `page?: number` (default: 1)
   - `limit?: number` (default: 20)

2. Create `UserManagerAssignmentResponseDto`:
   - All fields from domain entity
   - Swagger documentation

**Acceptance Criteria**:
- ✅ DTOs validated
- ✅ Swagger docs complete

---

### Step 5.4.3.2: Create Manager Assignment Controller

**Files to Create**:
- `src/users/users-manager.controller.ts` (new) OR extend `src/users/users.controller.ts`

**Implementation Steps**:
1. Create controller with decorators:
   - `@Controller({ path: 'users', version: '1' })`
   - `@ApiTags('User Manager Assignments')`
   - `@UseGuards(AuthGuard('jwt'), RolesGuard)`
   - `@Roles(RoleEnum.admin)` (admin-only endpoints)
   - `@ApiBearerAuth()`

2. Implement `POST /v1/users/:userId/assign-manager/:managerId`:
   - Extract actor (admin)
   - Validate userId and managerId with `@Param(ParseIntPipe)`
   - Create DTO: `CreateUserManagerAssignmentDto`
   - Call `UserManagerAssignmentService.assignUserToManager()`
   - Return 201 Created with assignment response

3. Implement `GET /v1/users/managers/:managerId/assigned-users`:
   - Extract actor (admin)
   - Validate managerId
   - Validate query params
   - Call `UserManagerAssignmentService.getAssignmentsByManager()`
   - Return 200 OK with paginated results

4. Implement `DELETE /v1/users/:userId/manager/:managerId`:
   - Extract actor (admin)
   - Validate userId and managerId
   - Call `UserManagerAssignmentService.removeAssignment()`
   - Return 204 No Content

**Acceptance Criteria**:
- ✅ All endpoints admin-only
- ✅ Validation prevents self-assignment
- ✅ Audit events logged

---

## Phase 5.4.4: Document Endpoint Updates

### Step 5.4.4.1: Update Upload Document DTO

**Files to Update**:
- `src/document-processing/dto/upload-document.dto.ts`

**Implementation Steps**:
1. Add `originManagerId: number` field (required)
   - Use `@IsNumber()`, `@IsNotEmpty()` decorators
   - Add Swagger `@ApiProperty()` documentation
   - Add description: "Manager instance ID who will be the origin manager (custodian) of this document"

**Acceptance Criteria**:
- ✅ originManagerId required in upload DTO
- ✅ Validation works correctly

---

### Step 5.4.4.2: Update Document Upload Endpoint

**Files to Update**:
- `src/document-processing/document-processing.controller.ts`
- `src/document-processing/document-processing.service.ts`
- `src/document-processing/domain/services/document-processing.domain.service.ts`

**Implementation Steps**:
1. Update controller `uploadDocument()`:
   - Extract `originManagerId` from DTO
   - Extract actor from request
   - Hard-deny admins
   - Pass `originManagerId` to service

2. Update service `uploadDocument()`:
   - Accept `originManagerId` parameter
   - Pass to domain service

3. Update domain service `uploadDocument()`:
   - Accept `originManagerId` parameter
   - Validate origin manager exists and is verified
   - Set `document.originManagerId = originManagerId` (immutable)
   - Set `document.originUserContextId = userId` (if user uploaded)
   - Create default delegated AccessGrant for uploader (if user uploaded)
   - Audit events: `DOCUMENT_INTAKE_BY_USER` (if user), `ORIGIN_MANAGER_ASSIGNED`, `ACCESS_GRANTED` (if user)

**Acceptance Criteria**:
- ✅ Upload requires originManagerId
- ✅ Origin manager validated
- ✅ Default access grant created for user uploads
- ✅ Audit events logged

---

### Step 5.4.4.3: Update Document List Endpoint

**Files to Update**:
- `src/document-processing/document-processing.controller.ts`

**Implementation Steps**:
1. Update `listDocuments()`:
   - Already uses `DocumentAccessService.listDocuments()` (from Phase 5.2)
   - Verify it filters by AccessGrants correctly
   - Verify origin manager sees all their documents

**Acceptance Criteria**:
- ✅ List filters by AccessGrants
- ✅ Origin manager sees all their documents

---

### Step 5.4.4.4: Update Document Get Endpoint

**Files to Update**:
- `src/document-processing/document-processing.controller.ts`

**Implementation Steps**:
1. Update `getDocument()`:
   - Already uses `DocumentAccessService.getDocument()` (from Phase 5.2)
   - Verify access control enforced

**Acceptance Criteria**:
- ✅ Get enforces access control
- ✅ Hard-deny admins

---

### Step 5.4.4.5: Add OCR Trigger Endpoint

**Files to Update**:
- `src/document-processing/document-processing.controller.ts`
- `src/document-processing/document-processing.service.ts`

**Implementation Steps**:
1. Add `POST /v1/documents/:id/trigger-ocr`:
   - Extract actor from request
   - Hard-deny admins
   - Validate documentId with `@Param('id', ParseUUIDPipe)`
   - Call `DocumentProcessingService.triggerOcr(documentId, actor)`
   - Return 202 Accepted (async operation)
   - Swagger: `@ApiOperation()`, `@ApiAcceptedResponse()`, `@ApiForbiddenResponse()`

2. Update service:
   - Add `triggerOcr(documentId: string, actor: Actor): Promise<void>`
   - Call domain service `triggerOcr()`

**Acceptance Criteria**:
- ✅ OCR trigger restricted to origin manager
- ✅ Returns 202 Accepted
- ✅ Audit event logged

---

## Summary

**Total Modules**: 4 main modules, 17 detailed steps

**Phase 5.4.1**: Access Grant Endpoints (4 steps)
**Phase 5.4.2**: Revocation Request Endpoints (7 steps)
**Phase 5.4.3**: Manager Assignment Endpoints (2 steps)
**Phase 5.4.4**: Document Endpoint Updates (4 steps)

**Next**: After Phase 5.4, proceed to Phase 5.5 (Audit & Compliance)

