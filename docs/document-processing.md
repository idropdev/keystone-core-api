# Document Processing API

Complete guide for the HIPAA-compliant document processing module with Google Cloud Document AI OCR.

---

## Table of Contents

- [Overview](#overview)
- [Quick Setup](#quick-setup)
- [Running the Server](#running-the-server)
- [API Endpoints](#api-endpoints)
- [Request/Response Examples](#requestresponse-examples)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [HIPAA Compliance](#hipaa-compliance)

---

## Overview

The Document Processing API enables secure upload, OCR processing, and retrieval of medical documents. All documents are treated as PHI (Protected Health Information) and handled according to HIPAA requirements.

**Features:**

- ✅ Secure document upload with validation
- ✅ Automatic OCR processing (Google Cloud Document AI)
- ✅ Entity extraction (patient names, dates, values, etc.)
- ✅ 8-year retention with automatic deletion
- ✅ User-level isolation (users can only access their own documents)
- ✅ Full audit logging
- ✅ Rate limiting and security controls

**Supported Document Types:**

- `LAB_RESULT` - Laboratory test results
- `PRESCRIPTION` - Prescription documents  
- `MEDICAL_RECORD` - General medical records
- `INSURANCE_CARD` - Insurance card scans
- `IMAGING_REPORT` - Radiology/imaging reports
- `IMMUNIZATION_RECORD` - Vaccination records
- `OTHER` - Other medical documents

**Supported File Formats:**

- PDF (`.pdf`)
- JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)
- TIFF (`.tiff`, `.tif`)
- GIF (`.gif`)

**File Size Limit:** 10 MB

---

## Quick Setup

### 1. Prerequisites

```bash
# Install dependencies
npm install

# GCP packages (already included in package.json)
# @google-cloud/storage
# @google-cloud/documentai
```

### 2. Configure Environment Variables

Copy the example file:

```bash
cp env-example-relational .env
```

Edit `.env` and set these required variables:

```env
# GCP Configuration
DOC_PROCESSING_GCP_PROJECT_ID=your-gcp-project-id
DOC_PROCESSING_GCP_LOCATION=us
DOC_PROCESSING_PROCESSOR_ID=your-processor-id

# Storage Buckets
DOC_PROCESSING_STORAGE_BUCKET=your-documents-bucket
DOC_PROCESSING_OUTPUT_BUCKET=your-docai-output-bucket

# Processing Settings
DOC_PROCESSING_RAW_PREFIX=raw/
DOC_PROCESSING_PROCESSED_PREFIX=processed/
DOC_PROCESSING_MAX_FILE_SIZE_MB=10
DOC_PROCESSING_RETENTION_YEARS=8
DOC_PROCESSING_SYNC_MAX_PAGES=15
```

### 3. GCP Setup

#### Authenticate

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

#### Create Buckets

```bash
# Main documents bucket
gsutil mb -l us-central1 gs://your-documents-bucket

# Document AI output bucket
gsutil mb -l us-central1 gs://your-docai-output-bucket
```

#### Create Document AI Processor

1. Visit [Document AI Console](https://console.cloud.google.com/ai/document-ai/processors)
2. Click **Create Processor**
3. Select **Enterprise Document OCR**
4. Choose location: **us**
5. Copy the Processor ID

#### Enable APIs

```bash
gcloud services enable documentai.googleapis.com
gcloud services enable storage-api.googleapis.com
```

### 4. Run Database Migration

```bash
npm run migration:run
```

This creates the `documents` and `extracted_fields` tables.

---

## Running the Server

### Development Mode

```bash
# Start with auto-reload
npm run start:dev
```

Server starts on `http://localhost:3000` (or port specified in `APP_PORT`)

### Production Mode

```bash
# Build
npm run build

# Start production server
npm run start:prod
```

### Docker

```bash
# Using docker-compose
docker-compose up -d

# Check logs
docker-compose logs -f api
```

### Health Check

```bash
curl http://localhost:3000/api/health
```

---

## API Endpoints

All endpoints are versioned under `/api/v1/documents` and require authentication.

### Base URL

```
http://localhost:3000/api/v1/documents
```

### Authentication

All requests require a valid JWT token:

```bash
Authorization: Bearer YOUR_JWT_TOKEN
```

Get a token by logging in via `/api/v1/auth/email/login` or OAuth providers.

---

### 1. Upload Document

**Endpoint:** `POST /api/v1/documents/upload`

**Description:** Upload a medical document for OCR processing.

**Headers:**

```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: multipart/form-data
```

**Form Data:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | Document file (PDF, JPEG, PNG, TIFF, GIF) |
| `documentType` | String | Yes | One of: LAB_RESULT, PRESCRIPTION, MEDICAL_RECORD, etc. |
| `description` | String | No | Optional description (max 500 chars) |

**Rate Limit:** 10 uploads per 60 seconds per user

**Example Request:**

```bash
curl -X POST http://localhost:3000/api/v1/documents/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@lab-result.pdf" \
  -F "documentType=LAB_RESULT" \
  -F "description=Blood work from annual physical"
```

**Success Response (200 OK):**

```json
{
  "id": "doc_1733875200_abc123",
  "documentType": "LAB_RESULT",
  "status": "STORED",
  "fileName": "lab-result.pdf",
  "fileSize": 245678,
  "mimeType": "application/pdf",
  "description": "Blood work from annual physical",
  "uploadedAt": "2025-12-10T12:00:00.000Z",
  "createdAt": "2025-12-10T12:00:00.000Z"
}
```

**Error Responses:**

- `400 Bad Request` - Invalid file type or size
- `401 Unauthorized` - Missing or invalid token
- `429 Too Many Requests` - Rate limit exceeded

---

### 2. Get Document Status

**Endpoint:** `GET /api/v1/documents/:documentId/status`

**Description:** Check the processing status of a document.

**Example Request:**

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK):**

```json
{
  "id": "doc_1733875200_abc123",
  "status": "PROCESSING",
  "progress": 50,
  "processingStartedAt": "2025-12-10T12:00:05.000Z"
}
```

**Status Values:**

- `UPLOADED` (10% progress) - File received
- `STORED` (20%) - Saved to cloud storage
- `QUEUED` (30%) - Queued for processing
- `PROCESSING` (50%) - OCR in progress
- `PROCESSED` (100%) - Processing complete
- `FAILED` (0%) - Processing failed

---

### 3. Get Document Details

**Endpoint:** `GET /api/v1/documents/:documentId`

**Description:** Get full details of a processed document.

**Example Request:**

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK):**

```json
{
  "id": "doc_1733875200_abc123",
  "documentType": "LAB_RESULT",
  "status": "PROCESSED",
  "fileName": "lab-result.pdf",
  "fileSize": 245678,
  "mimeType": "application/pdf",
  "description": "Blood work from annual physical",
  "confidence": 0.92,
  "uploadedAt": "2025-12-10T12:00:00.000Z",
  "processedAt": "2025-12-10T12:01:30.000Z",
  "createdAt": "2025-12-10T12:00:00.000Z"
}
```

**Note:** The response includes OCR confidence score (0-1) when processing is complete.

---

### 4. Get Extracted Fields

**Endpoint:** `GET /api/v1/documents/:documentId/fields`

**Description:** Get structured data extracted from the document (names, dates, values, etc.).

**Example Request:**

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123/fields \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK):**

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

**Note:** Only fields with confidence >= 0.7 are returned.

---

### 5. Get Download URL

**Endpoint:** `GET /api/v1/documents/:documentId/download`

**Description:** Generate a secure, time-limited download URL for the original document.

**Example Request:**

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123/download \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK):**

```json
{
  "downloadUrl": "https://storage.googleapis.com/your-bucket/...",
  "expiresIn": 86400
}
```

**Note:** The signed URL expires in 24 hours (86400 seconds). The URL provides direct access to the file without additional authentication.

---

### 6. List Documents

**Endpoint:** `GET /api/v1/documents`

**Description:** List all documents for the authenticated user with pagination and filtering.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (min: 1) |
| `limit` | number | 20 | Items per page (min: 1, max: 100) |
| `status` | string[] | - | Filter by status (can repeat) |
| `documentType` | string[] | - | Filter by type (can repeat) |

**Example Requests:**

```bash
# Basic list (page 1, 20 items)
curl http://localhost:3000/api/v1/documents \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# With pagination
curl "http://localhost:3000/api/v1/documents?page=2&limit=50" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Filter by status
curl "http://localhost:3000/api/v1/documents?status=PROCESSED&status=FAILED" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Filter by document type
curl "http://localhost:3000/api/v1/documents?documentType=LAB_RESULT&documentType=PRESCRIPTION" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Combined filters
curl "http://localhost:3000/api/v1/documents?page=1&limit=10&status=PROCESSED&documentType=LAB_RESULT" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK):**

```json
{
  "data": [
    {
      "id": "doc_1733875200_abc123",
      "documentType": "LAB_RESULT",
      "status": "PROCESSED",
      "fileName": "lab-result.pdf",
      "fileSize": 245678,
      "mimeType": "application/pdf",
      "confidence": 0.92,
      "uploadedAt": "2025-12-10T12:00:00.000Z",
      "processedAt": "2025-12-10T12:01:30.000Z",
      "createdAt": "2025-12-10T12:00:00.000Z"
    }
  ],
  "hasNextPage": false
}
```

---

### 7. Delete Document

**Endpoint:** `DELETE /api/v1/documents/:documentId`

**Description:** Soft-delete a document. The file and metadata are marked for deletion but retained for 8 years before permanent removal.

**Example Request:**

```bash
curl -X DELETE http://localhost:3000/api/v1/documents/doc_1733875200_abc123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response:** `204 No Content`

**Note:** After deletion, the document is scheduled for hard deletion 8 years in the future. A daily cron job removes expired documents permanently.

---

## Request/Response Examples

### Complete Upload Flow

```bash
# 1. Upload document
RESPONSE=$(curl -X POST http://localhost:3000/api/v1/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=LAB_RESULT")

# Extract document ID
DOC_ID=$(echo $RESPONSE | jq -r '.id')

# 2. Poll status until processed
while true; do
  STATUS=$(curl -s http://localhost:3000/api/v1/documents/$DOC_ID/status \
    -H "Authorization: Bearer $TOKEN" | jq -r '.status')
  
  if [ "$STATUS" = "PROCESSED" ] || [ "$STATUS" = "FAILED" ]; then
    break
  fi
  
  echo "Status: $STATUS"
  sleep 5
done

# 3. Get extracted fields
curl http://localhost:3000/api/v1/documents/$DOC_ID/fields \
  -H "Authorization: Bearer $TOKEN" | jq

# 4. Get download URL
curl http://localhost:3000/api/v1/documents/$DOC_ID/download \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## Error Handling

### Error Response Format

```json
{
  "statusCode": 400,
  "message": "Invalid file type. Allowed types: application/pdf, image/jpeg, image/png",
  "error": "Bad Request"
}
```

### Common Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Invalid input (file type, size, missing fields) |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | User doesn't have access to this document |
| 404 | Not Found | Document doesn't exist |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error (check logs) |

### Handling Rate Limits

When you receive a `429` response:

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

**Solution:** Wait 60 seconds before retrying. The limit is 10 uploads per minute per user.

---

## Testing

### Manual Testing

#### 1. Get Authentication Token

```bash
# Register user (first time)
curl -X POST http://localhost:3000/api/v1/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "secret123",
    "firstName": "Test",
    "lastName": "User"
  }'

