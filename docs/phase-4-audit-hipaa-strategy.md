# PHASE 4: Audit & HIPAA Strategy - Document Identity Management Platform

## Document Version
**Version**: 1.0  
**Phase**: 4 - Audit & HIPAA Strategy (NO CODE)  
**Status**: Awaiting Approval  
**Classification**: Internal - Architecture Design

---

## Executive Summary

This document defines the complete audit logging and HIPAA compliance strategy for the Document Identity Management Platform. It specifies the audit event taxonomy, log schema, retention requirements, PHI minimization guarantees, and integration with GCP Cloud Logging for compliance.

**Key Principle**: All audit events are immutable, PHI-safe, and retained for HIPAA compliance (6+ years). Audit logs provide a complete, defensible trail of all document access and authority changes.

---

## Table of Contents

1. [Audit Event Taxonomy](#1-audit-event-taxonomy)
2. [Audit Log Schema](#2-audit-log-schema)
3. [PHI Minimization Strategy](#3-phi-minimization-strategy)
4. [Retention Strategy](#4-retention-strategy)
5. [Audit Event Lifecycle](#5-audit-event-lifecycle)
6. [GCP Cloud Logging Integration](#6-gcp-cloud-logging-integration)
7. [Compliance Requirements](#7-compliance-requirements)
8. [Audit Query Interface](#8-audit-query-interface)

---

## 1. Audit Event Taxonomy

### 1.1 Event Categories

**Document Lifecycle Events**:
- Document creation, storage, processing, deletion
- OCR processing lifecycle
- State transitions

**Access Control Events**:
- Access grants created, revoked, delegated
- Document access (view, download, fields viewed)
- Unauthorized access attempts

**Revocation Workflow Events**:
- Revocation requests created, approved, denied, cancelled
- Access revocation execution

**Authority Violation Events**:
- Unauthorized access attempts
- Origin authority violations
- Privilege escalation attempts

**System Events**:
- Manager assignments created/removed
- Manager verification status changes
- Retention policy updates

### 1.2 Complete Event Type Enum

```typescript
// Conceptual (NO CODE)
enum AuditEventType {
  // Document Lifecycle
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
  DOCUMENT_INTAKE_BY_USER = 'DOCUMENT_INTAKE_BY_USER',
  DOCUMENT_STORED = 'DOCUMENT_STORED',
  DOCUMENT_PROCESSING_STARTED = 'DOCUMENT_PROCESSING_STARTED',
  DOCUMENT_PROCESSING_COMPLETED = 'DOCUMENT_PROCESSING_COMPLETED',
  DOCUMENT_PROCESSING_FAILED = 'DOCUMENT_PROCESSING_FAILED',
  DOCUMENT_PROCESSING_RETRY = 'DOCUMENT_PROCESSING_RETRY',
  DOCUMENT_REPROCESSING_STARTED = 'DOCUMENT_REPROCESSING_STARTED',
  DOCUMENT_REPROCESSING_COMPLETED = 'DOCUMENT_REPROCESSING_COMPLETED',
  DOCUMENT_METADATA_UPDATED = 'DOCUMENT_METADATA_UPDATED',
  DOCUMENT_HARD_DELETED = 'DOCUMENT_HARD_DELETED',
  DOCUMENT_RETENTION_EXTENDED = 'DOCUMENT_RETENTION_EXTENDED',
  
  // Access Control
  ACCESS_GRANTED = 'ACCESS_GRANTED',
  ACCESS_REVOKED = 'ACCESS_REVOKED',
  ACCESS_DELEGATED = 'ACCESS_DELEGATED',
  ACCESS_DERIVED = 'ACCESS_DERIVED',
  DOCUMENT_VIEWED = 'DOCUMENT_VIEWED',
  DOCUMENT_DOWNLOADED = 'DOCUMENT_DOWNLOADED',
  DOCUMENT_FIELDS_VIEWED = 'DOCUMENT_FIELDS_VIEWED',
  DOCUMENT_FIELDS_EDITED = 'DOCUMENT_FIELDS_EDITED',
  
  // Revocation Workflow
  REVOCATION_REQUESTED = 'REVOCATION_REQUESTED',
  REVOCATION_APPROVED = 'REVOCATION_APPROVED',
  REVOCATION_DENIED = 'REVOCATION_DENIED',
  REVOCATION_CANCELLED = 'REVOCATION_CANCELLED',
  
  // Authority Violations
  UNAUTHORIZED_ACCESS_ATTEMPT = 'UNAUTHORIZED_ACCESS_ATTEMPT',
  ORIGIN_AUTHORITY_VIOLATION = 'ORIGIN_AUTHORITY_VIOLATION',
  PRIVILEGE_ESCALATION_ATTEMPT = 'PRIVILEGE_ESCALATION_ATTEMPT',
  
  // Manager & Assignment Events
  MANAGER_ASSIGNMENT_CREATED = 'MANAGER_ASSIGNMENT_CREATED',
  MANAGER_ASSIGNMENT_REMOVED = 'MANAGER_ASSIGNMENT_REMOVED',
  MANAGER_VERIFIED = 'MANAGER_VERIFIED',
  MANAGER_SUSPENDED = 'MANAGER_SUSPENDED',
  
  // Origin Assignment
  ORIGIN_MANAGER_ASSIGNED = 'ORIGIN_MANAGER_ASSIGNED',
  ORIGIN_MANAGER_ACCEPTED_DOCUMENT = 'ORIGIN_MANAGER_ACCEPTED_DOCUMENT',
}
```

### 1.3 Event Severity Levels

**INFO** (Normal Operations):
- Document lifecycle events (upload, process, store)
- Access grants/revocations
- Successful access operations

**WARN** (Unusual but Expected):
- Processing failures (retryable)
- Revocation denials
- Retry operations

**ERROR** (Failures):
- Processing failures (non-retryable)
- System errors
- Validation failures

**SECURITY** (Violations):
- Unauthorized access attempts
- Origin authority violations
- Privilege escalation attempts

---

## 2. Audit Log Schema

### 2.1 Standard Audit Event Structure

```typescript
// Conceptual (NO CODE)
interface AuditEvent {
  // Identity
  id: number;                        // Auto-increment, immutable
  eventType: AuditEventType;         // Event category
  timestamp: Date;                   // ISO 8601, immutable
  
  // Actor (who performed the action)
  actorType: 'user' | 'manager' | 'admin' | 'system';
  actorId: number;                   // User ID, Manager ID, Admin ID, or 0 (system)
  
  // Target (what was acted upon)
  targetType?: 'document' | 'access_grant' | 'revocation_request' | 'user' | 'manager';
  targetId?: string | number;        // Document UUID, Grant ID, Request ID, etc.
  
  // Document Context (if applicable)
  documentId?: string;               // UUID
  originManagerId?: number;          // Always included for document events
  
  // Access Context (if applicable)
  accessSubjectType?: 'user' | 'manager';
  accessSubjectId?: number;          // Subject of access grant/revocation
  grantType?: 'owner' | 'delegated' | 'derived';
  
  // Outcome
  success: boolean;                  // true = succeeded, false = failed
  errorType?: string;                // Sanitized error type (no PHI)
  errorMessage?: string;             // Sanitized error message (no PHI)
  
  // Request Context (not PHI)
  ipAddress?: string;                // Request IP (for security monitoring)
  userAgent?: string;                // Sanitized user agent (truncated to 200 chars)
  
  // Event-Specific Metadata (NO PHI)
  metadata?: {
    // Document lifecycle metadata
    fromStatus?: DocumentStatus;
    toStatus?: DocumentStatus;
    processingMethod?: ProcessingMethod;
    confidence?: number;              // OCR confidence (0-1)
    fileSize?: number;               // Bytes (not PHI)
    documentType?: DocumentType;
    
    // Access metadata
    cascadeRevoked?: boolean;
    cascadeCount?: number;            // Number of grants revoked in cascade
    
    // Revocation metadata
    requestType?: 'self_revocation' | 'user_revocation' | 'manager_revocation';
    cascadeToSecondaryManagers?: boolean;
    reviewNotes?: string;             // Sanitized (no PHI)
    
    // Field edit metadata
    fieldKey?: string;                // Field identifier (not value)
    fieldCount?: number;           // Number of fields edited
    
    // Retention metadata
    retentionYears?: number;
    scheduledDeletionAt?: Date;
    
    // Manager metadata
    organizationId?: number;
    verificationStatus?: 'verified' | 'pending' | 'rejected';
    
    // NO PHI: Never include document contents, OCR text, field values, user names, emails
  };
  
  // Environment
  environment: 'development' | 'staging' | 'production';
  service: 'keystone-core-api';
  component: 'document-processing' | 'access-control' | 'revocation' | 'manager';
}
```

### 2.2 Event-Specific Examples

**Document Upload Event**:
```json
{
  "id": 1001,
  "eventType": "DOCUMENT_INTAKE_BY_USER",
  "timestamp": "2025-01-20T10:30:00Z",
  "actorType": "user",
  "actorId": 456,
  "targetType": "document",
  "targetId": "uuid-here",
  "documentId": "uuid-here",
  "originManagerId": 123,
  "success": true,
  "metadata": {
    "documentType": "lab_result",
    "fileSize": 1024000,
    "originUserContextId": 456
  },
  "environment": "production",
  "service": "keystone-core-api",
  "component": "document-processing"
}
```

**Access Grant Event**:
```json
{
  "id": 1002,
  "eventType": "ACCESS_GRANTED",
  "timestamp": "2025-01-20T12:00:00Z",
  "actorType": "user",
  "actorId": 456,
  "targetType": "access_grant",
  "targetId": 789,
  "documentId": "uuid-here",
  "originManagerId": 123,
  "accessSubjectType": "user",
  "accessSubjectId": 999,
  "grantType": "delegated",
  "success": true,
  "metadata": {
    "grantedByType": "user",
    "grantedById": 456
  },
  "environment": "production",
  "service": "keystone-core-api",
  "component": "access-control"
}
```

**Document Access Event**:
```json
{
  "id": 1003,
  "eventType": "DOCUMENT_VIEWED",
  "timestamp": "2025-01-20T14:00:00Z",
  "actorType": "manager",
  "actorId": 123,
  "targetType": "document",
  "targetId": "uuid-here",
  "documentId": "uuid-here",
  "originManagerId": 123,
  "accessSubjectType": "manager",
  "accessSubjectId": 123,
  "success": true,
  "metadata": {
    "accessType": "implicit_origin"  // or "explicit_grant"
  },
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "environment": "production",
  "service": "keystone-core-api",
  "component": "document-processing"
}
```

**Unauthorized Access Attempt**:
```json
{
  "id": 1004,
  "eventType": "UNAUTHORIZED_ACCESS_ATTEMPT",
  "timestamp": "2025-01-20T15:00:00Z",
  "actorType": "user",
  "actorId": 999,
  "targetType": "document",
  "targetId": "uuid-here",
  "documentId": "uuid-here",
  "originManagerId": 123,
  "accessSubjectType": "user",
  "accessSubjectId": 999,
  "success": false,
  "errorType": "ACCESS_DENIED",
  "errorMessage": "No active access grant found",
  "ipAddress": "192.168.1.200",
  "environment": "production",
  "service": "keystone-core-api",
  "component": "access-control"
}
```

---

## 3. PHI Minimization Strategy

### 3.1 PHI Exclusion Rules

**Never Log** (Strict Prohibition):
- ❌ Document file contents
- ❌ OCR extracted text (full text)
- ❌ Extracted field values (patient names, dates, test results, etc.)
- ❌ User names (firstName, lastName)
- ❌ Email addresses
- ❌ Physical addresses
- ❌ Phone numbers
- ❌ Medical record numbers
- ❌ Insurance information
- ❌ Any health-related data

**Always Log** (Safe Identifiers):
- ✅ Document IDs (UUIDs)
- ✅ User IDs (numeric)
- ✅ Manager IDs (numeric)
- ✅ Event types
- ✅ Timestamps
- ✅ Status values
- ✅ File sizes (bytes, not PHI)
- ✅ Document types (lab_result, prescription - categories, not content)
- ✅ Field keys (identifiers like "patient_name", not values)

### 3.2 Sanitization Functions

**Error Message Sanitization**:
```
FUNCTION sanitizeErrorMessage(error: string): string {
  // Remove email addresses
  error = error.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
  
  // Remove tokens
  error = error.replace(/Bearer\s+[^\s]+/gi, 'Bearer [TOKEN_REDACTED]');
  error = error.replace(/token[:\s]+[^\s]+/gi, 'token: [REDACTED]');
  
  // Remove potential PHI patterns
  error = error.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN_REDACTED]');  // SSN pattern
  error = error.replace(/\d{10,}/g, '[NUMBER_REDACTED]');          // Long numbers
  
  // Truncate
  return error.substring(0, 500);
}
```

**User Agent Sanitization**:
```
FUNCTION sanitizeUserAgent(ua: string): string {
  // Truncate to 200 chars (removes potential fingerprinting data)
  return ua.substring(0, 200);
}
```

**Metadata Sanitization**:
```
FUNCTION sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized = { ...metadata };
  
  // Remove any field values
  if (sanitized.fieldValue) delete sanitized.fieldValue;
  if (sanitized.editedValue) delete sanitized.editedValue;
  if (sanitized.ocrText) delete sanitized.ocrText;
  
  // Remove user names
  if (sanitized.userName) delete sanitized.userName;
  if (sanitized.patientName) delete sanitized.patientName;
  
  // Keep only safe identifiers
  return sanitized;
}
```

### 3.3 Field Edit Event PHI Safety

**Correct Approach** (No PHI):
```json
{
  "eventType": "DOCUMENT_FIELDS_EDITED",
  "metadata": {
    "fieldKey": "patient_name",      // ✅ Safe: identifier only
    "fieldCount": 3,                 // ✅ Safe: count, not values
    "documentId": "uuid-here"        // ✅ Safe: UUID
  }
  // ❌ Never include: fieldValue, editedValue, or any actual data
}
```

**Incorrect Approach** (PHI Leakage):
```json
{
  "eventType": "DOCUMENT_FIELDS_EDITED",
  "metadata": {
    "fieldKey": "patient_name",
    "fieldValue": "John Doe",       // ❌ PHI LEAKAGE
    "editedValue": "John A. Doe"     // ❌ PHI LEAKAGE
  }
}
```

---

## 4. Retention Strategy

### 4.1 Audit Log Retention

**Retention Period**: 6+ years (HIPAA minimum requirement)

**Rationale**:
- HIPAA requires audit logs for 6 years (45 CFR § 164.312(b))
- Healthcare organizations often retain for 7-10 years for legal defensibility
- Longer retention provides better audit trail for investigations

**Retention Calculation**:
```
auditLogRetentionYears = 6  // Minimum, configurable
auditLogScheduledDeletionAt = createdAt + (auditLogRetentionYears * 365 days)
```

### 4.2 Retention Implementation

**Storage Strategy**:
1. **Immediate Storage**: Audit events written to PostgreSQL (for query performance)
2. **Archive to GCS**: Events older than 30 days archived to GCS (cost optimization)
3. **GCP Cloud Logging**: All events forwarded to Cloud Logging (compliance)
4. **Retention Enforcement**: Background job deletes events older than retention period

**Retention Workflow**:
```
Event Created → PostgreSQL (immediate)
  ↓ (after 30 days)
GCS Archive (long-term storage)
  ↓ (after retention period)
Hard Delete (irreversible)
```

### 4.3 Immutability Guarantees

**Audit Log Immutability**:
- ✅ Events are **never updated** (only created)
- ✅ Events are **never soft-deleted** (only hard-deleted after retention)
- ✅ Events are **never modified** (corrections via new events)
- ✅ Database constraints prevent updates: `UPDATE audit_events SET ...` should fail

**Database Constraints**:
```sql
-- Conceptual (NO CODE)
CREATE TABLE audit_events (
  id SERIAL PRIMARY KEY,
  -- ... fields ...
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- No updated_at column (immutable)
  -- No deleted_at column (hard delete only)
  
  -- Prevent updates
  CONSTRAINT no_updates CHECK (true)  -- Enforced at application level
);
```

**Application-Level Enforcement**:
- Repository methods: `save()` only, no `update()` method
- Domain service: Only creates events, never modifies
- Validation: Reject any update attempts

---

## 5. Audit Event Lifecycle

### 5.1 Event Creation Flow

```
Operation Occurs
  ↓
Domain Service Validates
  ↓
Domain Service Calls AuditService.logEvent()
  ↓
AuditService Validates No PHI
  ↓
AuditService Creates AuditEvent Entity
  ↓
Repository Saves to Database (synchronous)
  ↓
Event Forwarded to GCP Cloud Logging (async, non-blocking)
  ↓
Event Available for Queries
```

### 5.2 Synchronous vs Asynchronous Logging

**Synchronous Logging** (Required):
- Database write (PostgreSQL)
- PHI validation
- Event creation

**Rationale**: Ensures audit trail integrity. If operation succeeds but audit fails, operation should fail (fail-safe).

**Asynchronous Logging** (Optional):
- GCP Cloud Logging forward
- SIEM integration
- Alert processing

**Rationale**: External systems can fail without affecting core operations. Retry logic handles failures.

### 5.3 Event Creation Failure Handling

**Scenario**: Operation succeeds but audit event creation fails.

**Resolution**:
1. **Transaction Rollback**: Operation and audit must be atomic
2. **Retry Logic**: Retry audit event creation with exponential backoff
3. **Alert**: If audit consistently fails, alert operations team
4. **Fail-Safe**: If audit cannot be created after retries, operation fails

**Implementation**:
```typescript
// Conceptual (NO CODE)
async performOperation(...) {
  const transaction = await db.beginTransaction();
  try {
    // Perform operation
    const result = await operation(...);
    
    // Create audit event (synchronous, in transaction)
    await auditService.logEvent({
      eventType: 'OPERATION_PERFORMED',
      actorType,
      actorId,
      success: true,
      // ... metadata
    });
    
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

---

## 6. GCP Cloud Logging Integration

### 6.1 Cloud Logging Structure

**Log Name**: `projects/{project-id}/logs/keystone-core-api-audit`

**Log Entry Format**:
```json
{
  "logName": "projects/healthatlas/logs/keystone-core-api-audit",
  "timestamp": "2025-01-20T10:30:00Z",
  "severity": "INFO",
  "jsonPayload": {
    // Full AuditEvent structure (as defined in section 2.1)
    "id": 1001,
    "eventType": "DOCUMENT_VIEWED",
    "actorType": "user",
    "actorId": 456,
    // ... rest of audit event
  },
  "labels": {
    "environment": "production",
    "service": "keystone-core-api",
    "component": "document-processing"
  }
}
```

### 6.2 Log Forwarding Strategy

**Immediate Forwarding** (Non-Blocking):
```typescript
// Conceptual (NO CODE)
async logEvent(event: AuditEvent): Promise<void> {
  // 1. Save to database (synchronous, blocking)
  await this.auditRepository.save(event);
  
  // 2. Forward to Cloud Logging (async, non-blocking, fire-and-forget)
  this.cloudLoggingClient.write(event).catch(error => {
    // Log error but don't fail operation
    console.error('Cloud Logging forward failed', error);
    // TODO: Retry logic or dead letter queue
  });
}
```

**Retry Logic**:
- Exponential backoff: 1s, 2s, 4s, 8s
- Max retries: 3
- Dead letter queue: Failed events stored for manual review

### 6.3 Cloud Logging Retention

**Retention Policy**:
- **Cloud Logging Retention**: 7 years (exceeds HIPAA minimum)
- **Storage Class**: Standard (frequent access needed for compliance queries)
- **Location**: Same region as application (US-Central1 for HIPAA)

**Cost Optimization**:
- Archive old logs to Cloud Storage (after 1 year)
- Use log-based metrics for alerting (reduces query costs)
- Set up log sinks to BigQuery for analytics (optional)

### 6.4 Log Query Interface

**Cloud Logging Queries**:
```
// Find all document access for a user
resource.type="keystone-core-api"
jsonPayload.actorType="user"
jsonPayload.actorId=456
jsonPayload.eventType=~"DOCUMENT_.*"

// Find all unauthorized access attempts
jsonPayload.eventType="UNAUTHORIZED_ACCESS_ATTEMPT"
jsonPayload.success=false

// Find all access grants for a document
jsonPayload.documentId="uuid-here"
jsonPayload.eventType=~"ACCESS_.*"
```

---

## 7. Compliance Requirements

### 7.1 HIPAA Technical Safeguards

**Access Control (§164.312(a)(1))**:
- ✅ Unique user identification (actorId in audit logs)
- ✅ Emergency access procedures (logged)
- ✅ Automatic logoff (session expiration logged)

**Audit Controls (§164.312(b))**:
- ✅ Audit logging implemented
- ✅ Log retention: 6+ years
- ✅ Log integrity: Immutable logs
- ✅ Log access: Authorized personnel only

**Integrity (§164.312(c)(1))**:
- ✅ Audit logs are immutable
- ✅ No PHI in audit logs
- ✅ Tamper-resistant storage (GCP Cloud Logging)

**Person or Entity Authentication (§164.312(d))**:
- ✅ All access authenticated (JWT validation logged)
- ✅ Failed authentication attempts logged

**Transmission Security (§164.312(e)(1))**:
- ✅ TLS 1.3 for all API requests
- ✅ Audit logs transmitted over encrypted channels

### 7.2 Audit Log Access Control

**Who Can Access Audit Logs**:
- ✅ **Admins**: Full access to all audit logs (for compliance)
- ✅ **Origin Managers**: Access to audit logs for their documents only
- ❌ **Users**: No access to audit logs
- ❌ **Secondary Managers**: No access to audit logs

**Audit Log Query Endpoints**:
```
GET /v1/audit/events
  - Admins: All events
  - Origin Managers: Events for their documents only
  - Query params: eventType, documentId, actorId, dateRange, etc.
```

### 7.3 Compliance Reporting

**Required Reports**:
1. **Access Report**: Who accessed what document when
2. **Authority Report**: All access grant/revocation events
3. **Violation Report**: All unauthorized access attempts
4. **Retention Report**: Documents and logs scheduled for deletion

**Report Generation**:
- Query audit events from Cloud Logging or database
- Filter by date range, event type, document, actor
- Export to CSV/JSON for compliance review
- No PHI in reports (only IDs and metadata)

---

## 8. Audit Query Interface

### 8.1 GET /v1/audit/events

**Purpose**: Query audit events (admin or origin manager).

**Authorization**:
- ✅ Admins: Can query all events
- ✅ Origin Managers: Can query events for their documents only
- ❌ Users: No access
- ❌ Secondary Managers: No access

**Request**:
```
GET /v1/audit/events?eventType=DOCUMENT_VIEWED&documentId=uuid&startDate=2025-01-01&endDate=2025-01-31&page=1&limit=100
Authorization: Bearer <token>
```

**Query Parameters**:
- `eventType`: Filter by event type
- `documentId`: Filter by document UUID
- `actorType`: Filter by actor type (user | manager | admin | system)
- `actorId`: Filter by actor ID
- `originManagerId`: Filter by origin manager ID
- `startDate`: Start date (ISO 8601)
- `endDate`: End date (ISO 8601)
- `success`: Filter by success (true | false)
- `page`: Page number
- `limit`: Items per page (max: 1000)

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": 1001,
      "eventType": "DOCUMENT_VIEWED",
      "timestamp": "2025-01-20T10:30:00Z",
      "actorType": "user",
      "actorId": 456,
      "documentId": "uuid-here",
      "originManagerId": 123,
      "success": true,
      "metadata": {
        "accessType": "explicit_grant"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 5000
  }
}
```

**Side Effects**:
1. Admin/Origin Manager authority validation
2. Query filtering (origin managers only see their documents)
3. No audit event (read operation, not access)

**Errors**:
- `400 Bad Request`: Invalid query parameters
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Insufficient authority (user or secondary manager)

---

### 8.2 GET /v1/audit/events/:eventId

**Purpose**: Get specific audit event details.

**Authorization**:
- ✅ Admins: Can view any event
- ✅ Origin Managers: Can view events for their documents only
- ❌ Users: No access
- ❌ Secondary Managers: No access

**Request**:
```
GET /v1/audit/events/{eventId}
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "id": 1001,
  "eventType": "DOCUMENT_VIEWED",
  "timestamp": "2025-01-20T10:30:00Z",
  "actorType": "user",
  "actorId": 456,
  "targetType": "document",
  "targetId": "uuid-here",
  "documentId": "uuid-here",
  "originManagerId": 123,
  "accessSubjectType": "user",
  "accessSubjectId": 456,
  "success": true,
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "metadata": {
    "accessType": "explicit_grant"
  },
  "environment": "production",
  "service": "keystone-core-api",
  "component": "document-processing"
}
```

**Side Effects**:
1. Authority validation
2. No audit event (read operation)

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Insufficient authority OR event not for origin manager's documents
- `404 Not Found`: Event doesn't exist

---

### 8.3 GET /v1/audit/reports/access

**Purpose**: Generate access report (compliance).

**Authorization**:
- ✅ Admins: Can generate reports
- ✅ Origin Managers: Can generate reports for their documents
- ❌ Users: No access
- ❌ Secondary Managers: No access

**Request**:
```
GET /v1/audit/reports/access?documentId=uuid&startDate=2025-01-01&endDate=2025-01-31&format=csv
Authorization: Bearer <token>
```

**Query Parameters**:
- `documentId`: Specific document (optional)
- `startDate`: Start date (required)
- `endDate`: End date (required)
- `format`: csv | json (default: json)

**Response** (200 OK, CSV or JSON):
```csv
timestamp,eventType,actorType,actorId,documentId,originManagerId,success
2025-01-20T10:30:00Z,DOCUMENT_VIEWED,user,456,uuid-here,123,true
2025-01-20T11:00:00Z,DOCUMENT_DOWNLOADED,user,456,uuid-here,123,true
```

**Side Effects**:
1. Query audit events
2. Format as CSV or JSON
3. No audit event (report generation, not access)

**Errors**:
- `400 Bad Request`: Missing required parameters, invalid date range
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Insufficient authority

---

## Summary

### Key Principles

1. **Immutability**: Audit events are never updated or soft-deleted
2. **PHI Safety**: No PHI in audit logs (only IDs, timestamps, event types)
3. **Retention**: 6+ years (HIPAA minimum, configurable)
4. **Synchronous Core**: Database writes are synchronous (fail-safe)
5. **Asynchronous Forward**: Cloud Logging forward is async (non-blocking)
6. **Access Control**: Only admins and origin managers can query audit logs

### Audit Coverage

- ✅ All document lifecycle events
- ✅ All access control events
- ✅ All revocation workflow events
- ✅ All authority violations
- ✅ All system configuration changes

### Compliance

- ✅ HIPAA Technical Safeguards met
- ✅ Audit log retention: 6+ years
- ✅ Immutable, tamper-resistant logs
- ✅ Authorized access only
- ✅ Defensible audit trail

### Next Steps

After approval of PHASE 4, proceed to:
- **PHASE 5**: Implementation (incremental, module by module)

---

**Document Status**: ✅ Ready for Review  
**Approval Required**: Yes  
**Implementation Blocking**: Yes (cannot proceed to Phase 5 without approval)






