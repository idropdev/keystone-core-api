# PHASE 0: Domain Modeling - Document Identity Management Platform

## Document Version
**Version**: 1.0  
**Phase**: 0 - Domain Modeling (NO CODE)  
**Status**: Awaiting Approval  
**Classification**: Internal - Architecture Design

---

## Executive Summary

This document defines the core domain model for a HIPAA-compliant Document Identity Management Platform. The system is **origin-centered, manager-governed, and user-mediated**, where documents have immutable origin managers, users hold access grants (not ownership), and deletion is a revocation workflow rather than destruction.

**Key Philosophy**: Documents are custodial assets managed by healthcare providers (managers), with users acting as access brokers. This model aligns with HIPAA Designated Record Set rules and EHR custodianship patterns.

---

## Core Domain Entities

### 1. Document

**Purpose**: Represents a healthcare document with immutable origin authority.

**Properties**:
```typescript
class Document {
  id: string;                    // UUID, immutable
  originManagerId: number;        // IMMUTABLE - set once at creation, never changes
  originUserContextId?: number;   // Optional: user who uploaded (intake context, not ownership)
                                  // Note: originUserContextId is optional, immutable, and visible only to the origin manager and auditors.
  documentType: DocumentType;    // lab_result, prescription, etc.
  status: DocumentStatus;         // UPLOADED | STORED | PROCESSING | PROCESSED | ERROR
  processingMethod?: ProcessingMethod;
  
  // File storage (GCS URIs)
  rawFileUri: string;            // gs://bucket/origin/{originManagerId}/{docId}.pdf
  processedFileUri?: string;      // gs://bucket/processed/{originManagerId}/{docId}.json
  
  // OCR results (PHI - encrypted at rest)
  ocrJsonOutput?: any;            // Full Document AI JSON (jsonb)
  extractedText?: string;         // Plain text extraction (first 5000 chars)
  confidence?: number;            // OCR confidence (0-1)
  
  // Metadata
  fileName: string;
  fileSize: number;               // Bytes
  mimeType: string;
  pageCount?: number;
  description?: string;           // User-provided description
  
  // Error tracking
  errorMessage?: string;          // Sanitized error message
  retryCount: number;             // Processing retry attempts
  
  // Timestamps
  createdAt: Date;                // Document creation (immutable)
  updatedAt: Date;                // Last metadata update
  processedAt?: Date;             // OCR completion timestamp
  
  // Retention (HIPAA)
  scheduledDeletionAt?: Date;     // Hard delete after retention period (8 years)
  // NOTE: No deletedAt - documents are never soft-deleted, only access is revoked
}
```

**Invariants**:
1. ✅ `originManagerId` is **REQUIRED at creation** and **NEVER changes** (immutable)
2. ✅ Document cannot exist without an origin manager (no origin → no document creation)
3. ✅ Document cannot be deleted (only access can be revoked)
4. ✅ Only origin manager can trigger OCR processing
5. ✅ Only origin manager can modify canonical document metadata
6. ✅ `scheduledDeletionAt` is set by retention policy, not user action
7. ✅ Origin manager is set either by: (a) Manager upload (self-origin), or (b) User upload + explicit manager selection

**Authority Rules**:
- **Origin Manager**: Full custodial authority (upload, OCR, metadata, re-share)
- **Secondary Managers**: View-only access (if granted)
- **Users**: View-only access (if granted), can request revocation
- **Admins**: System-level operations (not document-level authority)

---

### 2. DocumentOrigin

**Purpose**: Tracks the immutable origin relationship between a document and its manager.

**Properties**:
```typescript
class DocumentOrigin {
  id: number;                     // Auto-increment
  documentId: string;             // FK to Document
  originManagerId: number;         // FK to Manager (IMMUTABLE)
  createdAt: Date;                // When document was created (immutable)
  // NOTE: This is a historical record - never updated or deleted
}
```

**Invariants**:
1. ✅ Created exactly once when document is created
2. ✅ Never updated or deleted (immutable historical record)
3. ✅ One document = exactly one origin (1:1 relationship)
4. ✅ Used for audit trail and authority resolution

**Rationale**: 
- Separates origin tracking from document metadata
- Enables audit queries: "Which manager created this document?"
- Provides immutable proof of origin authority

---

### 3. AccessGrant

**Purpose**: Represents a grant of access to a document. Documents are accessed through grants, not ownership.

**Properties**:
```typescript
class AccessGrant {
  id: number;                     // Auto-increment
  documentId: string;            // FK to Document
  subjectType: 'user' | 'manager'; // Who receives the grant
  subjectId: number;             // User ID or Manager ID (depending on subjectType)
  grantedByType: 'user' | 'manager' | 'system'; // Who created this grant
  grantedById: number;            // User ID, Manager ID, or system (0)
  grantType: 'owner' | 'delegated' | 'derived'; // Authority level
  createdAt: Date;                // When grant was created
  revokedAt?: Date;               // When grant was revoked (null = active)
  revokedBy?: number;             // Who revoked (if applicable)
  cascadeRevoked: boolean;       // True if revoked due to cascade
}
```

