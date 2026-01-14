# Document Processing API Endpoints Reference

## Base URL
```
/api/v1/documents
```

All endpoints require authentication via Bearer token:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 1. Trigger OCR Processing

**Endpoint:** `POST /api/v1/documents/:documentId/ocr/trigger`

**Description:** Manually trigger OCR processing for a document. Only the origin manager can trigger OCR. Document must be in STORED, PROCESSED, or FAILED state.

**Authorization:**
- ✅ Origin Manager: Can trigger OCR
- ❌ Secondary Managers: Cannot trigger
- ❌ Users: Cannot trigger
- ❌ Admins: Hard-denied (403)

**Request:**
```bash
POST /api/v1/documents/{documentId}/ocr/trigger
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/v1/documents/123e4567-e89b-12d3-a456-426614174000/ocr/trigger \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Request Body:**
None (empty body)

**Response (202 Accepted):**
```json
{
  "message": "OCR processing triggered successfully"
}
```

**Validation Rules:**
- Actor must be origin manager (403 if not)
- Document status must be STORED, PROCESSED, or FAILED (400 if not)
- Document must exist (404 if not)

**Error Responses:**
- `400 Bad Request`: Document not in triggerable state
- `401 Unauthorized`: Invalid or expired token
- `403 Forbidden`: Not origin manager or admin attempting access
- `404 Not Found`: Document doesn't exist

---

## 2. Get Document Status

**Endpoint:** `GET /api/v1/documents/:documentId/status`

**Description:** Get the current processing status of a document. Returns status, progress percentage, and any error messages.

**Authorization:**
- ✅ Origin Manager: Can view status
- ✅ Secondary Managers: Can view status (if granted access)
- ✅ Users: Can view status (if granted access)
- ❌ Admins: Hard-denied (403)

**Request:**
```bash
GET /api/v1/documents/{documentId}/status
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/v1/documents/123e4567-e89b-12d3-a456-426614174000/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Request Body:**
None

**Response (200 OK) - Processing:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "PROCESSING",
  "progress": 50,
  "processingStartedAt": "2025-12-10T12:00:05.000Z",
  "processedAt": null,
  "errorMessage": null
}
```

**Response (200 OK) - Processed:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "PROCESSED",
  "progress": 100,
  "processingStartedAt": "2025-12-10T12:00:05.000Z",
  "processedAt": "2025-12-10T12:00:10.000Z",
  "errorMessage": null
}
```

**Response (200 OK) - Failed:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "FAILED",
  "progress": 0,
  "processingStartedAt": "2025-12-10T12:00:05.000Z",
  "processedAt": null,
  "errorMessage": "OCR processing failed: Invalid file format"
}
```

**Status Values:**
- `UPLOADED` (10% progress) - File received
- `STORED` (20%) - Saved to cloud storage
- `QUEUED` (30%) - Queued for processing
- `PROCESSING` (50%) - Extraction/OCR in progress
- `PROCESSED` (100%) - Processing complete
- `FAILED` (0%) - Processing failed

**Error Responses:**
- `401 Unauthorized`: Invalid or expired token
- `403 Forbidden`: Admin attempting access or no access granted
- `404 Not Found`: Document not found or access denied

---

## 3. Get Extracted Fields

**Endpoint:** `GET /api/v1/documents/:documentId/fields`

**Description:** Get structured fields extracted from the document via OCR processing (e.g., patient name, date, lab values).

**Authorization:**
- ✅ Origin Manager: Can view fields
- ✅ Secondary Managers: Can view fields (if granted access)
- ✅ Users: Can view fields (if granted access)
- ❌ Admins: Hard-denied (403)

**Request:**
```bash
GET /api/v1/documents/{documentId}/fields
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/v1/documents/123e4567-e89b-12d3-a456-426614174000/fields \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Request Body:**
None

