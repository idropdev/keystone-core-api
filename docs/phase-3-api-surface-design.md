# PHASE 3: API Surface Design - Document Identity Management Platform

## Document Version
**Version**: 1.0  
**Phase**: 3 - API Surface Design (NO CODE)  
**Status**: Awaiting Approval  
**Classification**: Internal - Architecture Design

---

## Executive Summary

This document defines the complete REST API surface for the HIPAA-compliant Document Identity Management Platform. It specifies all endpoints, their purposes, required authorization, expected side effects, and request/response contracts.

**Key Principle**: All endpoints follow the origin-centered, AccessGrant-driven access model. Authorization is enforced at the controller/guard level, with domain services handling business logic.

**API Version**: `/v1/` (all endpoints versioned)

---

## Table of Contents

1. [API Design Principles](#1-api-design-principles)
2. [Document Endpoints](#2-document-endpoints)
3. [Access Grant Endpoints](#3-access-grant-endpoints)
4. [Revocation Request Endpoints](#4-revocation-request-endpoints)
5. [OCR Processing Endpoints](#5-ocr-processing-endpoints)
6. [Manager Endpoints](#6-manager-endpoints)
7. [User Manager Assignment Endpoints](#7-user-manager-assignment-endpoints)
8. [Common Response Patterns](#8-common-response-patterns)
9. [Error Handling](#9-error-handling)
10. [Authorization Enforcement](#10-authorization-enforcement)

---

## 1. API Design Principles

### 1.1 RESTful Design

- **Resource-based URLs**: `/v1/documents/{id}`, `/v1/access-grants/{id}`
- **HTTP Methods**: GET (read), POST (create), PATCH (partial update), DELETE (soft delete/revoke)
- **JSON Request/Response**: All endpoints use JSON
- **Versioning**: All endpoints under `/v1/` prefix

### 1.2 Authorization Model

- **JWT Required**: All endpoints require `Authorization: Bearer <token>` header
- **Actor Extraction**: Actor type and ID extracted from JWT payload
- **Guard Enforcement**: Guards reject admins from document endpoints before domain service
- **Domain Service Validation**: Domain services enforce AccessGrant-based access control

### 1.3 Audit Requirements

- **All Mutations Logged**: Create, update, delete operations generate audit events
- **Access Events Logged**: View, download operations generate audit events
- **No PHI in Logs**: Only IDs, timestamps, event types
- **Synchronous Logging**: Audit events created synchronously (not async)

### 1.4 HIPAA Compliance

- **No PHI in URLs**: Document IDs are UUIDs (not sequential)
- **No PHI in Query Params**: Only metadata filters (status, type, date ranges)
- **Signed URLs for Downloads**: Time-limited signed URLs (24 hours)
- **Rate Limiting**: All endpoints rate-limited (especially upload/auth endpoints)

---

## 2. Document Endpoints

### 2.1 POST /v1/documents/upload

**Purpose**: Upload a new document with mandatory origin manager selection.

**Authorization**:
- ✅ Users: Can upload (intake role)
- ✅ Managers: Can upload (self-origin)
- ❌ Admins: No document access

**Request**:
```json
POST /v1/documents/upload
Content-Type: multipart/form-data

{
  "file": <File>,                    // Required: PDF, image, etc.
  "documentType": "lab_result",      // Required: lab_result | prescription | etc.
  "originManagerId": 123,            // Required: Manager instance ID
  "description": "Annual checkup"    // Optional: User-provided description
}
```

**Response** (201 Created):
```json
{
  "id": "uuid-here",
  "originManagerId": 123,
  "originUserContextId": 456,        // Present if uploaded by user
  "documentType": "lab_result",
  "status": "UPLOADED",
  "fileName": "lab-report.pdf",
  "fileSize": 1024000,
  "mimeType": "application/pdf",
  "createdAt": "2025-01-20T10:30:00Z",
  "scheduledDeletionAt": "2033-01-20T10:30:00Z"  // 8 years from creation
}
```

**Side Effects**:
1. Document entity created with `originManagerId` (immutable)
2. File uploaded to GCS (async)
3. Document status updated to STORED (after upload completes)
4. Default delegated AccessGrant created for uploader (if user uploaded)
5. Origin manager gains implicit access (no explicit grant needed)
6. Audit events:
   - `DOCUMENT_INTAKE_BY_USER` (if user uploaded)
   - `DOCUMENT_UPLOADED` (if manager uploaded)
   - `ORIGIN_MANAGER_ASSIGNED`
   - `ACCESS_GRANTED` (if user uploaded, default delegated grant)

**Validation**:
- File size: Max 10MB (configurable)
- File type: PDF, images (configurable)
- Origin manager must exist and be verified
- Origin manager must be active

**Errors**:
- `400 Bad Request`: Invalid file, missing originManagerId, invalid documentType
- `403 Forbidden`: Origin manager not verified or inactive
- `413 Payload Too Large`: File exceeds size limit
- `415 Unsupported Media Type`: Invalid file type

---

### 2.2 GET /v1/documents/:documentId

**Purpose**: Get document metadata (not file content).

**Authorization**:
- ✅ Origin Manager: Implicit access
- ✅ Users/Managers: Must have active AccessGrant
- ❌ Admins: Hard-denied (guard level)

**Request**:
```
GET /v1/documents/{documentId}
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "id": "uuid-here",
  "originManagerId": 123,
  "originUserContextId": 456,        // Only visible to origin manager and auditors
  "documentType": "lab_result",
  "status": "PROCESSED",
  "fileName": "lab-report.pdf",
  "fileSize": 1024000,
  "mimeType": "application/pdf",
  "pageCount": 3,
  "description": "Annual checkup",
  "confidence": 0.95,                // OCR confidence (if processed)
  "createdAt": "2025-01-20T10:30:00Z",
  "processedAt": "2025-01-20T10:35:00Z",
  "scheduledDeletionAt": "2033-01-20T10:30:00Z"
}
```

**Side Effects**:
1. AccessGrant resolution (domain service)
2. Audit event: `DOCUMENT_VIEWED`

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: No access grant (or admin attempting access)
- `404 Not Found`: Document doesn't exist OR no access (security: same response)

---

### 2.3 GET /v1/documents/:documentId/download

**Purpose**: Get time-limited signed URL for document file download.

**Authorization**:
- ✅ Origin Manager: Implicit access
- ✅ Users/Managers: Must have active AccessGrant
- ❌ Admins: Hard-denied

**Request**:
```
GET /v1/documents/{documentId}/download
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "downloadUrl": "https://storage.googleapis.com/bucket/path/file.pdf?X-Goog-Algorithm=...",
  "expiresIn": 86400,                // 24 hours in seconds
  "expiresAt": "2025-01-21T10:30:00Z"
}
```

**Side Effects**:
1. AccessGrant resolution
2. Signed URL generation (GCS)
3. Audit event: `DOCUMENT_DOWNLOADED`

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: No access grant
- `404 Not Found`: Document doesn't exist OR no access
- `409 Conflict`: Document not in STORED or PROCESSED state (file not available)

---

### 2.4 GET /v1/documents

**Purpose**: List documents accessible to the requesting actor.

**Authorization**:
- ✅ Origin Manager: Sees documents where `originManagerId = actorId`
- ✅ Users/Managers: Sees documents with active AccessGrants
- ❌ Admins: Hard-denied

**Request**:
```
GET /v1/documents?page=1&limit=20&status=PROCESSED&documentType=lab_result
Authorization: Bearer <token>
```

**Query Parameters**:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)
- `status`: Filter by status (UPLOADED | STORED | PROCESSING | PROCESSED | ERROR)
- `documentType`: Filter by type (lab_result | prescription | etc.)
- `sortBy`: Sort field (createdAt | processedAt | fileName) (default: createdAt)
- `sortOrder`: asc | desc (default: desc)

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "uuid-1",
      "originManagerId": 123,
      "documentType": "lab_result",
      "status": "PROCESSED",
      "fileName": "lab-report.pdf",
      "createdAt": "2025-01-20T10:30:00Z",
      "processedAt": "2025-01-20T10:35:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

**Side Effects**:
1. AccessGrant-based query (includes origin manager implicit access)
2. No per-document audit events (list operation, not individual access)

**Errors**:
- `400 Bad Request`: Invalid query parameters
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Admin attempting access

---

### 2.5 GET /v1/documents/:documentId/status

**Purpose**: Get document processing status (for polling OCR completion).

**Authorization**:
- ✅ Origin Manager: Implicit access
- ✅ Users/Managers: Must have active AccessGrant
- ❌ Admins: Hard-denied

**Request**:
```
GET /v1/documents/{documentId}/status
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "id": "uuid-here",
  "status": "PROCESSING",
  "progress": 65,                    // 0-100, only for PROCESSING
  "processingMethod": "online",      // online | batch
  "processingStartedAt": "2025-01-20T10:35:00Z",
  "processedAt": null,               // null until PROCESSED
  "errorMessage": null,              // null unless ERROR
  "retryCount": 0
}
```

**Side Effects**:
1. AccessGrant resolution
2. No audit event (status check, not access)

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: No access grant
- `404 Not Found`: Document doesn't exist OR no access

---

### 2.6 GET /v1/documents/:documentId/fields

**Purpose**: Get extracted fields (OCR results + user edits).

**Authorization**:
- ✅ Origin Manager: Implicit access
- ✅ Users/Managers: Must have active AccessGrant
- ❌ Admins: Hard-denied

**Request**:
```
GET /v1/documents/{documentId}/fields
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "documentId": "uuid-here",
  "ocrFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "Jon Doe",       // Original OCR value
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": false
    }
  ],
  "editedFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "Jon Doe",       // Original OCR value (preserved)
      "editedValue": "John Doe",     // User correction
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": true,
      "editedBy": 456,               // User ID who edited
      "editedAt": "2025-01-20T11:00:00Z"
    }
  ],
  "mergedFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "John Doe",      // Edited value (takes precedence)
      "editedValue": "John Doe",
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": true,
      "editedBy": 456,
      "editedAt": "2025-01-20T11:00:00Z"
    }
  ]
}
```

**Side Effects**:
1. AccessGrant resolution
2. Audit event: `DOCUMENT_FIELDS_VIEWED`

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: No access grant
- `404 Not Found`: Document doesn't exist OR no access
- `409 Conflict`: Document not PROCESSED (no fields available)

---

### 2.7 PATCH /v1/documents/:documentId/fields

**Purpose**: Edit extracted fields (user corrections only).

**Authorization**:
- ✅ Users: Can edit (if have access grant)
- ❌ Managers: Cannot edit (read-only)
- ❌ Admins: Hard-denied

**Request**:
```json
PATCH /v1/documents/{documentId}/fields
Authorization: Bearer <token>

{
  "fields": [
    {
      "fieldKey": "patient_name",
      "fieldValue": "John Doe"       // Corrected value
    },
    {
      "fieldKey": "test_date",
      "fieldValue": "2025-01-15"
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "ocrFields": [...],                // Original OCR (unchanged)
  "editedFields": [...],             // Updated edited fields
  "mergedFields": [...]              // Updated merged view
}
```

**Side Effects**:
1. AccessGrant resolution (user must have access)
2. Document status validation (must be PROCESSED)
3. Extracted fields updated (editedValue, isEdited, editedBy, editedAt)
4. Audit event: `DOCUMENT_FIELDS_EDITED` (includes fieldKey, not fieldValue - no PHI)

**Validation**:
- Document status must be PROCESSED
- User must have active AccessGrant
- Field keys must exist (or new fields can be added)
- Field values must be non-empty

**Errors**:
- `400 Bad Request`: Document not PROCESSED, invalid field data
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: No access grant OR manager attempting edit
- `404 Not Found`: Document doesn't exist OR no access

---

### 2.8 PATCH /v1/documents/:documentId

**Purpose**: Update document metadata (origin manager only).

**Authorization**:
- ✅ Origin Manager: Can update metadata
- ❌ Secondary Managers: Cannot update
- ❌ Users: Cannot update
- ❌ Admins: Hard-denied

**Request**:
```json
PATCH /v1/documents/{documentId}
Authorization: Bearer <token>

{
  "fileName": "updated-name.pdf",    // Optional
  "description": "Updated description", // Optional
  "documentType": "prescription"      // Optional
}
```

**Response** (200 OK):
```json
{
  "id": "uuid-here",
  "fileName": "updated-name.pdf",
  "description": "Updated description",
  "documentType": "prescription",
  "updatedAt": "2025-01-20T12:00:00Z"
}
```

**Side Effects**:
1. Origin manager authority validation
2. Metadata updated (only allowed fields)
3. Audit event: `DOCUMENT_METADATA_UPDATED`

**Validation**:
- Actor must be origin manager
- Only fileName, description, documentType can be updated
- Cannot update originManagerId (immutable)

**Errors**:
- `400 Bad Request`: Invalid field updates
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Not origin manager
- `404 Not Found`: Document doesn't exist

---

## 3. Access Grant Endpoints

### 3.1 POST /v1/documents/:documentId/access-grants

**Purpose**: Create an access grant (share document access).

**Authorization**:
- ✅ Origin Manager: Can create owner or delegated grants
- ✅ Users: Can create delegated grants (if they have access)
- ❌ Secondary Managers: Cannot create grants
- ❌ Admins: Hard-denied

**Request**:
```json
POST /v1/documents/{documentId}/access-grants
Authorization: Bearer <token>

{
  "subjectType": "user",             // "user" | "manager"
  "subjectId": 789,                   // User ID or Manager ID
  "grantType": "delegated"            // "owner" | "delegated" (derived is auto-created)
}
```

**Response** (201 Created):
```json
{
  "id": 123,
  "documentId": "uuid-here",
  "subjectType": "user",
  "subjectId": 789,
  "grantType": "delegated",
  "grantedByType": "user",
  "grantedById": 456,
  "createdAt": "2025-01-20T12:00:00Z"
}
```

**Side Effects**:
1. AccessGrant resolution (grantor must have access)
2. Authority validation (only origin manager can create owner grants)
3. AccessGrant created
4. Derived grant created automatically (if subject is manager)
5. Audit events:
   - `ACCESS_GRANTED`
   - `ACCESS_DERIVED` (if derived grant created)

**Validation**:
- Grantor must have access to document
- Only origin manager can create owner grants
- Users can only create delegated grants
- Subject must exist and be active
- Cannot create duplicate active grants

**Errors**:
- `400 Bad Request`: Invalid grant type, duplicate grant, subject doesn't exist
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: No access grant OR insufficient authority
- `404 Not Found`: Document doesn't exist OR no access

---

### 3.2 DELETE /v1/documents/:documentId/access-grants/:grantId

**Purpose**: Revoke an access grant.

**Authorization**:
- ✅ Origin Manager: Can revoke any grant
- ✅ Users: Can revoke delegated grants they created
- ❌ Secondary Managers: Cannot revoke grants
- ❌ Admins: Hard-denied

**Request**:
```
DELETE /v1/documents/{documentId}/access-grants/{grantId}
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "id": 123,
  "revokedAt": "2025-01-20T12:30:00Z",
  "revokedBy": 456
}
```

**Side Effects**:
1. Authority validation (grantor or origin manager)
2. AccessGrant revoked (`revokedAt` set)
3. Cascade revocation: All derived grants revoked automatically
4. Audit events:
   - `ACCESS_REVOKED` (for each revoked grant, including cascade)

**Validation**:
- Grant must exist and be active
- Actor must be grant creator OR origin manager
- Origin manager can revoke any grant

**Errors**:
- `400 Bad Request`: Grant already revoked
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Insufficient authority to revoke
- `404 Not Found`: Grant doesn't exist OR no access to document

---

### 3.3 GET /v1/documents/:documentId/access-grants

**Purpose**: List all access grants for a document (origin manager only).

**Authorization**:
- ✅ Origin Manager: Can view all grants
- ❌ Secondary Managers: Cannot view grants
- ❌ Users: Cannot view grants
- ❌ Admins: Hard-denied

**Request**:
```
GET /v1/documents/{documentId}/access-grants
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "documentId": "uuid-here",
  "grants": [
    {
      "id": 123,
      "subjectType": "user",
      "subjectId": 789,
      "grantType": "delegated",
      "grantedByType": "user",
      "grantedById": 456,
      "createdAt": "2025-01-20T12:00:00Z",
      "revokedAt": null,
      "cascadeRevoked": false
    }
  ]
}
```

**Side Effects**:
1. Origin manager authority validation
2. No audit event (read operation, not access)

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Not origin manager
- `404 Not Found`: Document doesn't exist

---

## 4. Revocation Request Endpoints

### 4.1 POST /v1/documents/:documentId/revocation-requests

**Purpose**: Request revocation of own access (users only).

**Authorization**:
- ✅ Users: Can request revocation of own access
- ❌ Managers: Cannot create requests
- ❌ Admins: Hard-denied

**Request**:
```json
POST /v1/documents/{documentId}/revocation-requests
Authorization: Bearer <token>

{
  "cascadeToSecondaryManagers": false  // Optional: If true, revoke all derived grants
}
```

**Response** (201 Created):
```json
{
  "id": 456,
  "documentId": "uuid-here",
  "requestedByType": "user",
  "requestedById": 789,
  "requestType": "self_revocation",
  "status": "pending",
  "cascadeToSecondaryManagers": false,
  "requestedAt": "2025-01-20T13:00:00Z"
}
```

**Side Effects**:
1. User must have active AccessGrant
2. RevocationRequest created (status: pending)
3. Request routed to origin manager (via document.originManagerId)
4. Audit event: `REVOCATION_REQUESTED`

**Validation**:
- User must have active AccessGrant
- Cannot create duplicate pending request for same grant
- Only users can create requests

**Errors**:
- `400 Bad Request`: No active access grant, duplicate request
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Manager attempting request
- `404 Not Found`: Document doesn't exist OR no access

---

### 4.2 PATCH /v1/revocation-requests/:requestId

**Purpose**: Approve or deny revocation request (origin manager only).

**Authorization**:
- ✅ Origin Manager: Can approve/deny requests for their documents
- ❌ Secondary Managers: Cannot approve/deny
- ❌ Users: Cannot approve/deny
- ❌ Admins: Hard-denied

**Request**:
```json
PATCH /v1/revocation-requests/{requestId}
Authorization: Bearer <token>

{
  "action": "approve",                // "approve" | "deny"
  "reviewNotes": "Approved per patient request"  // Optional
}
```

**Response** (200 OK):
```json
{
  "id": 456,
  "status": "approved",
  "reviewedAt": "2025-01-20T14:00:00Z",
  "reviewedBy": 123,                  // Origin manager ID
  "reviewNotes": "Approved per patient request"
}
```

**Side Effects** (if approved):
1. Origin manager authority validation
2. AccessGrant revoked (`revokedAt` set)
3. Cascade revocation (if `cascadeToSecondaryManagers = true`)
4. RevocationRequest status updated to `approved`
5. Audit events:
   - `REVOCATION_APPROVED`
   - `ACCESS_REVOKED` (for each revoked grant)

**Side Effects** (if denied):
1. Origin manager authority validation
2. RevocationRequest status updated to `denied`
3. Audit event: `REVOCATION_DENIED`

**Validation**:
- Actor must be origin manager for document
- Request must be in `pending` status
- Action must be `approve` or `deny`

**Errors**:
- `400 Bad Request`: Invalid action, request not pending
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Not origin manager
- `404 Not Found`: Request doesn't exist

---

### 4.3 GET /v1/revocation-requests

**Purpose**: List revocation requests (origin manager sees their documents' requests, users see own requests).

**Authorization**:
- ✅ Origin Manager: Sees requests for their documents
- ✅ Users: See own requests
- ❌ Admins: Hard-denied

**Request**:
```
GET /v1/revocation-requests?status=pending&page=1&limit=20
Authorization: Bearer <token>
```

**Query Parameters**:
- `status`: Filter by status (pending | approved | denied | cancelled)
- `page`: Page number
- `limit`: Items per page

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": 456,
      "documentId": "uuid-here",
      "requestedByType": "user",
      "requestedById": 789,
      "requestType": "self_revocation",
      "status": "pending",
      "requestedAt": "2025-01-20T13:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

**Side Effects**:
1. Filter by actor type (origin manager vs user)
2. No audit event (read operation)

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Admin attempting access

---

## 5. OCR Processing Endpoints

### 5.1 POST /v1/documents/:documentId/ocr/trigger

**Purpose**: Trigger OCR processing (origin manager only).

**Authorization**:
- ✅ Origin Manager: Can trigger OCR
- ❌ Secondary Managers: Cannot trigger
- ❌ Users: Cannot trigger
- ❌ Admins: Hard-denied

**Request**:
```
POST /v1/documents/{documentId}/ocr/trigger
Authorization: Bearer <token>
```

**Response** (202 Accepted):
```json
{
  "documentId": "uuid-here",
  "status": "PROCESSING",
  "processingMethod": "online",       // Determined automatically
  "processingStartedAt": "2025-01-20T15:00:00Z"
}
```

**Side Effects**:
1. Origin manager authority validation
2. Document status validation (must be STORED or PROCESSED for re-process)
3. Status updated to PROCESSING
4. OCR processing initiated (async)
5. Audit event: `DOCUMENT_PROCESSING_STARTED` (or `DOCUMENT_REPROCESSING_STARTED`)

**Validation**:
- Actor must be origin manager
- Document status must be STORED (or PROCESSED for re-process)
- File must exist in GCS

**Errors**:
- `400 Bad Request`: Document not in triggerable state
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Not origin manager
- `404 Not Found`: Document doesn't exist
- `409 Conflict`: Processing already in progress

---

### 5.2 POST /v1/documents/:documentId/ocr/retry

**Purpose**: Retry OCR processing after error (origin manager only).

**Authorization**:
- ✅ Origin Manager: Can retry
- ❌ Secondary Managers: Cannot retry
- ❌ Users: Cannot retry
- ❌ Admins: Hard-denied

**Request**:
```
POST /v1/documents/{documentId}/ocr/retry
Authorization: Bearer <token>
```

**Response** (202 Accepted):
```json
{
  "documentId": "uuid-here",
  "status": "PROCESSING",
  "retryCount": 1,
  "processingStartedAt": "2025-01-20T15:30:00Z"
}
```

**Side Effects**:
1. Origin manager authority validation
2. Document status validation (must be ERROR)
3. Retry count validation (`retryCount < maxRetries`)
4. Status updated to PROCESSING
5. OCR processing retried
6. Audit event: `DOCUMENT_PROCESSING_RETRY`

**Validation**:
- Actor must be origin manager
- Document status must be ERROR
- `retryCount < maxRetries` (default: 3)

**Errors**:
- `400 Bad Request`: Document not in ERROR state, max retries exceeded
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Not origin manager
- `404 Not Found`: Document doesn't exist

---

## 6. Manager Endpoints

### 6.1 GET /v1/managers

**Purpose**: List verified managers (for user selection during upload).

**Authorization**:
- ✅ Users: Can list verified managers
- ✅ Managers: Can list verified managers
- ✅ Admins: Can list all managers

**Request**:
```
GET /v1/managers?verified=true&search=quest&page=1&limit=20
Authorization: Bearer <token>
```

**Query Parameters**:
- `verified`: Filter by verification status (default: true for users/managers)
- `search`: Search by name or organization
- `page`: Page number
- `limit`: Items per page

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": 123,
      "organizationId": 10,
      "organizationName": "Quest Diagnostics",
      "name": "Quest Diagnostics - Downtown Lab",
      "labCode": "QD-DT-001",
      "verificationStatus": "verified",
      "email": "downtown@quest.com"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

**Side Effects**:
1. Filter by verification status (users/managers only see verified)
2. No audit event (directory listing, not access)

**Errors**:
- `401 Unauthorized`: Invalid/expired token

---

### 6.2 GET /v1/managers/:managerId

**Purpose**: Get manager details.

**Authorization**:
- ✅ Users: Can view verified managers
- ✅ Managers: Can view verified managers
- ✅ Admins: Can view all managers

**Request**:
```
GET /v1/managers/{managerId}
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "id": 123,
  "organizationId": 10,
  "organizationName": "Quest Diagnostics",
  "name": "Quest Diagnostics - Downtown Lab",
  "labCode": "QD-DT-001",
  "verificationStatus": "verified",
  "email": "downtown@quest.com",
  "phone": "+1-555-0123",
  "status": "active"
}
```

**Side Effects**:
1. Verification status check (users/managers only see verified)
2. No audit event (directory lookup)

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Manager not verified (for users/managers)
- `404 Not Found`: Manager doesn't exist

---

## 7. User Manager Assignment Endpoints

### 7.1 POST /v1/users/:userId/manager-assignments

**Purpose**: Assign user to manager (admin only).

**Authorization**:
- ✅ Admins: Can create assignments
- ❌ Managers: Cannot create assignments
- ❌ Users: Cannot create assignments

**Request**:
```json
POST /v1/users/{userId}/manager-assignments
Authorization: Bearer <token>

{
  "managerId": 123
}
```

**Response** (201 Created):
```json
{
  "id": 789,
  "userId": 456,
  "managerId": 123,
  "assignedBy": 1,                    // Admin ID
  "assignedAt": "2025-01-20T16:00:00Z",
  "status": "active"
}
```

**Side Effects**:
1. Admin authority validation
2. UserManagerAssignment created
3. Audit event: `MANAGER_ASSIGNMENT_CREATED`

**Validation**:
- Manager must exist and be active
- User must exist and be active
- Cannot create duplicate active assignment

**Errors**:
- `400 Bad Request`: Invalid manager/user, duplicate assignment
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Not admin
- `404 Not Found`: User or manager doesn't exist

---

### 7.2 DELETE /v1/users/:userId/manager-assignments/:assignmentId

**Purpose**: Remove user-manager assignment (admin only).

**Authorization**:
- ✅ Admins: Can remove assignments
- ❌ Managers: Cannot remove assignments
- ❌ Users: Cannot remove assignments

**Request**:
```
DELETE /v1/users/{userId}/manager-assignments/{assignmentId}
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "id": 789,
  "deletedAt": "2025-01-20T16:30:00Z"
}
```

**Side Effects**:
1. Admin authority validation
2. UserManagerAssignment soft-deleted
3. Audit event: `MANAGER_ASSIGNMENT_REMOVED`

**Note**: This does NOT revoke document access. AccessGrants are separate and must be revoked independently.

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: Not admin
- `404 Not Found`: Assignment doesn't exist

---

### 7.3 GET /v1/users/:userId/manager-assignments

**Purpose**: List managers assigned to a user.

**Authorization**:
- ✅ Users: Can view own assignments
- ✅ Admins: Can view any user's assignments
- ❌ Managers: Cannot view (unless admin)

**Request**:
```
GET /v1/users/{userId}/manager-assignments
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": 789,
      "managerId": 123,
      "managerName": "Quest Diagnostics - Downtown Lab",
      "assignedAt": "2025-01-20T16:00:00Z",
      "status": "active"
    }
  ]
}
```

**Side Effects**:
1. User can only see own assignments (unless admin)
2. No audit event (read operation)

**Errors**:
- `401 Unauthorized`: Invalid/expired token
- `403 Forbidden`: User attempting to view another user's assignments
- `404 Not Found`: User doesn't exist

---

## 8. Common Response Patterns

### 8.1 Success Responses

**200 OK**: Successful read/update operation
**201 Created**: Resource created
**202 Accepted**: Async operation initiated
**204 No Content**: Successful delete (no response body)

### 8.2 Error Response Format

All errors follow this format:

```json
{
  "statusCode": 400,
  "message": "Document not in triggerable state",
  "error": "Bad Request",
  "timestamp": "2025-01-20T10:30:00Z",
  "path": "/v1/documents/uuid/ocr/trigger"
}
```

### 8.3 Pagination Format

All list endpoints use consistent pagination:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## 9. Error Handling

### 9.1 HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful read/update |
| 201 | Created | Resource created |
| 202 | Accepted | Async operation started |
| 204 | No Content | Successful delete |
| 400 | Bad Request | Validation error, invalid input |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient authority |
| 404 | Not Found | Resource doesn't exist OR no access (security) |
| 409 | Conflict | State conflict (e.g., already processing) |
| 413 | Payload Too Large | File exceeds size limit |
| 415 | Unsupported Media Type | Invalid file type |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | System error |

### 9.2 Security Considerations

**404 vs 403**:
- Use `404 Not Found` when document doesn't exist OR user has no access
- Prevents information leakage (can't distinguish "doesn't exist" from "no access")
- Use `403 Forbidden` only when access is explicitly denied (e.g., admin attempting document access)

**Error Message Sanitization**:
- Never expose PHI in error messages
- Never expose internal system details
- Generic messages: "Document not found", "Access denied"

---

## 10. Authorization Enforcement

### 10.1 Controller-Level Guards

**JWT Guard**:
- Validates token signature and expiration
- Extracts actor type and ID from JWT payload
- Sets `req.user = { type: 'user' | 'manager', id: number, role: number }`

**Roles Guard** (for admin-only endpoints):
- Checks role from JWT payload
- Rejects non-admins before reaching controller

**Document Access Guard** (custom):
- Hard-denies admins from document endpoints
- Returns 403 before domain service is called
- Prevents admins from entering document access flows

### 10.2 Domain Service Validation

**AccessGrant Resolution**:
- Domain service calls `AccessGrantService.hasAccess()`
- Checks origin manager implicit access OR explicit AccessGrant
- Returns 404 if no access (security: same as "not found")

**Authority Validation**:
- Domain service validates actor has authority for operation
- Origin manager checks for OCR, metadata updates
- Grant creator checks for grant revocation

### 10.3 Audit Integration

**Automatic Audit Logging**:
- All mutations generate audit events
- All access operations generate audit events
- Events created synchronously (not async)
- No PHI in audit metadata

**Audit Event Creation**:
```typescript
// Conceptual (NO CODE)
this.auditService.logAuthEvent({
  actorType: 'user' | 'manager',
  actorId: number,
  event: AuditEventType,
  documentId?: string,
  success: boolean,
  metadata: { ... }  // NO PHI
});
```

---

## Summary

### Endpoint Categories

1. **Document Endpoints** (8 endpoints):
   - Upload, view, download, list, status, fields (view/edit), metadata update

2. **Access Grant Endpoints** (3 endpoints):
   - Create grant, revoke grant, list grants

3. **Revocation Request Endpoints** (3 endpoints):
   - Create request, approve/deny request, list requests

4. **OCR Processing Endpoints** (2 endpoints):
   - Trigger OCR, retry OCR

5. **Manager Endpoints** (2 endpoints):
   - List managers, get manager details

6. **User Manager Assignment Endpoints** (3 endpoints):
   - Create assignment, remove assignment, list assignments

**Total**: 21 endpoints

### Key Design Principles

1. **RESTful**: Resource-based URLs, standard HTTP methods
2. **AccessGrant-Driven**: All document access via AccessGrant resolution
3. **Origin Manager Authority**: Immutable custodial authority
4. **Admin Exclusion**: Admins hard-denied from document endpoints
5. **Audit Everything**: All mutations and access logged
6. **No PHI Exposure**: No PHI in URLs, query params, or error messages

### Next Steps

After approval of PHASE 3, proceed to:
- **PHASE 4**: Audit & HIPAA Strategy (event taxonomy, log schema, retention)
- **PHASE 5**: Implementation (incremental, module by module)

---

**Document Status**: ✅ Ready for Review  
**Approval Required**: Yes  
**Implementation Blocking**: Yes (cannot proceed to Phase 4 without approval)