**Grant Types**:
- **`owner`**: Created by origin manager. Full access (view, re-share, cannot delete). Only origin manager can create owner grants.
- **`delegated`**: Created by a user who has access. Can be revoked by the user who granted it or by origin manager.
- **`derived`**: Created automatically when a delegated grant is created (for secondary managers). Revoked automatically if parent delegated grant is revoked.

**Invariants**:
1. ✅ Only origin manager can create `owner` grants
2. ✅ Users can only create `delegated` grants (to other users or managers)
3. ✅ `derived` grants are created automatically (not manually)
4. ✅ Revocation cascades: If delegated grant is revoked, all derived grants are revoked
5. ✅ Origin manager can always re-grant access (even after revocation)
6. ✅ A subject can have multiple grants for the same document (from different grantors)
7. ✅ `revokedAt IS NULL` means grant is active

**Access Resolution**:
- To check if subject has access: Query `AccessGrant` where `documentId = X AND subjectType = Y AND subjectId = Z AND revokedAt IS NULL`
- If multiple grants exist, subject has access (union, not intersection)
- Origin manager always has implicit access (even without explicit grant)

---

### 4. RevocationRequest

**Purpose**: Represents a user's request to revoke their access to a document. This is a workflow, not an immediate action.

**Properties**:
```typescript
class RevocationRequest {
  id: number;                     // Auto-increment
  documentId: string;             // FK to Document
  requestedByType: 'user' | 'manager'; // Who requested revocation
  requestedById: number;          // User ID or Manager ID
  requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation';
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  requestedAt: Date;              // When request was created
  reviewedAt?: Date;              // When origin manager reviewed
  reviewedBy?: number;            // Origin manager ID who reviewed
  reviewNotes?: string;           // Optional notes from reviewer
  cascadeToSecondaryManagers: boolean; // If true, revoke all secondary manager access too
}
```

**Request Types**:
- **`self_revocation`**: User requests to revoke their own access
- **`user_revocation`**: User requests to revoke another user's access (if they granted it)
- **`manager_revocation`**: Manager requests to revoke a user's access (only origin manager)

**Workflow**:
1. User creates `RevocationRequest` with `status = 'pending'`
2. Request is routed to origin manager (via `document.originManagerId`)
3. Origin manager reviews and sets `status = 'approved' | 'denied'`
4. If approved:
   - Revoke `AccessGrant` for requested subject
   - If `cascadeToSecondaryManagers = true`, revoke all derived grants
   - Create audit event
5. Document remains in system (not deleted)

**Invariants**:
1. ✅ Only origin manager can approve/deny requests
2. ✅ Secondary managers cannot create revocation requests
3. ✅ Users can only revoke grants they created (delegated grants)
4. ✅ Origin manager can revoke any grant (except their own implicit access)
5. ✅ Document is never deleted, only access is revoked
6. ✅ Revocation requests are immutable historical records

---

### 5. User

**Purpose**: Represents an individual (patient) who can receive access grants to documents.

**Properties**:
```typescript
class User {
  id: number;                     // Auto-increment
  email: string | null;           // OAuth email (nullable for Apple private relay)
  provider: string;               // 'email' | 'google' | 'apple'
  socialId?: string | null;       // Provider user ID
  firstName: string | null;
  lastName: string | null;
  role: Role;                     // Always 'user' (not 'manager' or 'admin')
  status: Status;                 // Active | Inactive
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;               // Soft delete
}
```

**Invariants**:
1. ✅ Users have role = 'user' (never 'manager' or 'admin')
2. ✅ Users cannot be origin managers (only Managers can be origin managers)
3. ✅ Users can receive access grants and delegate them
4. ✅ Users can request revocation of their own access
5. ✅ Users can upload documents **only as intake** with mandatory origin manager assignment
6. ✅ **Uploading a document does not automatically grant access beyond the default delegated grant created at intake** (Upload ≠ Access)

**Authority**:
- Can view documents they have access grants for
- Can delegate access to other users or managers (creates delegated grants)
- Can request revocation of their own access
- **Can upload documents** with explicit origin manager selection (intake role)
- **Uploading a document does not automatically grant access beyond the default delegated grant created at intake** (Upload ≠ Access)
- Cannot trigger OCR or modify document metadata
- Cannot delete documents
- Cannot upload documents without selecting an origin manager

---

### 6. Manager (ManagerInstance)

**Purpose**: Represents a specific instance/location of a healthcare provider organization that can be origin managers for documents.

**Properties**:
```typescript
class ManagerInstance {
  id: number;                     // Auto-increment
  organizationId: number;         // FK to ManagerOrganization (REQUIRED)
  name: string;                   // Instance-specific name (e.g., "Quest Diagnostics - Downtown Lab")
  location?: string;              // Physical location/address
  labCode?: string;               // Lab-specific identifier (CLIA, etc.)
  email: string;                  // Contact email
  phone?: string;                 // Contact phone
  status: 'active' | 'inactive' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;               // Soft delete
}
```