# Login
RESPONSE=$(curl -X POST http://localhost:3000/api/v1/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "secret123"
  }')

# Extract token
TOKEN=$(echo $RESPONSE | jq -r '.token')
echo "Token: $TOKEN"
```

#### 2. Create Test Document

```bash
# Create a simple PDF (macOS)
echo "Test lab result content" | \
  enscript -p - | \
  ps2pdf - test-lab-result.pdf

# Or use an existing file
cp /path/to/your/document.pdf test-lab-result.pdf
```

#### 3. Upload and Process

```bash
# Upload
curl -X POST http://localhost:3000/api/v1/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test-lab-result.pdf" \
  -F "documentType=LAB_RESULT" \
  -F "description=Test upload"
```

### Automated Testing

Run the test suite:

```bash
# Unit tests
npm run test

# Specific test file
npm run test -- document-processing.service.spec.ts

# E2E tests (requires running server)
npm run test:e2e
```

### Using Swagger UI

Navigate to `http://localhost:3000/docs` for interactive API documentation.

---

## HIPAA Compliance

### Security Features

✅ **Authentication & Authorization**
- JWT tokens with session validation
- User isolation (can only access own documents)
- Automatic session expiration

✅ **Data Protection**
- Encryption at rest (PostgreSQL + GCS)
- Encryption in transit (TLS/HTTPS)
- Signed URLs with expiration (24 hours)

