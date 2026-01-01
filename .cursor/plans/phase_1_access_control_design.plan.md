# PHASE 1: Access Control Design - Document Identity Management Platform

## Status

**Phase**: 1 - Access Control Design (NO CODE)

**Status**: Awaiting Approval

**Document**: [docs/phase-1-access-control-design.md](docs/phase-1-access-control-design.md)

## Overview

This phase defines the complete access control design for the HIPAA-compliant Document Identity Management Platform. It specifies who can perform what actions on documents, how access decisions are made, and how role + origin interactions determine permissions.**Key Principle**: Access control is **origin-centered** - the origin manager's custodial authority is the foundation for all access decisions.

## Core Deliverables

### 1. Access Decision Matrices

- ✅ Document Operations Matrix (who can upload, view, modify, etc.)
- ✅ Access Grant Operations Matrix (who can create/revoke grants)
- ✅ Revocation Request Operations Matrix (who can create/approve requests)

### 2. Role + Origin Interaction Rules

- ✅ Origin Manager Rules (implicit access, full custodial authority)
- ✅ Secondary Manager Rules (explicit access only, read-only)
- ✅ User Rules (explicit access, delegation authority)
- ✅ Admin Rules (system-level only, no document access)

### 3. Access Grant Resolution

- ✅ Grant Type Hierarchy (Owner > Delegated > Derived)
- ✅ Access Resolution Algorithm (pseudocode)
- ✅ Grant Creation Rules (who can create what type)

### 4. Authority Resolution Algorithm

- ✅ Document Operation Authority Check (pseudocode)
- ✅ Revocation Request Authority Check (pseudocode)
- ✅ Step-by-step decision logic

### 5. Manager vs Secondary Manager Rules

- ✅ Origin Manager Capabilities & Restrictions
- ✅ Secondary Manager Capabilities & Restrictions
- ✅ UserManagerAssignment vs AccessGrant distinction

### 6. Access Control Enforcement Points

- ✅ Controller Layer (HTTP entry points)
- ✅ Domain Service Layer (business logic enforcement)
- ✅ Repository Layer (data access only)
- ✅ Access Grant Service (centralized resolution)

### 7. Edge Cases & Conflict Resolution

- ✅ Multiple grants for same subject
- ✅ Origin manager receives delegated grant
- ✅ Cascade revocation timing
- ✅ Revocation request for non-existent grant
- ✅ Secondary manager attempts owner grant
- ✅ User attempts grant without access
- ✅ Admin attempts document access
- ✅ Concurrent grant creation

## Key Design Decisions

1. **Origin-Centered Authority**: Origin manager is foundation of all access decisions
2. **Explicit Grants Required**: All access (except origin manager) requires explicit AccessGrant
3. **Grant Type Hierarchy**: Owner > Delegated > Derived (determines capabilities)
4. **Cascade Revocation**: Derived grants automatically revoked when parent revoked
5. **Separation of Concerns**: UserManagerAssignment (supervision) separate from AccessGrants (document access)
6. **No Admin Bypass**: Admins have no document-level access
7. **Audit Everything**: All access decisions are logged

## Access Control Flow

```javascript
Request → Controller → Domain Service → Access Grant Service → Access Decision
                                                                    ↓
                                                          ✅ Allow | ❌ Deny
                                                                    ↓
                                                          Audit Log + Response
```



## Next Steps After Approval

1. **PHASE 2**: Document Lifecycle (state machine, OCR authority, re-share behavior)
2. **PHASE 3**: API Surface Design (endpoints, authorization, side effects)
3. **PHASE 4**: Audit & HIPAA Strategy (event taxonomy, log schema, retention)
4. **PHASE 5**: Implementation (incremental, module by module)

## Status Update

**Version**: 1.0 (Initial Design)

**Status**: Ready for Review