**Invariants**:
1. ✅ Managers are separate entities (not Users with a role)
2. ✅ Only Managers can be origin managers for documents
3. ✅ Managers must belong to a ManagerOrganization
4. ✅ **Managers must be verified before activation** (verificationStatus = 'verified')
5. ✅ Managers authenticate via shared OAuth infrastructure (same as users)
6. ✅ Managers can be assigned to users (for management relationships)
7. ✅ Managers can receive access grants (as secondary managers)
8. ✅ Managers cannot delete documents (only revoke access)

**Authority**:
- **As Origin Manager**: Full custodial authority (upload, OCR, metadata, re-share)
- **As Secondary Manager**: View-only access (if granted)
- Can manage documents for assigned users (if assigned)
- Cannot override another origin manager's authority

---

### 6a. ManagerOrganization

**Purpose**: Represents the canonical organizational identity of a healthcare provider (e.g., "Quest Diagnostics", "LabCorp"). Multiple ManagerInstances can belong to one organization.

**Properties**:
```typescript
class ManagerOrganization {
  id: number;                     // Auto-increment
  canonicalName: string;          // "Quest Diagnostics", "LabCorp", etc.
  verificationStatus: 'verified' | 'pending' | 'rejected';
  identifiers: {
    npi?: string;                 // National Provider Identifier
    clia?: string;                 // Clinical Laboratory Improvement Amendments
    taxId?: string;                // Tax ID (encrypted)
    other?: Record<string, string>; // Additional identifiers
  };
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;               // Soft delete
}
```

**Invariants**:
1. ✅ Organizations have stable canonical names (immutable after verification)
2. ✅ Organizations can have multiple instances (locations, labs)
3. ✅ **Verification status is REQUIRED** - Only verified organizations/instances can be selected by users
4. ✅ Identifiers (NPI, CLIA) are used for verification and routing
5. ✅ Organizations are onboarded via Admin invitation (no public self-signup)
6. ✅ Verification must be completed before any ManagerInstance can be activated

**Rationale**:
- Enables multiple Quest Diagnostics labs to exist as separate ManagerInstances
- Provides accurate custody tracking (which specific lab, not just "Quest")
- Supports verified directory for user selection during upload
- Allows routing and organizational-level queries

**Example**:
```
ManagerOrganization: "Quest Diagnostics"
  ├─ ManagerInstance: "Quest Diagnostics - Downtown Lab" (labCode: "QD-DT-001")
  ├─ ManagerInstance: "Quest Diagnostics - Uptown Lab" (labCode: "QD-UT-002")
  └─ ManagerInstance: "Quest Diagnostics - Mobile Unit" (labCode: "QD-MB-003")
```

---

### 7. UserManagerAssignment

**Purpose**: Represents a governance/supervision relationship between a user and a manager. Separate from document-level AccessGrants.

**Properties**:
```typescript
class UserManagerAssignment {
  id: number;                     // Auto-increment
  userId: number;                 // FK to User
  managerId: number;              // FK to ManagerInstance
  assignedBy: number;             // Admin or Manager ID who created assignment
  assignedAt: Date;               // When assignment was created
  status: 'active' | 'inactive'; // Assignment status
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;               // Soft delete
}
```

**Invariants**:
1. ✅ Assignment is separate from AccessGrants (document-level permissions)
2. ✅ Assignment does not imply access to all user's documents
3. ✅ AccessGrants are still required for document visibility
4. ✅ Only Admins or authorized Managers can create assignments
5. ✅ Assignment can be inactive without deleting (for history)

**Rationale**: 
- Separates supervision/governance from document access
- Prevents over-permissioning
- Enables fine-grained consent
- Aligned with healthcare governance models (care teams vs record access)

---

### 8. AuditEvent

**Purpose**: Immutable audit log for HIPAA compliance. Tracks all document access and authority changes.

**Properties**:
```typescript
class AuditEvent {
  id: number;                     // Auto-increment
  eventType: AuditEventType;      // See enum below
  documentId?: string;            // FK to Document (if applicable)
  actorType: 'user' | 'manager' | 'admin' | 'system';
  actorId: number;                // User ID, Manager ID, Admin ID, or 0 (system)
  targetType?: 'user' | 'manager' | 'document' | 'access_grant';
  targetId?: number;              // Target entity ID
  action: string;                 // 'view', 'grant_access', 'revoke_access', 'upload', 'ocr_triggered', etc.
  success: boolean;               // Whether action succeeded
  ipAddress?: string;              // Request IP (not PHI)
  userAgent?: string;             // Sanitized user agent (not PHI)
  metadata?: Record<string, any>;  // Additional context (NO PHI)
  timestamp: Date;                 // When event occurred (immutable)
}
```