✅ **Audit Logging**
- All document access logged
- No PHI in logs
- Immutable audit trail

✅ **Access Controls**
- Rate limiting (10 uploads/minute)
- File validation (type, size)
- IP-based throttling

✅ **Data Retention**
- 8-year retention period
- Automated hard deletion via cron job
- Deletion audit trail

### Compliance Checklist

Before production deployment:

- [ ] Sign BAA with Google Cloud
- [ ] Configure GCS with HIPAA-compliant settings
- [ ] Enable audit logging (GCP Cloud Logging)
- [ ] Move secrets to GCP Secret Manager
- [ ] Run security testing (penetration test)
- [ ] Review with compliance team

See [HIPAA Compliance Checklist](./document-processing-hipaa-checklist.md) for full details.

---

## Troubleshooting

### Document Stuck in PROCESSING

**Symptom:** Status remains `PROCESSING` for > 5 minutes

**Causes:**
- Large document (batch processing can take 2-10 minutes)
- Document AI quota exceeded
- Network/GCP connectivity issues

**Solutions:**

```bash
# Check Document AI quotas
gcloud services quotas describe \
  --service=documentai.googleapis.com \
  --project=YOUR_PROJECT_ID

# Check application logs
docker-compose logs -f api | grep "doc_YOUR_DOC_ID"

# Manually check GCS output bucket
gsutil ls gs://your-docai-output-bucket/output/
```

