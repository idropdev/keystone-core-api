# PHASE 2: Document Lifecycle Design - Document Identity Management Platform

## Document Version
**Version**: 1.0  
**Phase**: 2 - Document Lifecycle Design (NO CODE)  
**Status**: Awaiting Approval  
**Classification**: Internal - Architecture Design

---

## Executive Summary

This document defines the complete document lifecycle for the HIPAA-compliant Document Identity Management Platform. It specifies the state machine, OCR authority rules, re-share behavior, retention guarantees, and all state transitions from document creation through retention and eventual hard deletion.

**Key Principle**: Documents follow a strict lifecycle with origin manager custodial authority at every stage. OCR processing is origin-manager exclusive, and retention is immutable until policy expiration.

---

## Table of Contents

1. [Document State Machine](#1-document-state-machine)
2. [State Transitions & Rules](#2-state-transitions--rules)
3. [OCR Authority & Processing](#3-ocr-authority--processing)
4. [Re-Share Behavior](#4-re-share-behavior)
5. [Retention Guarantees](#5-retention-guarantees)
6. [Lifecycle Events & Audit](#6-lifecycle-events--audit)
7. [Error Handling & Recovery](#7-error-handling--recovery)

---

## 1. Document State Machine

### 1.1 State Diagram

```
                    ┌─────────────┐
                    │   UPLOADED   │
                    │  (Initial)   │
                    └──────┬───────┘
                           │
                           │ File stored to GCS
                           ▼
                    ┌─────────────┐
                    │   STORED     │
                    │              │
                    └──────┬───────┘
                           │
                           │ Origin manager triggers OCR
                           │ OR auto-trigger (if configured)
                           ▼
                    ┌─────────────┐
                    │  PROCESSING  │
                    │              │
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    │              │
                    ▼              ▼
            ┌─────────────┐  ┌─────────────┐
            │  PROCESSED   │  │    ERROR    │
            │  (Success)   │  │  (Failed)   │
            └──────────────┘  └──────┬───────┘
                                    │
                                    │ Retry (if configured)
                                    │
                                    ▼
                            ┌─────────────┐
                            │  PROCESSING │
                            │  (Retry)    │
                            └─────────────┘
```

### 1.2 State Definitions

**UPLOADED** (Initial State):
- Document metadata created in database
- File upload initiated but not yet stored
- `originManagerId` assigned (immutable)
- `rawFileUri` may be empty or pending
- No OCR processing started
- **Can transition to**: STORED, ERROR

**STORED**:
- File successfully stored in GCS
- `rawFileUri` populated
- Document ready for OCR processing
- Origin manager can trigger OCR
- **Can transition to**: PROCESSING, ERROR

**PROCESSING**:
- OCR processing initiated
- `processingStartedAt` timestamp set
- `processingMethod` determined (online vs batch)
- Processing in progress (async)
- **Can transition to**: PROCESSED, ERROR

**PROCESSED** (Terminal Success State for a given OCR run):
- OCR completed successfully
- `processedAt` timestamp set
- `ocrJsonOutput` populated (PHI - encrypted)
- `extractedText` populated (first 5000 chars)
- `confidence` score calculated
- `processedFileUri` may be populated (if batch mode)
- Extracted fields saved
- **No automatic transitions** (terminal for this OCR run)
- **Manual re-processing allowed**: Origin manager can trigger new OCR run (PROCESSED → PROCESSING)

**ERROR** (Recoverable Failure State):
- OCR processing failed
- `errorMessage` populated (sanitized)
- `retryCount` incremented
- **Can transition to**: PROCESSING (retry), STORED (manual retry), or remain ERROR
- **Retry Logic**: Configurable max retries (default: 3)

### 1.3 State Properties

Each state has associated metadata:

```typescript
// Conceptual (NO CODE)
interface DocumentState {
  status: DocumentStatus;
  rawFileUri?: string;           // Required for STORED+
  processedFileUri?: string;      // Optional, for batch processing
  ocrJsonOutput?: any;            // Required for PROCESSED
  extractedText?: string;         // Required for PROCESSED
  confidence?: number;            // Required for PROCESSED
  processingMethod?: ProcessingMethod; // Set in PROCESSING
  processingStartedAt?: Date; // Set in PROCESSING
  processedAt?: Date;             // Set in PROCESSED
  errorMessage?: string;          // Set in ERROR
  retryCount: number;             // Incremented on ERROR
}
```

---

## 2. State Transitions & Rules

### 2.1 Transition Rules Matrix

| From State | To State | Trigger | Authority Required | Notes |
|------------|----------|---------|-------------------|-------|
| UPLOADED | STORED | File upload complete | System | Automatic |
| UPLOADED | ERROR | Upload failure | System | Automatic |
| STORED | PROCESSING | OCR trigger | Origin Manager only | Manual or auto |
| STORED | ERROR | Pre-processing failure | System | Automatic |
| PROCESSING | PROCESSED | OCR success | System | Automatic |
| PROCESSING | ERROR | OCR failure | System | Automatic |
| ERROR | PROCESSING | Retry | Origin Manager or System | Configurable |
| ERROR | STORED | Manual reset | Origin Manager | Reset for re-trigger |
| PROCESSED | PROCESSING | Re-process | Origin Manager only | Manual re-processing (new OCR run) |

### 2.2 Transition Authority Rules

**UPLOADED → STORED**:
- **Authority**: System (automatic)
- **Trigger**: File upload to GCS completes
- **Validation**: File size, mime type validated
- **Side Effects**: `rawFileUri` set, audit event `DOCUMENT_STORED`

**STORED → PROCESSING**:
- **Authority**: Origin Manager only
- **Trigger**: `triggerOcr(documentId, managerId)` called
- **Validation**: 
  - `managerId === document.originManagerId` (must be origin manager)
  - Document status is STORED
  - File exists in GCS
- **Side Effects**: 
  - Status set to PROCESSING
  - `processingStartedAt` set
  - `processingMethod` determined (page count analysis)
  - Audit event `DOCUMENT_PROCESSING_STARTED`

**PROCESSING → PROCESSED**:
- **Authority**: System (automatic)
- **Trigger**: OCR service returns success
- **Validation**: OCR results valid, confidence threshold met
- **Side Effects**:
  - Status set to PROCESSED
  - `processedAt` set
  - `ocrJsonOutput` saved (encrypted)
  - `extractedText` saved (first 5000 chars)
  - `confidence` calculated
  - Extracted fields saved
  - Audit event `DOCUMENT_PROCESSING_COMPLETED`

**PROCESSING → ERROR**:
- **Authority**: System (automatic)
- **Trigger**: OCR service returns error or timeout
- **Validation**: Error message sanitized (no PHI)
- **Side Effects**:
  - Status set to ERROR
  - `errorMessage` set (sanitized)
  - `retryCount` incremented
  - Audit event `DOCUMENT_PROCESSING_FAILED`

**ERROR → PROCESSING** (Retry):
- **Authority**: Origin Manager or System (if auto-retry enabled)
- **Trigger**: Retry logic or manual retry
- **Validation**: 
  - `retryCount < maxRetries` (default: 3)
  - Origin manager authority (if manual)
- **Side Effects**:
  - Status set to PROCESSING
  - `processingStartedAt` updated
  - Audit event `DOCUMENT_PROCESSING_RETRY`

**PROCESSED → PROCESSING** (Re-process):
- **Authority**: Origin Manager only
- **Trigger**: `reprocessDocument(documentId, managerId)` called
- **Validation**: 
  - `managerId === document.originManagerId`
  - Document status is PROCESSED
- **Side Effects**:
  - Status set to PROCESSING
  - Previous OCR results preserved (historical)
  - New OCR run initiated
  - Audit event `DOCUMENT_REPROCESSING_STARTED`

### 2.3 Invalid Transitions

The following transitions are **forbidden** and must be rejected:

- ❌ STORED → PROCESSED (must go through PROCESSING)
- ❌ PROCESSED → STORED (cannot regress)
- ❌ PROCESSED → UPLOADED (cannot regress)
- ❌ ERROR → PROCESSED (must go through PROCESSING)
- ❌ Any transition by non-origin manager (except read operations)
- ❌ Any transition by user (users cannot trigger OCR)
- ❌ Any transition by secondary manager (no OCR authority)

---

## 3. OCR Authority & Processing

### 3.1 OCR Authority Rules

**Who Can Trigger OCR**:
- ✅ **Origin Manager**: Full authority to trigger OCR
- ❌ **Secondary Manager**: No OCR authority
- ❌ **User**: No OCR authority
- ❌ **Admin**: No OCR authority

**Authority Check**:
```
FUNCTION canTriggerOcr(documentId, actorType, actorId):
  document = getDocument(documentId)
  
  IF document.status !== 'STORED' AND document.status !== 'PROCESSED' THEN
    RETURN { allowed: false, reason: 'Document not in triggerable state' }
  END
  
  IF actorType !== 'manager' THEN
    RETURN { allowed: false, reason: 'Only managers can trigger OCR' }
  END
  
  IF actorId !== document.originManagerId THEN
    RETURN { allowed: false, reason: 'Only origin manager can trigger OCR' }
  END
  
  RETURN { allowed: true }
END
```

### 3.2 OCR Processing Modes

**Online Processing** (Synchronous):
- **Trigger**: Documents ≤ 15 pages (configurable)
- **Method**: Direct API call to Document AI
- **Duration**: 5-30 seconds
- **Result**: Immediate OCR results
- **Use Case**: Small documents, real-time processing

**Batch Processing** (Asynchronous):
- **Trigger**: Documents > 15 pages OR unknown page count
- **Method**: Batch API with GCS input/output
- **Duration**: 2-10 minutes
- **Result**: Results stored in GCS, polled for completion
- **Use Case**: Large documents, bulk processing

**Processing Method Selection**:
```
FUNCTION determineProcessingMethod(document):
  IF document.pageCount IS NULL THEN
    RETURN 'batch' (unknown size, use batch)
  END
  
  IF document.pageCount <= SYNC_MAX_PAGES THEN
    RETURN 'online'
  ELSE
    RETURN 'batch'
  END
END
```

### 3.3 OCR Processing Flow

**Step-by-Step** (No Code):

1. **Trigger**: Origin manager calls `triggerOcr(documentId, managerId)`
2. **Validation**: 
   - Check origin manager authority
   - Check document status (STORED or PROCESSED for re-process)
   - Validate file exists in GCS
3. **State Transition**: STORED → PROCESSING (or PROCESSED → PROCESSING for re-process)
4. **Method Selection**: Determine online vs batch based on page count
5. **Processing Initiation**:
   - Online: Direct API call
   - Batch: Upload to GCS, submit batch job
6. **Processing Execution**: Async OCR processing
7. **Result Handling**:
   - Success: PROCESSING → PROCESSED
   - Failure: PROCESSING → ERROR
8. **Audit**: Log processing start, completion, or failure

### 3.4 OCR Results Storage

**Canonical Data** (Immutable):
- `ocrJsonOutput`: Full Document AI JSON response (jsonb, encrypted)
- `extractedText`: Plain text extraction (first 5000 chars, encrypted)
- `confidence`: Overall confidence score (0-1)
- `processedAt`: Timestamp of processing

**Extracted Fields**:
- Stored in separate `extracted_fields` table
- Linked to document via `documentId`
- Can be edited by users (with audit trail)
- Original OCR values preserved

**Authority to Modify OCR Results**:
- ❌ **No one can modify OCR results** (canonical data, immutable)
- ✅ **Users can edit extracted fields** (user corrections, with audit trail)
- ❌ **Managers (including origin manager) cannot edit extracted fields** (only re-process OCR)
- ✅ **Origin manager can re-process** (new OCR run, preserves history)

**Key Separation**:
- **OCR Processing**: System + Origin Manager authority
- **Field Corrections**: User intent only (preserves OCR canonical data)

### 3.5 Re-Processing Rules

**When Re-Processing is Allowed**:
- Document status is PROCESSED
- Origin manager authority verified
- Previous OCR results preserved (historical record)

**Re-Processing Flow** (Manual, Origin Manager Only):
1. Origin manager calls `reprocessDocument(documentId, managerId)`
2. Previous OCR results archived (not deleted) - preserves historical integrity
3. Status transitions: PROCESSED → PROCESSING
4. New OCR run initiated
5. New results overwrite `ocrJsonOutput`, `extractedText`, `confidence`
6. Extracted fields updated (if schema changed)
7. Status transitions: PROCESSING → PROCESSED (new OCR run complete)
8. Audit event: `DOCUMENT_REPROCESSING_STARTED` and `DOCUMENT_REPROCESSING_COMPLETED`

**Note**: Re-processing is a manual action by origin manager. PROCESSED is terminal for a given OCR run, but origin manager can always trigger a new OCR run.

**Historical Preservation**:
- Previous OCR results can be stored in audit/version table (optional)
- Current results always reflect latest processing
- Audit trail shows re-processing history

---

## 4. Re-Share Behavior

### 4.1 Re-Share Authority

**Who Can Re-Share**:
- ✅ **Origin Manager**: Can create owner grants (full re-share authority)
- ✅ **Users with Access**: Can create delegated grants (limited re-share)
- ❌ **Secondary Managers**: Cannot re-share (read-only access)
- ❌ **Admins**: Cannot re-share (no document access)

### 4.2 Re-Share Scenarios

**Scenario 1: Origin Manager Re-Shares to User**
```
Origin Manager M1 creates owner grant to User U1
→ User U1 receives owner-level access
→ User U1 can view, download, delegate to others
→ User U1 cannot trigger OCR or modify metadata
```

**Scenario 2: Origin Manager Re-Shares to Secondary Manager**
```
Origin Manager M1 creates owner grant to Manager M2
→ Manager M2 receives owner-level access
→ Manager M2 can view, download, delegate to others
→ Manager M2 cannot trigger OCR or modify metadata (not origin)
→ Manager M2 cannot override M1's origin authority
```

**Scenario 3: User Re-Shares to Another User**
```
User U1 (has delegated grant) creates delegated grant to User U2
→ User U2 receives delegated access
→ User U2 can view, download
→ User U2 can delegate to others (creates derived grants)
→ If U1's grant revoked, U2's grant revoked (cascade)
```

**Scenario 4: User Re-Shares to Manager**
```
User U1 (has delegated grant) creates delegated grant to Manager M2
→ Manager M2 receives delegated access
→ System automatically creates derived grant for M2
→ Manager M2 can view, download (read-only)
→ If U1's grant revoked, M2's grant revoked (cascade)
```

### 4.3 Re-Share Constraints

**Origin Manager Constraints**:
- ✅ Can create owner grants to any user or manager
- ✅ Can revoke any grant (including delegated grants created by users)
- ❌ Cannot transfer origin authority (immutable)
- ❌ Cannot delete document (retention applies)

**User Constraints**:
- ✅ Can create delegated grants (if they have access)
- ✅ Can revoke delegated grants they created
- ❌ Cannot create owner grants
- ❌ Cannot revoke grants they didn't create (except via revocation request)

**Secondary Manager Constraints**:
- ❌ Cannot create any grants (read-only access)
- ❌ Cannot revoke any grants
- ❌ Cannot re-share access

### 4.4 Cascade Revocation on Re-Share

**Cascade Rules**:
- If delegated grant is revoked, all derived grants are revoked
- Cascade is automatic and transactional
- Cascade applies to both users and managers
- Origin manager can always re-grant access after revocation

**Example Cascade**:
```
User U1 has owner grant
  → U1 delegates to User U2 (delegated grant)
    → U2 delegates to Manager M1 (delegated grant)
      → System creates derived grant for M1
      → M1 delegates to User U3 (derived grant)

If U1 revokes U2's access:
  → U2's delegated grant revoked
  → M1's delegated grant revoked (cascade)
  → M1's derived grant revoked (cascade)
  → U3's derived grant revoked (cascade)
```

---

## 5. Retention Guarantees

### 5.1 Retention Policy

**Default Retention**: 8 years from document creation

**Policy Configuration**:
- Organization-specific retention periods
- Configurable per ManagerOrganization
- Minimum: 6 years (HIPAA requirement)
- Maximum: No maximum (can be indefinite)

**Retention Calculation**:
```
scheduledDeletionAt = document.createdAt + retentionYears
```

### 5.2 Retention Invariants

**Immutable Rules**:
1. ✅ Documents are **never deleted** before `scheduledDeletionAt`
2. ✅ `scheduledDeletionAt` is set at document creation (immutable)
3. ✅ Retention period cannot be shortened after creation
4. ✅ Retention period can be extended (policy update)
5. ✅ Access revocation does not affect retention
6. ✅ Document deletion is hard delete (not soft delete)

### 5.3 Retention Workflow

**Document Creation**:
1. Document created with `originManagerId`
2. `createdAt` timestamp set
3. `scheduledDeletionAt` calculated: `createdAt + retentionYears`
4. Retention policy determined by ManagerOrganization

**During Retention Period**:
- Document remains accessible (if access grants exist)
- Access can be revoked (does not affect retention)
- Document cannot be deleted
- OCR results preserved
- Audit logs preserved

**At Retention Expiration**:
1. Background job identifies documents where `scheduledDeletionAt < now`
2. Hard delete document from database
3. Delete file from GCS
4. Delete OCR results
5. Delete extracted fields
6. Audit event: `DOCUMENT_HARD_DELETED`
7. **Note**: Audit logs preserved (separate retention)

### 5.4 Retention Extension

**Policy Update**:
- Admin can update retention policy for ManagerOrganization
- New documents use new policy
- Existing documents: `scheduledDeletionAt` can be extended (not shortened)
- Extension requires audit log

**Extension Logic**:
```
IF newRetentionYears > currentRetentionYears THEN
  newScheduledDeletionAt = document.createdAt + newRetentionYears
  UPDATE document.scheduledDeletionAt = newScheduledDeletionAt
  Audit: DOCUMENT_RETENTION_EXTENDED
ELSE
  REJECT (cannot shorten retention)
END
```

### 5.5 Hard Delete Process

**When**: `scheduledDeletionAt < now`

**Process**:
1. **Database**: Hard delete document record (not soft delete)
2. **GCS**: Delete raw file from bucket
3. **GCS**: Delete processed file (if exists)
4. **Database**: Delete extracted fields (cascade)
5. **Audit**: Log hard delete event
6. **Note**: Access grants automatically deleted (cascade)

**Irreversibility**:
- Hard delete is permanent
- No recovery possible
- Audit logs remain (separate retention)
- Complies with HIPAA data minimization

---

## 6. Lifecycle Events & Audit

### 6.1 Lifecycle Event Taxonomy

**Document Creation Events**:
- `DOCUMENT_UPLOADED` - Manager upload (self-origin)
- `DOCUMENT_INTAKE_BY_USER` - User upload with origin selection
- `ORIGIN_MANAGER_ASSIGNED` - Origin manager assigned at creation
- `DOCUMENT_STORED` - File stored to GCS

**Processing Events**:
- `DOCUMENT_PROCESSING_STARTED` - OCR initiated
- `DOCUMENT_PROCESSING_COMPLETED` - OCR success
- `DOCUMENT_PROCESSING_FAILED` - OCR failure
- `DOCUMENT_PROCESSING_RETRY` - Retry initiated
- `DOCUMENT_REPROCESSING_STARTED` - Re-process initiated
- `DOCUMENT_REPROCESSING_COMPLETED` - Re-process success

**Access Events**:
- `DOCUMENT_VIEWED` - Document accessed
- `DOCUMENT_DOWNLOADED` - File downloaded
- `DOCUMENT_FIELDS_VIEWED` - Extracted fields viewed
- `ACCESS_GRANTED` - Access grant created
- `ACCESS_REVOKED` - Access grant revoked
- `ACCESS_DELEGATED` - Delegated grant created
- `ACCESS_DERIVED` - Derived grant created

**Retention Events**:
- `DOCUMENT_RETENTION_EXTENDED` - Retention period extended
- `DOCUMENT_HARD_DELETED` - Document deleted after retention

### 6.2 Audit Event Schema

**Standard Audit Event**:
```typescript
// Conceptual (NO CODE)
interface DocumentLifecycleAuditEvent {
  timestamp: Date;
  eventType: DocumentLifecycleEventType;
  documentId: string;
  actorType: 'user' | 'manager' | 'admin' | 'system';
  actorId: number;
  originManagerId: number;  // Always included for context
  success: boolean;
  metadata: {
    // State transition metadata
    fromStatus?: DocumentStatus;
    toStatus?: DocumentStatus;
    
    // Processing metadata
    processingMethod?: ProcessingMethod;
    confidence?: number;
    errorMessage?: string;  // Sanitized
    
    // Access metadata
    grantType?: 'owner' | 'delegated' | 'derived';
    subjectType?: 'user' | 'manager';
    subjectId?: number;
    
    // Retention metadata
    scheduledDeletionAt?: Date;
    retentionYears?: number;
    
    // NO PHI: No document contents, OCR text, or user names
  };
}
```

### 6.3 Audit Requirements

**HIPAA Compliance**:
- ✅ All lifecycle events logged
- ✅ All state transitions logged
- ✅ All access changes logged
- ✅ NO PHI in audit logs
- ✅ Retention: 6+ years (separate from document retention)
- ✅ Immutable logs (never updated or deleted)

**What is Logged**:
- ✅ Document IDs, manager IDs, user IDs
- ✅ Event types, timestamps, success/failure
- ✅ State transitions (from/to status)
- ✅ Processing metadata (method, confidence)
- ✅ Access grant metadata (type, subject)
- ❌ Document contents, OCR text, extracted field values
- ❌ User names, emails, addresses

---

## 7. Error Handling & Recovery

### 7.1 Error States

**ERROR State**:
- Document status set to ERROR
- `errorMessage` populated (sanitized, no PHI)
- `retryCount` incremented
- Previous state preserved (can recover)

**Error Types**:
- **Upload Error**: File upload to GCS failed
- **Processing Error**: OCR service failure
- **Storage Error**: Database write failure
- **Validation Error**: Invalid file format or size

### 7.2 Retry Logic

**Automatic Retry**:
- Configurable: `maxRetries` (default: 3)
- Exponential backoff: 1s, 2s, 4s delays
- Only for transient errors (network, timeout)
- Permanent errors: No retry, manual intervention required

**Manual Retry**:
- Origin manager can trigger retry
- Resets to STORED state (for re-trigger)
- Or transitions directly to PROCESSING (if configured)

**Retry Authority**:
- ✅ Origin Manager: Can trigger manual retry
- ✅ System: Can trigger automatic retry (if enabled)
- ❌ Secondary Manager: No retry authority
- ❌ User: No retry authority

### 7.3 Recovery Scenarios

**Scenario 1: Upload Failure**
```
State: UPLOADED → ERROR
Recovery: Retry upload
Action: User/Manager re-uploads file
Result: UPLOADED → STORED
```

**Scenario 2: OCR Processing Failure**
```
State: PROCESSING → ERROR
Recovery: Automatic retry (if enabled) or manual retry
Action: System retries or origin manager triggers retry
Result: ERROR → PROCESSING → PROCESSED (or ERROR again)
```

**Scenario 3: Storage Failure**
```
State: Any → ERROR (database write failed)
Recovery: Transaction rollback, retry operation
Action: System retries with exponential backoff
Result: Original state preserved, operation retried
```

### 7.4 Error Message Sanitization

**Sanitization Rules**:
- Remove PHI: No document contents, OCR text, user names
- Remove sensitive paths: No GCS URIs, file paths
- Truncate length: Max 500 characters
- Generic errors: "Processing failed" instead of detailed error
- Log detailed error: In system logs (not audit logs)

**Example**:
```
Raw Error: "OCR failed: Document contains 'John Doe' at line 5"
Sanitized: "OCR processing failed. Please retry or contact support."
Audit Log: { errorMessage: "OCR processing failed" }
System Log: [Full error with stack trace - not in audit]
```

---

## Summary

### Key Principles

1. **State Machine**: Strict state transitions with authority checks
2. **Origin Manager Authority**: Only origin manager can trigger OCR and re-process
3. **Retention Immutability**: Documents cannot be deleted before retention expiration
4. **Re-Share Cascade**: Delegated grant revocation cascades to derived grants
5. **Error Recovery**: Automatic and manual retry with exponential backoff
6. **Audit Everything**: All lifecycle events logged (no PHI)

### Lifecycle Flow

```
Upload → Store → Process → Processed
  ↓        ↓        ↓
Error   Error    Error
  ↓        ↓        ↓
Retry   Retry   Retry
```

### Next Steps

After approval of PHASE 2, proceed to:
- **PHASE 3**: API Surface Design (endpoints, authorization, side effects)
- **PHASE 4**: Audit & HIPAA Strategy (event taxonomy, log schema, retention)
- **PHASE 5**: Implementation (incremental, module by module)

---

**Document Status**: ✅ Ready for Review  
**Approval Required**: Yes  
**Implementation Blocking**: Yes (cannot proceed to Phase 3 without approval)