**AuditEventType Enum**:
```typescript
enum AuditEventType {
  // Document lifecycle
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',                    // Manager upload
  DOCUMENT_INTAKE_BY_USER = 'DOCUMENT_INTAKE_BY_USER',        // User upload with origin selection
  ORIGIN_MANAGER_ASSIGNED = 'ORIGIN_MANAGER_ASSIGNED',        // Origin manager assigned at creation
  ORIGIN_MANAGER_ACCEPTED_DOCUMENT = 'ORIGIN_MANAGER_ACCEPTED_DOCUMENT', // Optional: manager acknowledges intake
  DOCUMENT_PROCESSING_STARTED = 'DOCUMENT_PROCESSING_STARTED',
  DOCUMENT_PROCESSING_COMPLETED = 'DOCUMENT_PROCESSING_COMPLETED',
  DOCUMENT_PROCESSING_FAILED = 'DOCUMENT_PROCESSING_FAILED',
  
  // Access control
  ACCESS_GRANTED = 'ACCESS_GRANTED',
  ACCESS_REVOKED = 'ACCESS_REVOKED',
  ACCESS_DELEGATED = 'ACCESS_DELEGATED',
  ACCESS_DERIVED = 'ACCESS_DERIVED',
  
  // Revocation workflow
  REVOCATION_REQUESTED = 'REVOCATION_REQUESTED',
  REVOCATION_APPROVED = 'REVOCATION_APPROVED',
  REVOCATION_DENIED = 'REVOCATION_DENIED',
  REVOCATION_CANCELLED = 'REVOCATION_CANCELLED',
  
  // Document access
  DOCUMENT_VIEWED = 'DOCUMENT_VIEWED',
  DOCUMENT_DOWNLOADED = 'DOCUMENT_DOWNLOADED',
  DOCUMENT_FIELDS_VIEWED = 'DOCUMENT_FIELDS_VIEWED',
  
  // Authority violations
  UNAUTHORIZED_ACCESS_ATTEMPT = 'UNAUTHORIZED_ACCESS_ATTEMPT',
  ORIGIN_AUTHORITY_VIOLATION = 'ORIGIN_AUTHORITY_VIOLATION',
}
```

**Invariants**:
1. ✅ Audit events are **immutable** (never updated or deleted)
2. ✅ **NO PHI in audit logs**: Only IDs, timestamps, event types
3. ✅ All document access events are logged
4. ✅ All authority changes are logged
5. ✅ Retention: 6+ years (HIPAA requirement)
6. ✅ Events are created synchronously (not async) to ensure audit trail integrity

**PHI Exclusion Rules**:
- ❌ Never log: document contents, OCR text, extracted field values, user names, emails, addresses
- ✅ Always log: documentId, userId, managerId, eventType, timestamp, success, action
- ✅ Optional metadata: fileSize, documentType, grantType (non-PHI metadata only)

---

## Entity Relationships

### Relationship Diagram

```
┌─────────────────────┐
│ManagerOrganization │
│  (Canonical)        │
│  Quest Diagnostics  │
└──────────┬───────────┘
           │ 1
           │ has
           │ N
           ▼
┌─────────────────────┐
│  ManagerInstance    │
│  (Origin/Secondary) │
│  Quest - Downtown   │
└──────────┬──────────┘
           │ 1
           │ creates/assigned
           │
           ▼
┌─────────────┐     1      ┌──────────────┐
│  Document   │────────────│DocumentOrigin│
│             │            │  (Immutable) │
└──────┬──────┘            └──────────────┘
       │
       │ N
       │ has
       │
       ▼
┌─────────────┐
│AccessGrant  │
│             │
│ subjectType │───┐
│ subjectId   │   │
└─────────────┘   │
                  │
       ┌──────────┴──────────┐
       │                     │
       │ N                   │ N
       │                     │
       ▼                     ▼
┌─────────────┐        ┌─────────────────────┐
│    User     │        │  ManagerInstance    │
│  (Intake)   │        │   (Secondary)       │
└─────────────┘        └─────────────────────┘

┌─────────────┐
│  Document   │
└──────┬──────┘
       │ N
       │ has
       │
       ▼
┌─────────────┐
│Revocation   │
│  Request    │
└─────────────┘

┌─────────────┐
│ AuditEvent  │
│             │
│ (References │
│  all above) │
└─────────────┘
```

### Relationship Details

**Document ↔ DocumentOrigin** (1:1)
- One document has exactly one origin record
- Origin record is created at document creation and never modified
- Used for immutable proof of origin authority

**Document ↔ AccessGrant** (1:N)
- One document can have many access grants
- Grants can be for users or managers
- Multiple grants can exist for the same subject (from different grantors)

**AccessGrant ↔ User** (N:1, when subjectType = 'user')
- A user can have many access grants across different documents
- Grants are document-specific

**AccessGrant ↔ Manager** (N:1, when subjectType = 'manager')
- A manager can have many access grants (as secondary manager)
- Origin manager has implicit access (may not have explicit grant)

**Document ↔ RevocationRequest** (1:N)
- One document can have many revocation requests (historical)
- Only one active request per subject per document (status = 'pending')

**User ↔ ManagerInstance** (N:M via UserManagerAssignment)
- Users can be assigned to managers for supervision/governance
- Separate from AccessGrants (document-level permissions)
- Assignment does not imply document access
- Only Admins or authorized Managers can create assignments
- Used for care team relationships, not document permissions

