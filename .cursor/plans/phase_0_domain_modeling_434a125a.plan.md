---
name: Phase 0 Domain Modeling
overview: "PHASE 0: Domain Modeling for HIPAA-compliant Document Identity Management Platform. This phase defines all core domain entities, relationships, invariants, and authority boundaries WITHOUT any implementation code. The system is origin-centered, manager-governed, and user-mediated, where documents have immutable origin managers and users hold access grants (not ownership)."
todos:
  - id: phase-0-review
    content: Review PHASE 0 domain modeling document and approve before proceeding to Phase 1
    status: completed
  - id: phase-0-clarifications
    content: Answer open questions about manager authentication, user-manager assignments, retention period, OCR visibility, and bulk operations
    status: completed
    dependencies:
      - phase-0-review
---

# PHASE 0: Domain

Modeling - Document Identity Management Platform

## Status

**Phase**: 0 - Domain Modeling (NO CODE)**Status**: Awaiting Approval**Document**: [docs/phase-0-domain-modeling.md](docs/phase-0-domain-modeling.md)

## Overview

This phase defines the complete domain model for a HIPAA-compliant Document Identity Management Platform using Hexagonal Architecture. The system follows an **origin-centered, manager-governed, user-mediated** access model where:

- Documents have exactly ONE immutable origin manager (healthcare provider)
- Users NEVER own documents — they only hold access grants
- Deletion is a revocation workflow, not document destruction
- All actions are auditable and HIPAA-compliant

## Core Domain Entities Defined

### 1. Document

- Immutable `originManagerId` (set once, never changes)
- File storage (GCS URIs), OCR results (PHI), metadata
- Status lifecycle: UPLOADED → STORED → PROCESSING → PROCESSED → ERROR
- Never deleted (only access revoked)

### 2. DocumentOrigin

- Immutable historical record of document origin
- 1:1 relationship with Document
- Used for audit trail and authority resolution

### 3. AccessGrant

- Represents access to documents (not ownership)
- Grant types: `owner` (origin manager only), `delegated` (user-created), `derived` (auto-created)
- Subject types: `user` or `manager`
- Revocation cascades to derived grants

### 4. RevocationRequest

- Workflow for access revocation (not immediate action)
- Status: `pending` → `approved` | `denied` | `cancelled`
- Only origin manager can approve/deny
- Cascade option for secondary managers

### 5. User

- Individual (patient) who receives access grants
- Role always = 'user' (never manager)
- Can delegate access, request revocation
- **Can upload documents as intake** with mandatory origin manager selection
- Cannot trigger OCR or modify document metadata

### 6. ManagerInstance

- Specific instance/location of a healthcare provider organization
- Belongs to a ManagerOrganization (e.g., "Quest Diagnostics - Downtown Lab")
- Can be origin manager (full custodial authority)
- Can be secondary manager (view-only if granted)
- Cannot delete documents

### 6a. ManagerOrganization

- Canonical organizational identity (e.g., "Quest Diagnostics", "LabCorp")
- Has multiple ManagerInstances (locations, labs)
- Verification status determines if users can select
- Stable identifiers (NPI, CLIA, Tax ID)

### 7. AuditEvent

- Immutable audit log (HIPAA compliance)
- NO PHI in logs (only IDs, timestamps, event types)
- Retention: 6+ years
- Synchronous logging (not async)

## System Invariants (Immutable Laws)

1. Document has exactly ONE `originManagerId` (immutable)
2. **Every document MUST resolve an Origin Manager at creation time** (no origin → no document)
3. Origin authority can never be transferred
4. Users cannot destroy documents
5. **Users upload documents only as intake** (must explicitly select origin manager)
6. Revocation is a workflow, not an action
7. Secondary managers cannot request deletion
8. Access revocation cascades downstream
9. Origin manager can always re-grant access
10. Audit logs are immutable and PHI-safe
11. No PHI in JWTs or logs
12. All access flows through domain services