### Upload Fails with "Processor not found"

**Cause:** Invalid `DOC_PROCESSING_PROCESSOR_ID`

**Solution:**

```bash
# List processors
gcloud document-ai processors list \
  --location=us \
  --project=YOUR_PROJECT_ID

# Verify processor ID in .env matches
```

### "Access denied to bucket"

**Cause:** Service account lacks permissions

**Solution:**

```bash
# Grant permissions
gsutil iam ch user:YOUR_EMAIL:objectAdmin \
  gs://your-documents-bucket

# Verify
gsutil iam get gs://your-documents-bucket
```

### Migration Error: "foreign key constraint cannot be implemented"

**Cause:** Type mismatch between `documents.user_id` and `user.id`

**Solution:** This has been fixed. If you encounter it:

```bash
# Drop documents table (if exists)
psql -d YOUR_DATABASE -c "DROP TABLE IF EXISTS documents CASCADE;"
psql -d YOUR_DATABASE -c "DROP TABLE IF EXISTS extracted_fields CASCADE;"

# Re-run migration
npm run migration:run
```

---

## Additional Resources

- [Quick Start Guide](./document-processing-quick-start.md)
- [HIPAA Compliance Checklist](./document-processing-hipaa-checklist.md)
- [Architecture Overview](./architecture.md)
- [Google Cloud Document AI Docs](https://cloud.google.com/document-ai/docs)

---

## Support

- **Issues:** [GitHub Issues](https://github.com/your-org/keystone-core-api/issues)
- **Security:** [security@healthatlas.com](mailto:security@healthatlas.com)
- **Documentation:** [docs/](.)

---

**Last Updated:** December 2025  
**API Version:** v1