**All Entities ↔ AuditEvent** (N:N)
- All entities can generate audit events
- Audit events reference entities by ID (not foreign keys, for flexibility)

---

## Authority Boundaries

### Origin Manager Authority

**Full Custodial Authority**:
- ✅ Upload documents (becomes origin manager via self-origin)
- ✅ Trigger OCR processing
- ✅ Modify document metadata (fileName, description, documentType)
- ✅ Create owner-level access grants (to users or other managers)
- ✅ Revoke any access grant (including delegated grants)
- ✅ Approve/deny revocation requests
- ✅ Re-grant access after revocation
- ✅ View all access grants for their documents
- ✅ View audit events for their documents
- ✅ Accept/reject documents uploaded by users (optional workflow)

**Cannot**:
- ❌ Transfer origin authority to another manager (immutable)
- ❌ Delete documents (only revoke access)
- ❌ Override another origin manager's authority
- ❌ Modify OCR results (canonical data, immutable)
- ❌ Modify extracted fields (only users can edit fields for corrections)

### Secondary Manager Authority

**Limited Access**:
- ✅ View documents they have access grants for
- ✅ **View OCR results** (read-only, if granted)
- ✅ **View extracted fields** (read-only, if granted)
- ✅ Download documents (if granted)
- ✅ Manage documents for assigned users (if assigned via user-manager relationship)

**Cannot**:
- ❌ Trigger OCR processing
- ❌ Modify canonical document metadata
- ❌ Modify OCR results (canonical data, immutable)
- ❌ Modify extracted fields (only users can edit fields for corrections)
- ❌ Reprocess documents
- ❌ Create owner-level access grants
- ❌ Create revocation requests
- ❌ Override origin manager authority

### User Authority

**Access Broker & Intake Authority**:
- ✅ View documents they have access grants for
- ✅ View OCR results (if granted)
- ✅ View extracted fields (if granted)
- ✅ Download documents (if granted)
- ✅ Delegate access to other users or managers (creates delegated grants)
- ✅ Request revocation of their own access
- ✅ Request revocation of grants they created (delegated grants)
- ✅ **Upload documents as intake** with mandatory origin manager selection
- ✅ Select origin manager from verified directory or previously used managers

**Cannot**:
- ❌ Upload documents without selecting an origin manager
- ❌ Become origin manager (only Managers can be origin managers)
- ❌ Modify origin assignment after creation
- ❌ Trigger OCR processing
- ❌ Modify document metadata
- ❌ Create owner-level access grants
- ❌ Delete documents
- ❌ Override origin manager authority

### Admin Authority

**System-Level Authority**:
- ✅ Manage system configuration
- ✅ Assign managers to users (user-manager relationships)
- ✅ View all audit events (for compliance)
- ✅ Manage managers (create, update, suspend)

**Cannot**:
- ❌ Silently bypass custodial authority (must go through proper access grant flow)
- ❌ Delete documents (only revoke access)
- ❌ Override origin manager authority for specific documents

---

## System Invariants (Immutable Laws)

These are **non-negotiable rules** that must be enforced at the domain level:

1. ✅ **Document has exactly ONE origin_manager_id** - Set at creation, never changes
2. ✅ **Every document MUST resolve an Origin Manager at creation time** - No origin → no document creation
3. ✅ **Origin authority can never be transferred** - Immutable relationship
4. ✅ **Users cannot destroy documents** - Only access can be revoked
5. ✅ **Users upload documents only as intake** - Must explicitly select origin manager, custody assigned immediately
6. ✅ **Revocation is a workflow, not an action** - Requires origin manager approval
7. ✅ **Secondary managers cannot request deletion** - Only users can request revocation
8. ✅ **Access revocation cascades downstream** - Derived grants are revoked automatically
9. ✅ **Origin manager can always re-grant access** - Even after revocation
10. ✅ **Audit logs are immutable and PHI-safe** - Never updated, no PHI
11. ✅ **No PHI is stored in JWTs or logs** - Only IDs and metadata
12. ✅ **All access flows through domain services** - No direct repository access from controllers

---

## Cascade Logic

### Access Grant Revocation Cascade

When a delegated access grant is revoked:

1. **Primary Revocation**: Revoke the delegated grant (`revokedAt = now`, `revokedBy = actorId`)
2. **Cascade Check**: Find all derived grants where `grantedByType = 'user' AND grantedById = revokedGrant.subjectId`
3. **Cascade Revocation**: Revoke all derived grants (`revokedAt = now`, `cascadeRevoked = true`)
4. **Audit**: Create audit events for each revocation
5. **Notification** (future): Notify affected subjects (async, non-blocking)

**Example**:
```
User A has owner grant → delegates to User B (delegated grant)
User B delegates to Manager M (delegated grant)
Manager M delegates to User C (derived grant)

If User A revokes User B's access:
→ User B's delegated grant revoked
→ Manager M's delegated grant revoked (cascade)
→ User C's derived grant revoked (cascade)
```

