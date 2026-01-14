# PHASE 1: Access Control Design - Document Identity Management Platform

## Document Version
**Version**: 1.0  
**Phase**: 1 - Access Control Design (NO CODE)  
**Status**: Awaiting Approval  
**Classification**: Internal - Architecture Design

---

## Executive Summary

This document defines the complete access control design for the HIPAA-compliant Document Identity Management Platform. It specifies who can perform what actions on documents, how access decisions are made, and how role + origin interactions determine permissions.

**Key Principle**: Access control is **origin-centered** - the origin manager's custodial authority is the foundation for all access decisions. All other access flows through explicit grants or derived permissions.

---

## Table of Contents

1. [Access Decision Matrix](#1-access-decision-matrix)
2. [Role + Origin Interaction Rules](#2-role--origin-interaction-rules)
3. [Access Grant Resolution](#3-access-grant-resolution)
4. [Authority Resolution Algorithm](#4-authority-resolution-algorithm)
5. [Manager vs Secondary Manager Rules](#5-manager-vs-secondary-manager-rules)
6. [Access Control Enforcement Points](#6-access-control-enforcement-points)
7. [Edge Cases & Conflict Resolution](#7-edge-cases--conflict-resolution)

---

## 1. Access Decision Matrix

### 1.1 Document Operations Matrix

| Operation | Origin Manager | Secondary Manager | User | Admin |
|-----------|---------------|-------------------|------|-------|
| **Upload Document** | ✅ Yes (self-origin) | ❌ No | ✅ Yes (with origin selection) | ❌ No |
| **View Document** | ✅ Yes (implicit) | ✅ Yes (if granted) | ✅ Yes (if granted) | ⚠️ System-level only |
| **Download Document** | ✅ Yes (implicit) | ✅ Yes (if granted) | ✅ Yes (if granted) | ⚠️ System-level only |
| **View OCR Results** | ✅ Yes (implicit) | ✅ Yes (if granted, read-only) | ✅ Yes (if granted) | ⚠️ System-level only |
| **View Extracted Fields** | ✅ Yes (implicit) | ✅ Yes (if granted, read-only) | ✅ Yes (if granted) | ⚠️ System-level only |
| **Trigger OCR** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Modify Metadata** | ✅ Yes (fileName, description, documentType) | ❌ No | ❌ No | ❌ No |
| **Modify OCR Results** | ❌ No (canonical) | ❌ No | ❌ No | ❌ No |
| **Modify Extracted Fields** | ❌ No (canonical) | ❌ No | ✅ Yes (user corrections) | ❌ No |
| **Grant Access (Owner)** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Grant Access (Delegated)** | ✅ Yes | ❌ No | ✅ Yes (to others) | ❌ No |
| **Revoke Access** | ✅ Yes (any grant) | ❌ No | ✅ Yes (own delegated grants) | ❌ No |
| **Request Revocation** | ❌ No (can approve/deny) | ❌ No | ✅ Yes (own access) | ❌ No |
| **Approve Revocation** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Delete Document** | ❌ No (retention) | ❌ No | ❌ No | ❌ No |

**Legend**:
- ✅ = Allowed
- ❌ = Not Allowed
- ⚠️ = System-level only (not document-level authority)

### 1.2 Access Grant Operations Matrix

| Operation | Origin Manager | Secondary Manager | User | Admin |
|-----------|---------------|-------------------|------|-------|
| **Create Owner Grant** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Create Delegated Grant** | ✅ Yes | ❌ No | ✅ Yes (if has access) | ❌ No |
| **View Own Grants** | ✅ Yes (all for their documents) | ✅ Yes (own grants only) | ✅ Yes (own grants only) | ⚠️ System-level |
| **View All Grants (Document)** | ✅ Yes (for their documents) | ❌ No | ❌ No | ⚠️ System-level |
| **Revoke Own Grant** | ✅ Yes (any grant for their documents) | ❌ No | ✅ Yes (delegated grants they created) | ❌ No |
| **Revoke Other's Grant** | ✅ Yes (any grant for their documents) | ❌ No | ❌ No | ❌ No |

### 1.3 Revocation Request Operations Matrix

| Operation | Origin Manager | Secondary Manager | User | Admin |
|-----------|---------------|-------------------|------|-------|
| **Create Request** | ❌ No (can approve/deny) | ❌ No | ✅ Yes (own access) | ❌ No |
| **Approve Request** | ✅ Yes (for their documents) | ❌ No | ❌ No | ❌ No |
| **Deny Request** | ✅ Yes (for their documents) | ❌ No | ❌ No | ❌ No |
| **Cancel Request** | ❌ No | ❌ No | ✅ Yes (own requests) | ❌ No |
| **View Requests** | ✅ Yes (for their documents) | ❌ No | ✅ Yes (own requests) | ⚠️ System-level |

---

## 2. Role + Origin Interaction Rules

### 2.1 Origin Manager Rules

**Definition**: The manager who is the immutable custodian of a document (set at creation, never changes).

**Authority Characteristics**:
1. **Implicit Access**: Origin manager always has access to their documents (no explicit grant needed)
2. **Full Custodial Authority**: Can perform all document operations except deletion
3. **Grant Authority**: Can create owner-level grants (full access) to any user or manager
4. **Revocation Authority**: Can revoke any access grant for their documents
5. **Workflow Authority**: Can approve/deny revocation requests for their documents
6. **OCR Authority**: Only origin manager can trigger OCR processing
7. **Metadata Authority**: Only origin manager can modify document metadata

**Access Resolution**:
```
IF actor.managerId === document.originManagerId THEN
  RETURN hasAccess = true
ELSE
  CHECK AccessGrants (see section 3)
END
```

### 2.2 Secondary Manager Rules

**Definition**: A manager who has received an access grant to a document (not the origin manager).

**Authority Characteristics**:
1. **Explicit Access Only**: Must have an active AccessGrant to view document
2. **Read-Only Access**: Can view OCR results and extracted fields, but cannot modify
3. **No OCR Authority**: Cannot trigger OCR or reprocess documents
4. **No Metadata Authority**: Cannot modify document metadata
5. **No Grant Authority**: Cannot create owner-level or delegated grants
6. **No Revocation Authority**: Cannot revoke access grants or create revocation requests
7. **Assignment-Based Access**: Can manage documents for assigned users (via UserManagerAssignment)

**Access Resolution**:
```
IF actor.managerId === document.originManagerId THEN
  RETURN hasAccess = true (implicit)
ELSE
  CHECK AccessGrants WHERE subjectType = 'manager' AND subjectId = actor.managerId
  IF found AND revokedAt IS NULL THEN
    RETURN hasAccess = true
  ELSE
    RETURN hasAccess = false
  END
END
```

### 2.3 User Rules

**Definition**: An individual (patient) who can receive access grants and act as an access broker.

**Authority Characteristics**:
1. **Explicit Access Only**: Must have an active AccessGrant to view document
2. **Intake Authority**: Can upload documents with mandatory origin manager selection
3. **Delegation Authority**: Can create delegated grants to other users or managers (if they have access)
4. **Revocation Authority**: Can revoke delegated grants they created
5. **Request Authority**: Can request revocation of their own access
6. **No OCR Authority**: Cannot trigger OCR or modify document metadata
7. **No Origin Authority**: Cannot become origin manager (only managers can be origin)

**Access Resolution**:
```
IF actor.userId === document.originManagerId THEN
  RETURN hasAccess = false (users cannot be origin managers)
ELSE
  CHECK AccessGrants WHERE subjectType = 'user' AND subjectId = actor.userId
  IF found AND revokedAt IS NULL THEN
    RETURN hasAccess = true
  ELSE
    RETURN hasAccess = false
  END
END
```

### 2.4 Admin Rules

**Definition**: System administrators with system-level (not document-level) authority.

**Authority Characteristics**:
1. **No Document-Level Authority**: Admins cannot access documents directly
2. **System Configuration**: Can manage system settings, retention policies
3. **Manager Management**: Can create/update/suspend managers
4. **User-Manager Assignment**: Can assign users to managers (UserManagerAssignment)
5. **Audit Access**: Can view all audit events (for compliance)
6. **No Document Access**: Cannot view, download, or modify documents
7. **No Bypass Authority**: Cannot silently bypass custodial authority

**Critical Rule**: **Admins are excluded from all document access flows and never appear as AccessGrant subjects.** Admin access is hard-denied at controller/guard level before reaching domain service.

**Access Resolution**:
```
// Admins are excluded from all document access flows and never appear as AccessGrant subjects.
// Admin access is hard-denied at controller/guard level before reaching domain service.
// This method is never called with actorType = 'admin'
```

---

## 3. Access Grant Resolution

### 3.1 Grant Type Hierarchy

**Owner Grant** (highest authority):
- Created by: Origin manager only
- Authority: Full access (view, download, re-share, cannot delete)
- Revocable by: Origin manager only
- Cannot be: Created by users or secondary managers

**Delegated Grant** (intermediate authority):
- Created by: Users (who have access) or origin manager
- Authority: View, download, delegate to others
- Revocable by: Creator of the grant OR origin manager
- Cascade: If revoked, all derived grants are revoked

**Derived Grant** (lowest authority):
- Created by: System automatically (when delegated grant is created for a manager)
- Authority: View, download (read-only)
- Revocable by: Origin manager OR cascade from parent delegated grant
- Cascade: Automatically revoked if parent delegated grant is revoked

### 3.2 Access Resolution Algorithm

```
FUNCTION hasAccess(documentId, actorType, actorId):
  // Step 1: Get document and origin manager
  document = getDocument(documentId)
  IF document NOT FOUND THEN
    RETURN false
  END
  
  // Step 2: Check origin manager implicit access
  IF actorType === 'manager' AND actorId === document.originManagerId THEN
    RETURN true (implicit access)
  END
  
  // Step 3: Check active access grants
  activeGrants = getActiveGrants(documentId, actorType, actorId)
  IF activeGrants.length > 0 THEN
    RETURN true (explicit access via grant)
  END
  
  // Step 4: Check derived grants (for managers)
  IF actorType === 'manager' THEN
    derivedGrants = getDerivedGrants(documentId, actorId)
    IF derivedGrants.length > 0 THEN
      RETURN true (derived access)
    END
  END
  
  // Step 5: No access found
  RETURN false
END
```

### 3.3 Grant Creation Rules

**Owner Grant Creation**:
```
FUNCTION canCreateOwnerGrant(actorType, actorId, documentId):
  document = getDocument(documentId)
  
  IF actorType !== 'manager' THEN
    RETURN false (only managers can create owner grants)
  END
  
  IF actorId !== document.originManagerId THEN
    RETURN false (only origin manager can create owner grants)
  END
  
  RETURN true
END
```

**Delegated Grant Creation**:
```
FUNCTION canCreateDelegatedGrant(actorType, actorId, documentId, subjectType, subjectId):
  // Check if actor has access to document
  IF NOT hasAccess(documentId, actorType, actorId) THEN
    RETURN false (actor must have access first)
  END
  
  // Users can create delegated grants
  IF actorType === 'user' THEN
    RETURN true
  END
  
  // Origin manager can create delegated grants
  document = getDocument(documentId)
  IF actorType === 'manager' AND actorId === document.originManagerId THEN
    RETURN true
  END
  
  RETURN false
END
```

**Derived Grant Creation** (automatic):
```
FUNCTION createDerivedGrantIfNeeded(delegatedGrant):
  IF delegatedGrant.subjectType === 'manager' THEN
    // Create derived grant for the manager
    derivedGrant = {
      documentId: delegatedGrant.documentId,
      subjectType: 'manager',
      subjectId: delegatedGrant.subjectId,
      grantedByType: 'system',
      grantedById: 0,
      grantType: 'derived',
      parentGrantId: delegatedGrant.id
    }
    saveGrant(derivedGrant)
  END
END
```

---

## 4. Authority Resolution Algorithm

### 4.1 Document Operation Authority Check

```
FUNCTION canPerformOperation(operation, documentId, actorType, actorId):
  document = getDocument(documentId)
  
  // Check if document exists
  IF document NOT FOUND THEN
    RETURN { allowed: false, reason: 'Document not found' }
  END
  
  // Check if actor has access
  IF NOT hasAccess(documentId, actorType, actorId) THEN
    RETURN { allowed: false, reason: 'No access to document' }
  END
  
  // Operation-specific authority checks
  SWITCH operation:
    CASE 'triggerOcr':
      IF actorType !== 'manager' OR actorId !== document.originManagerId THEN
        RETURN { allowed: false, reason: 'Only origin manager can trigger OCR' }
      END
      RETURN { allowed: true }
    
    CASE 'modifyMetadata':
      IF actorType !== 'manager' OR actorId !== document.originManagerId THEN
        RETURN { allowed: false, reason: 'Only origin manager can modify metadata' }
      END
      RETURN { allowed: true }
    
    CASE 'grantAccess':
      // Check grant type
      IF grantType === 'owner' THEN
        IF actorType !== 'manager' OR actorId !== document.originManagerId THEN
          RETURN { allowed: false, reason: 'Only origin manager can create owner grants' }
        END
      ELSE IF grantType === 'delegated' THEN
        IF actorType === 'user' OR (actorType === 'manager' AND actorId === document.originManagerId) THEN
          RETURN { allowed: true }
        ELSE
          RETURN { allowed: false, reason: 'Cannot create delegated grant' }
        END
      END
      RETURN { allowed: true }
    
    CASE 'revokeAccess':
      grant = getGrant(grantId)
      IF grant.grantType === 'owner' THEN
        IF actorType !== 'manager' OR actorId !== document.originManagerId THEN
          RETURN { allowed: false, reason: 'Only origin manager can revoke owner grants' }
        END
      ELSE IF grant.grantType === 'delegated' THEN
        IF grant.grantedByType === 'user' AND grant.grantedById === actorId THEN
          RETURN { allowed: true } (creator can revoke)
        ELSE IF actorType === 'manager' AND actorId === document.originManagerId THEN
          RETURN { allowed: true } (origin manager can revoke any grant)
        ELSE
          RETURN { allowed: false, reason: 'Cannot revoke this grant' }
        END
      END
      RETURN { allowed: true }
    
    CASE 'viewDocument':
    CASE 'downloadDocument':
    CASE 'viewOcrResults':
    CASE 'viewExtractedFields':
      // Read operations - if hasAccess passed, allow
      RETURN { allowed: true }
    
    DEFAULT:
      RETURN { allowed: false, reason: 'Unknown operation' }
  END
END
```

### 4.2 Revocation Request Authority Check

```
FUNCTION canCreateRevocationRequest(documentId, actorType, actorId):
  // Check if actor has access
  IF NOT hasAccess(documentId, actorType, actorId) THEN
    RETURN { allowed: false, reason: 'No access to revoke' }
  END
  
  // Only users can create revocation requests
  IF actorType !== 'user' THEN
    RETURN { allowed: false, reason: 'Only users can create revocation requests' }
  END
  
  // Check if active grant exists
  grant = getActiveGrant(documentId, actorType, actorId)
  IF grant NOT FOUND THEN
    RETURN { allowed: false, reason: 'No active access grant found' }
  END
  
  RETURN { allowed: true }
END

FUNCTION canApproveRevocationRequest(requestId, actorType, actorId):
  request = getRevocationRequest(requestId)
  document = getDocument(request.documentId)
  
  // Only origin manager can approve
  IF actorType !== 'manager' OR actorId !== document.originManagerId THEN
    RETURN { allowed: false, reason: 'Only origin manager can approve revocation requests' }
  END
  
  RETURN { allowed: true }
END
```

---

## 5. Manager vs Secondary Manager Rules

### 5.1 Origin Manager (Primary Custodian)

**Identity**: `managerId === document.originManagerId`

**Capabilities**:
- ✅ Implicit access (no grant needed)
- ✅ Trigger OCR processing
- ✅ Modify document metadata
- ✅ Create owner grants
- ✅ Create delegated grants
- ✅ Revoke any grant
- ✅ Approve/deny revocation requests
- ✅ View all grants for document
- ✅ Re-grant access after revocation

**Restrictions**:
- ❌ Cannot transfer origin authority
- ❌ Cannot delete document (retention applies)
- ❌ Cannot modify OCR results (canonical data)
- ❌ Cannot modify extracted fields (canonical data)

### 5.2 Secondary Manager (Grant Recipient)

**Identity**: `managerId !== document.originManagerId` AND has active AccessGrant

**Capabilities**:
- ✅ View document (if granted)
- ✅ Download document (if granted)
- ✅ View OCR results (read-only, if granted)
- ✅ View extracted fields (read-only, if granted)
- ✅ Manage documents for assigned users (via UserManagerAssignment)

**Restrictions**:
- ❌ No implicit access (must have grant)
- ❌ Cannot trigger OCR
- ❌ Cannot modify metadata
- ❌ Cannot modify OCR results
- ❌ Cannot modify extracted fields
- ❌ Cannot create owner grants
- ❌ Cannot create delegated grants
- ❌ Cannot revoke access grants
- ❌ Cannot create revocation requests
- ❌ Cannot approve/deny revocation requests

### 5.3 Manager Assignment vs Access Grant

**UserManagerAssignment** (Supervision):
- Purpose: Governance/supervision relationship
- Scope: User-level, not document-level
- Effect: Enables manager to manage user's documents (if they have access grants)
- Does NOT: Grant automatic access to all user's documents
- Separate from: AccessGrants (document-level permissions)

**AccessGrant** (Document Access):
- Purpose: Document-level permission
- Scope: Specific document
- Effect: Grants view/download access to specific document
- Required for: All document access (except origin manager implicit access)
- Separate from: UserManagerAssignment (supervision relationship)

**Key Distinction**:
```
UserManagerAssignment: "Manager M supervises User U"
  → Does NOT mean: "Manager M can access all of User U's documents"
  → Means: "Manager M can manage User U's documents IF they have AccessGrants"

AccessGrant: "Manager M has access to Document D"
  → Means: "Manager M can view/download Document D"
  → Independent of: UserManagerAssignment
```

---

## 6. Access Control Enforcement Points

### 6.1 Controller Layer (HTTP Entry Points)

**Enforcement**: Extract actor identity from JWT, validate request parameters

```typescript
// Conceptual (NO CODE)
@Controller('v1/documents')
@UseGuards(JwtAuthGuard)
class DocumentController {
  @Get(':id')
  async getDocument(@Param('id') documentId, @Request() req) {
    // Extract actor from JWT
    // Note: Admins are excluded - hard-denied at guard level before reaching controller
    actorType = req.user.type  // 'user' | 'manager' (admins never reach document endpoints)
    actorId = req.user.id
    
    // Delegate to domain service (enforces access control)
    return documentDomainService.getDocument(documentId, actorType, actorId)
  }
}
```

### 6.2 Domain Service Layer (Business Logic)

**Enforcement**: Check access grants, validate authority, enforce invariants

```typescript
// Conceptual (NO CODE)
class DocumentDomainService {
  async getDocument(documentId, actorType, actorId) {
    // Step 1: Check access
    if (!this.accessGrantService.hasAccess(documentId, actorType, actorId)) {
      throw new ForbiddenException('No access to document')
    }
    
    // Step 2: Get document
    document = await this.documentRepository.findById(documentId)
    
    // Step 3: Audit log
    this.auditService.logEvent({
      eventType: 'DOCUMENT_VIEWED',
      actorType,
      actorId,
      documentId,
      success: true
    })
    
    return document
  }
}
```

### 6.3 Repository Layer (Data Access)

**Enforcement**: No access control (data access only, domain service enforces)

```typescript
// Conceptual (NO CODE)
class DocumentRepository {
  async findById(documentId) {
    // No access control here - just data access
    return this.db.query('SELECT * FROM documents WHERE id = ?', [documentId])
  }
}
```

### 6.4 Access Grant Service (Centralized Resolution)

**Enforcement**: Single source of truth for access decisions

```typescript
// Conceptual (NO CODE)
class AccessGrantService {
  async hasAccess(documentId, actorType, actorId) {
    // Check origin manager implicit access
    document = await this.documentRepository.findById(documentId)
    if (actorType === 'manager' && actorId === document.originManagerId) {
      return true
    }
    
    // Check explicit grants
    grants = await this.accessGrantRepository.findActive(documentId, actorType, actorId)
    return grants.length > 0
  }
}
```

---

## 7. Edge Cases & Conflict Resolution

### Edge Case 1: Multiple Grants for Same Subject

**Scenario**: User has multiple active grants for the same document (from different grantors).

**Resolution**:
- Access resolution uses UNION (any active grant = access)
- All grants are valid and independent
- Revoking one grant does not affect others
- Highest authority grant determines capabilities

**Example**:
```
User U has:
  - Owner grant from Origin Manager M1 (full access)
  - Delegated grant from User U2 (view only)

Result: User U has full access (union of grants)
If Owner grant revoked: User U still has view access (delegated grant remains)
```

### Edge Case 2: Origin Manager Receives Delegated Grant

**Scenario**: User delegates access to the origin manager (who already has implicit access).

**Resolution**:
- Grant is created (provides audit trail)
- Origin manager has implicit access regardless
- If delegated grant is revoked, origin manager retains implicit access
- No conflict - explicit grant is redundant but harmless

### Edge Case 3: Cascade Revocation Timing

**Scenario**: Delegated grant is revoked while derived grants are being processed.

**Resolution**:
- Cascade revocation is atomic (transactional)
- All derived grants are revoked in same transaction
- If cascade fails, entire revocation is rolled back
- Audit events created for each revocation

### Edge Case 4: Revocation Request for Non-Existent Grant

**Scenario**: User requests revocation but grant was already revoked.

**Resolution**:
- Check if active grant exists before creating request
- If grant doesn't exist: Return error "No active access grant found"
- If grant already revoked: Return error "Access already revoked"
- Prevent duplicate requests for same grant

### Edge Case 5: Secondary Manager Attempts Owner Grant Creation

**Scenario**: Secondary manager attempts to create owner grant.

**Resolution**:
- Domain validation: Only origin manager can create owner grants
- Check: `actorId === document.originManagerId`
- Return error: "Only origin manager can create owner grants"
- Audit event: `ORIGIN_AUTHORITY_VIOLATION`

### Edge Case 6: User Attempts to Grant Access Without Having Access

**Scenario**: User attempts to create delegated grant but doesn't have access themselves.

**Resolution**:
- Domain validation: Actor must have access before creating grants
- Check: `hasAccess(documentId, actorType, actorId) === true`
- Return error: "Cannot grant access without having access"
- Prevents privilege escalation

### Edge Case 7: Admin Attempts Document Access

**Scenario**: Admin attempts to access document directly.

**Resolution**:
- **Prevention**: Admins are hard-denied at controller/guard level before reaching domain service
- Guards/Controllers: Reject admin requests to document endpoints with 403 Forbidden
- Domain service: Never receives admin requests (type system excludes 'admin' from actorType)
- Admin must use system-level endpoints (audit, configuration, manager management)

### Edge Case 8: Concurrent Grant Creation

**Scenario**: Multiple actors attempt to create grants for same subject simultaneously.

**Resolution**:
- Database constraint: `UNIQUE(documentId, subjectType, subjectId, revokedAt)` (for active grants)
- If duplicate detected: Return error "Active grant already exists"
- If grant was just revoked: Allow new grant creation
- Use optimistic locking or database transactions

---

## Summary

### Key Principles

1. **Origin-Centered Authority**: Origin manager is the foundation of all access decisions
2. **Explicit Grants Required**: All access (except origin manager) requires explicit AccessGrant
3. **Grant Type Hierarchy**: Owner > Delegated > Derived (determines capabilities)
4. **Cascade Revocation**: Derived grants automatically revoked when parent revoked
5. **Separation of Concerns**: UserManagerAssignment (supervision) separate from AccessGrants (document access)
6. **No Admin Bypass**: Admins have no document-level access
7. **Audit Everything**: All access decisions are logged

### Access Control Flow

```
Request → Controller → Domain Service → Access Grant Service → Access Decision
                                                                    ↓
                                                          ✅ Allow | ❌ Deny
                                                                    ↓
                                                          Audit Log + Response
```

### Next Steps

After approval of PHASE 1, proceed to:
- **PHASE 2**: Document Lifecycle (state machine, OCR authority, re-share behavior)
- **PHASE 3**: API Surface Design (endpoints, authorization, side effects)
- **PHASE 4**: Audit & HIPAA Strategy (event taxonomy, log schema, retention)
- **PHASE 5**: Implementation (incremental, module by module)

---

**Document Status**: ✅ Ready for Review  
**Approval Required**: Yes  
**Implementation Blocking**: Yes (cannot proceed to Phase 2 without approval)