## Authority Boundaries

- **Origin Manager**: Full custodial authority (upload, OCR, metadata, re-share)
- **Secondary Manager**: View-only access (if granted)
- **User**: Access broker (view, delegate, request revocation)
- **Admin**: System-level operations (not document-level authority)

## Key Design Decisions

1. **Managers are separate entities** (not Users with role=manager)
2. **Users CAN upload documents as intake** (with mandatory origin manager selection)
3. **ManagerOrganization + ManagerInstance model** (canonical org identity + specific instances)
4. **Documents are never deleted** (only access revoked)
5. **Origin manager has implicit access** (no explicit grant needed)
6. **Cascade revocation is automatic** (prevents orphaned grants)
7. **Multiple grants per subject allowed** (union-based access resolution)
8. **Upload ≠ Ownership; Upload = Intake + Custody Assignment**

## Relationship Diagram

```
ManagerOrganization (Quest Diagnostics)
  └─ ManagerInstance (Quest - Downtown Lab) → Document → DocumentOrigin
                                              ↓
                                          AccessGrant
                                              ↓
                                      ┌───────┴───────┐
                                      │              │
                                    User        ManagerInstance (Secondary)
```

## User Upload Flow

1. User uploads document file
2. System requires origin manager selection (mandatory)
3. User selects from verified directory or previously used managers
4. Document created with `originManagerId` assigned immediately
5. User receives delegated access grant automatically
6. Origin manager gains implicit custodial access
7. Audit events: `DOCUMENT_INTAKE_BY_USER`, `ORIGIN_MANAGER_ASSIGNED`

## Next Steps After Approval

1. **PHASE 1**: Access Control Design (decision matrix, role interactions)
2. **PHASE 2**: Document Lifecycle (state machine, OCR authority)
3. **PHASE 3**: API Surface Design (endpoints, authorization)
4. **PHASE 4**: Audit & HIPAA Strategy (event taxonomy, retention)
5. **PHASE 5**: Implementation (incremental, module by module)

## Resolved Design Decisions ✅

1. **Manager Authentication**: Shared OAuth infrastructure (same as users, distinction at domain layer)
2. **User-Manager Assignment**: Separate entity from AccessGrants (supervision vs document permissions)
3. **Retention Period**: 8 years default, policy-configurable per organization
4. **Secondary Manager OCR Access**: Yes, read-only access permitted
5. **Bulk Operations**: Deferred to later phases (not in initial implementation)
6. **Manager Verification**: Mandatory - only verified managers can be selected
7. **Manager Directory**: Internal, invitation-only (no public self-signup)

All open questions resolved. See full details in [docs/phase-0-domain-modeling.md](docs/phase-0-domain-modeling.md) "Resolved Design Decisions" section.

## Deliverables

- ✅ Complete domain entity definitions (8 entities: Document, DocumentOrigin, AccessGrant, RevocationRequest, User, ManagerInstance, ManagerOrganization, UserManagerAssignment, AuditEvent)
- ✅ Relationship diagrams (updated with ManagerOrganization/ManagerInstance and UserManagerAssignment)
- ✅ User upload flow documentation
- ✅ Updated audit events for user intake
- ✅ ManagerOrganization/ManagerInstance model
- ✅ All open questions resolved with explicit design decisions
- ✅ UserManagerAssignment entity (separate from AccessGrants)

## Status Update

**Version**: 1.2 (All Decisions Resolved)

**Changes**:

- User-initiated upload with mandatory origin manager selection ✅
- All 7 open questions resolved with explicit design decisions ✅
- UserManagerAssignment entity added (separate from AccessGrants) ✅
- Manager verification requirements clarified (mandatory) ✅
- Secondary manager OCR access clarified (read-only permitted) ✅
- Retention policy documented (8 years, configurable) ✅
- Authentication model clarified (shared infrastructure) ✅
- Manager directory model documented (internal, invitation-only) ✅