### Revocation Request Approval Cascade

When origin manager approves a revocation request:

1. **Revoke Primary Grant**: Revoke the access grant for the requested subject
2. **Check Cascade Flag**: If `cascadeToSecondaryManagers = true`:
   - Find all derived grants for this document
   - Revoke all derived grants
3. **Update Request**: Set `status = 'approved'`, `reviewedAt = now`, `reviewedBy = managerId`
4. **Audit**: Create audit events for revocation and approval

---

## Failure Cases & Edge Cases

### Edge Case 1: User Delegates to Origin Manager

**Scenario**: User has delegated grant, delegates access to the origin manager.

**Resolution**: 
- Grant is created (no conflict)
- Origin manager already has implicit access, but explicit grant provides audit trail
- If user revokes their own access, the delegated grant to origin manager is revoked, but origin manager retains implicit access

### Edge Case 2: Circular Delegation

**Scenario**: User A delegates to User B, User B delegates to User A.

**Resolution**:
- Both grants are valid
- If one is revoked, the other remains (no circular dependency issue)
- Cascade logic handles each grant independently

### Edge Case 3: Multiple Origin Managers (Invalid State)

**Scenario**: System bug creates document with multiple origin records.

**Resolution**:
- Database constraint: `UNIQUE(documentId)` on `DocumentOrigin`
- Domain validation: Check `originManagerId` matches before allowing authority operations
- If detected: Log error, deny operation, alert admin

### Edge Case 4: Revocation Request for Non-Existent Grant

**Scenario**: User requests revocation but grant was already revoked.

**Resolution**:
- Check if grant exists and is active before creating request
- If grant doesn't exist: Return error "No active access grant found"
- If grant already revoked: Return error "Access already revoked"

### Edge Case 5: Origin Manager Revokes Own Access (Invalid)

**Scenario**: Origin manager attempts to revoke their own implicit access.

**Resolution**:
- Domain validation: Origin manager cannot revoke their own access
- Return error: "Origin manager cannot revoke their own custodial authority"
- Origin manager can only revoke explicit grants they created (owner grants to others)

### Edge Case 6: User Upload Without Origin Manager Selection

**Scenario**: User attempts to upload document without selecting an origin manager.

**Resolution**:
- Domain validation: `originManagerId` is required at document creation
- Return error: "Origin manager selection is required for document upload"
- User must select an origin manager from verified directory or previously used managers
- Upload is rejected if no manager is selected

### Edge Case 7: User Upload with Invalid/Non-Existent Manager

**Scenario**: User attempts to upload document with invalid manager ID or non-existent manager.

**Resolution**:
- Domain validation: Verify manager exists and is active
- Return error: "Selected origin manager not found or inactive"
- User must select a valid, active manager from verified directory

---

## Domain Service Responsibilities

### DocumentDomainService

**Responsibilities**:
- Create documents (with origin manager assignment)
- Validate origin authority before operations
- Coordinate OCR processing (only origin manager can trigger)
- Enforce access control rules
- Never allow hard deletes (only access revocation)

**Key Methods** (conceptual, not implementation):
- `createDocument(originManagerId, file, metadata, uploadedByType, uploadedById): Document` (validates origin manager exists)
- `createDocumentByUser(userId, file, metadata, originManagerId): Document` (user intake flow)
- `triggerOcr(documentId, managerId): void` (validates origin)
- `updateMetadata(documentId, managerId, updates): void` (validates origin)
- `getDocument(documentId, actorType, actorId): Document` (checks access grants)

### AccessGrantDomainService

**Responsibilities**:
- Create access grants (validates authority)
- Revoke access grants (with cascade logic)
- Resolve access queries (who has access to document X?)
- Enforce grant type rules (only origin manager creates owner grants)

**Key Methods** (conceptual):
- `grantAccess(documentId, grantorType, grantorId, subjectType, subjectId, grantType): AccessGrant`
- `revokeAccess(grantId, revokerType, revokerId): void` (with cascade)
- `hasAccess(documentId, subjectType, subjectId): boolean`
- `listAccessGrants(documentId, managerId): AccessGrant[]` (only origin manager)

### RevocationRequestDomainService

**Responsibilities**:
- Create revocation requests (validates eligibility)
- Route requests to origin manager
- Process approval/denial (with cascade logic)
- Enforce workflow rules (only origin manager can approve)

**Key Methods** (conceptual):
- `requestRevocation(documentId, requestedByType, requestedById, cascade): RevocationRequest`
- `approveRevocation(requestId, managerId): void` (validates origin)
- `denyRevocation(requestId, managerId, notes): void` (validates origin)

### AuditDomainService

**Responsibilities**:
- Create immutable audit events
- Validate no PHI in audit data
- Provide audit query interface (for compliance)
- Ensure synchronous logging (not async)

**Key Methods** (conceptual):
- `logEvent(eventType, actor, target, action, success, metadata): AuditEvent`
- `queryEvents(filters): AuditEvent[]` (for compliance reports)

---

## Assumptions & Design Decisions