**Response (200 OK):**
```json
[
  {
    "fieldKey": "patient_name",
    "fieldValue": "John Doe",
    "fieldType": "string",
    "confidence": 0.95
  },
  {
    "fieldKey": "test_date",
    "fieldValue": "2025-12-01",
    "fieldType": "date",
    "confidence": 0.88
  },
  {
    "fieldKey": "result_value",
    "fieldValue": "145 mg/dL",
    "fieldType": "string",
    "confidence": 0.91
  }
]
```

**Field Types:**
- `string` - Text values
- `date` - Date values
- `number` - Numeric values
- `boolean` - Boolean values

**Note:** Only fields with confidence >= 0.7 are returned. Entity extraction uses regex-based patterns and works for both direct extraction and OCR methods.

**Error Responses:**
- `401 Unauthorized`: Invalid or expired token
- `403 Forbidden`: Admin attempting access or no access granted
- `404 Not Found`: Document not found or access denied

---

## Complete Example Flow

### 1. Upload Document
```bash
POST /api/v1/documents/upload
Content-Type: multipart/form-data
Authorization: Bearer YOUR_JWT_TOKEN

{
  "file": <File>,
  "documentType": "LAB_RESULT",
  "description": "Blood work from annual physical"
}
```

**Response:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "documentType": "LAB_RESULT",
  "status": "STORED",
  "fileName": "lab-result.pdf",
  "fileSize": 245678,
  "mimeType": "application/pdf",
  "originManagerId": 1,
  "uploadedAt": "2025-12-10T12:00:00.000Z",
  "createdAt": "2025-12-10T12:00:00.000Z"
}
```

### 2. Trigger OCR (if needed)
```bash
POST /api/v1/documents/123e4567-e89b-12d3-a456-426614174000/ocr/trigger
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response:**
```json
{
  "message": "OCR processing triggered successfully"
}
```

### 3. Check Status
```bash
GET /api/v1/documents/123e4567-e89b-12d3-a456-426614174000/status
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response (Processing):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "PROCESSING",
  "progress": 50,
  "processingStartedAt": "2025-12-10T12:00:05.000Z"
}
```

**Poll until status is PROCESSED:**
```bash
# Wait a few seconds, then check again
GET /api/v1/documents/123e4567-e89b-12d3-a456-426614174000/status
```

**Response (Processed):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "PROCESSED",
  "progress": 100,
  "processingStartedAt": "2025-12-10T12:00:05.000Z",
  "processedAt": "2025-12-10T12:00:10.000Z"
}
```

### 4. Get Extracted Fields
```bash
GET /api/v1/documents/123e4567-e89b-12d3-a456-426614174000/fields
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response:**
```json
[
  {
    "fieldKey": "patient_name",
    "fieldValue": "John Doe",
    "fieldType": "string",
    "confidence": 0.95
  },
  {
    "fieldKey": "test_date",
    "fieldValue": "2025-12-01",
    "fieldType": "date",
    "confidence": 0.88
  }
]
```

---

## Additional Endpoints

### Get Document Details
```bash
GET /api/v1/documents/{documentId}
Authorization: Bearer YOUR_JWT_TOKEN
```

Returns full document information including metadata, processing method, and OCR results.

### Get Download URL
```bash
GET /api/v1/documents/{documentId}/download
Authorization: Bearer YOUR_JWT_TOKEN
```

Returns a signed URL for downloading the original document file (expires in 24 hours).

### List Documents
```bash
GET /api/v1/documents?page=1&limit=20&status=PROCESSED&documentType=LAB_RESULT
Authorization: Bearer YOUR_JWT_TOKEN
```

Returns a paginated list of documents with optional filtering.

---

## Notes

- **OCR Trigger**: Only the origin manager (the manager who uploaded or owns the document) can trigger OCR
- **Status Polling**: Processing is asynchronous. Poll the status endpoint until status is PROCESSED or FAILED
- **Field Extraction**: Fields are only available after processing completes (status = PROCESSED)
- **Access Control**: All endpoints check access grants - users and secondary managers need explicit access grants to view documents
- **Processing Methods**: Documents can be processed via DIRECT_EXTRACTION (fast, free) or OCR (slower, costs apply) depending on PDF type