### Assumption 1: Managers are Separate Entities
- **Rationale**: Managers represent healthcare providers/organizations, not individuals
- **Impact**: Separate `Manager` table, separate authentication (future: manager portal)
- **Alternative Considered**: Users with role=manager (rejected for clarity)

### Assumption 2: Users Can Upload Documents as Intake (UPDATED)
- **Rationale**: Real healthcare workflows allow patient-initiated intake (Quest, LabCorp patient portals)
- **Impact**: Users can upload, but must explicitly select origin manager; custody assigned immediately
- **Key Constraint**: Upload ≠ Ownership; Upload = Intake + Custody Assignment
- **Alternative Considered**: Only managers can upload (rejected - not clinically realistic)

### Assumption 3: Soft Delete for Users/Managers, Hard Delete Never for Documents
- **Rationale**: HIPAA retention requirements, audit trail preservation
- **Impact**: Documents are never deleted, only access is revoked
- **Retention**: Default 8 years, policy-configurable per organization
- **Alternative Considered**: Hard delete after retention (rejected - violates "never destroy" rule)

### Assumption 3a: Manager Verification is Mandatory
- **Rationale**: Prevents misattribution, impersonation, invalid provider routing
- **Impact**: Only verified managers can be selected by users
- **Onboarding**: Admin invitation only, no public self-signup
- **Alternative Considered**: Optional verification (rejected - security risk)

### Assumption 4: Origin Manager Has Implicit Access
- **Rationale**: Origin manager is custodian, doesn't need explicit grant
- **Impact**: Access resolution must check `document.originManagerId` in addition to grants
- **Alternative Considered**: Explicit owner grant for origin manager (rejected - redundant)

### Assumption 5: Cascade Revocation is Automatic
- **Rationale**: Prevents orphaned derived grants
- **Impact**: Revocation logic must traverse grant tree
- **Alternative Considered**: Manual cascade (rejected - too error-prone)

### Assumption 6: Multiple Grants Per Subject Allowed
- **Rationale**: Subject can receive grants from multiple grantors
- **Impact**: Access resolution uses UNION (any active grant = access)
- **Alternative Considered**: Single grant per subject (rejected - too restrictive)

### Assumption 7: Shared Authentication Infrastructure
- **Rationale**: Reduces complexity, mirrors industry practice
- **Impact**: Managers and users use same OAuth/JWT pipeline, distinction at domain layer
- **Alternative Considered**: Separate authentication (rejected - unnecessary complexity)

### Assumption 8: Bulk Operations Deferred
- **Rationale**: Reduces risk in regulated systems during early rollout
- **Impact**: No bulk upload/share/revocation in initial implementation
- **Future**: Consider after audit taxonomy finalized and cascade behavior proven
- **Alternative Considered**: Include bulk operations (rejected - too risky initially)

---

## User Upload Flow (Design-Level)

**Step-by-step (No Code)**:

1. User uploads document file
2. System requires origin manager selection (cannot proceed without)
3. User chooses:
   - Existing manager they've used before (from their history)
   - OR searches verified manager directory (e.g., "Quest Diagnostics")
4. User selects specific manager instance (e.g., "Quest Diagnostics - Downtown Lab")
5. System validates:
   - Manager exists and is active
   - Manager is verified (if required)
6. Document is created with:
   - `originManagerId = selected manager instance ID`
   - `uploadedByType = 'user'`
   - `uploadedById = userId`
7. Origin manager:
   - Gains implicit custodial access (no explicit grant needed)
   - Is notified (optional but recommended for workflow)
8. User receives delegated access grant (automatic, for the uploader)
9. Audit events recorded:
   - `DOCUMENT_INTAKE_BY_USER` (user uploaded)
   - `ORIGIN_MANAGER_ASSIGNED` (origin manager assigned)
   - `ACCESS_GRANTED` (user receives delegated access)

**If no manager is selected → upload is rejected with error.**

**This creates clear custody chain and defensible intake trail for HIPAA compliance.**

---

## Resolved Design Decisions

### 1. Manager Authentication: Shared Infrastructure ✅

**Decision**: Managers and users authenticate through the same OAuth system, session handling, and JWT issuance pipeline.

**Implementation**:
- Distinction between User and Manager is enforced at the domain and authorization layers, not at authentication
- Managers authenticate as a distinct principal type, not as users with elevated permissions
- No PHI or role-sensitive data is stored in JWTs beyond identifiers

**Rationale**: Reduces infrastructure complexity while preserving strict domain separation. Mirrors industry practice where staff and patients authenticate via the same IdP but resolve to different principals downstream.

---

### 2. User-Manager Assignment: Separate from AccessGrants ✅

**Decision**: A dedicated User-Manager Assignment relationship exists and is exposed via explicit endpoints.

**Purpose**:
- Defines governance/supervision relationships
- Independent from document-level permissions
- AccessGrants remain document-specific
- Assignment does not imply access to all documents
- AccessGrants are still required for visibility

**New Entity**: `UserManagerAssignment`
```typescript
class UserManagerAssignment {
  id: number;
  userId: number;                 // FK to User
  managerId: number;              // FK to ManagerInstance
  assignedBy: number;             // Admin or Manager ID who created assignment
  assignedAt: Date;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;               // Soft delete
}
```

**Rationale**: Separating supervision from document access prevents over-permissioning, enables fine-grained consent, and preserves clean audit semantics. Aligned with healthcare governance models (care teams vs record access).

---

### 3. Document Retention: 8 Years, Policy-Configurable ✅

**Decision**: Default retention period is 8 years, policy-configurable.

**Implementation**:
- Default retention period: 8 years
- Retention duration is:
  - Policy-driven (configurable per organization)
  - Organization-specific (can vary by ManagerOrganization)
  - Changeable without domain refactor
- Documents are never deleted before retention expiration

**Rationale**: 8 years exceeds HIPAA minimums and aligns with conservative healthcare data retention practices while remaining flexible.

---

### 4. Secondary Managers: Can View OCR Results ✅

**Decision**: Secondary managers may view OCR results and extracted fields (read-only access).

**Permissions**:
- ✅ View OCR results and extracted fields
- ✅ View document metadata
- ✅ Download documents (if granted)
- ❌ Trigger OCR
- ❌ Modify canonical fields
- ❌ Reprocess documents

**Rationale**: Supports referrals, second opinions, and coordinated care without compromising data integrity or custodial authority. All access is fully audited.

---

### 5. Bulk Operations: Deferred ✅

**Decision**: Not required in early phases; explicitly deferred.

**Scope**:
- No bulk upload, bulk share, or bulk revocation in initial implementation
- Bulk operations may be considered after:
  - Audit taxonomy is finalized
  - Revocation cascade behavior is proven safe
  - Monitoring and alerting are mature

**Rationale**: Bulk operations amplify risk in regulated systems. Deferring them reduces blast radius during early rollout.

---

### 6. Manager Verification: Mandatory ✅

**Decision**: Only verified managers can be selected as origin or secondary managers.

**Requirements**:
- Verification is required before appearing in any selection flow
- Unverified entities are invisible to users
- Verification status is checked before document creation

**Rationale**: Prevents misattribution of custodianship, impersonation, and accidental data routing to invalid providers.

---

### 7. Manager Directory: Internal, Invitation-Only ✅

**Decision**: Internal, invitation-only directory (no public self-signup).

**Onboarding Process**:
- Managers are onboarded via Admin invitation
- Must complete platform-enforced MFA
- Undergo internal verification before activation

**User Selection**:
- Users may only select:
  - Managers they've previously interacted with (from their history)
  - Managers from the internally verified directory

**Rationale**: Preserves trust, prevents spoofed providers, and aligns with enterprise healthcare onboarding practices.

---

### 8. Notifications: Async, Non-Blocking (Assumed)

**Decision**: Notifications are async and non-blocking (not explicitly decided, but assumed).

**Scope**:
- Users/managers are notified of access grants/revocations
- Notifications do not block document operations
- Notification failures do not affect document creation or access grants

**Status**: Assumed for design purposes; implementation details deferred to later phases.

---

## Next Steps

After approval of PHASE 0, proceed to:
- **PHASE 1**: Access Control Design (access decision matrix, role interactions)
- **PHASE 2**: Document Lifecycle (state machine, OCR authority, re-share behavior)
- **PHASE 3**: API Surface Design (endpoints, authorization, side effects)
- **PHASE 4**: Audit & HIPAA Strategy (event taxonomy, log schema, retention)
- **PHASE 5**: Implementation (incremental, module by module)

---

**Document Status**: ✅ All Open Questions Resolved - Ready for Final Approval  
**Version**: 1.2 (All Decisions Resolved)  
**Approval Required**: Yes (for final approval before Phase 1)  
**Implementation Blocking**: Yes (cannot proceed to Phase 1 without approval)

---

## Change Log

**Version 1.2** (Current):
- ✅ Resolved all open questions with explicit design decisions
- ✅ Added UserManagerAssignment entity (separate from AccessGrants)
- ✅ Clarified manager verification requirements (mandatory)
- ✅ Updated secondary manager OCR access (read-only permitted)
- ✅ Documented retention policy (8 years, configurable)
- ✅ Clarified authentication model (shared infrastructure)
- ✅ Documented manager directory model (internal, invitation-only)
- ✅ Deferred bulk operations to later phases

**Version 1.1**:
- ✅ Added user-initiated upload with mandatory origin manager selection
- ✅ Expanded Manager entity to ManagerOrganization + ManagerInstance model
- ✅ Added new audit events: `DOCUMENT_INTAKE_BY_USER`, `ORIGIN_MANAGER_ASSIGNED`, `ORIGIN_MANAGER_ACCEPTED_DOCUMENT`
- ✅ Updated User authority to include intake role
- ✅ Updated Document invariants to require origin manager at creation
- ✅ Added user upload flow documentation
- ✅ Updated edge cases and assumptions

**Version 1.0** (Original):
- Initial domain model with manager-only upload

