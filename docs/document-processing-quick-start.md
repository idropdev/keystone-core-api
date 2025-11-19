# Document Processing Module - Quick Start

## Overview

The Document Processing module provides HIPAA-compliant OCR processing for medical documents using Google Cloud Document AI. It supports PDF, JPEG, PNG, and TIFF formats with automatic mode selection (sync/batch) based on document size.

**Features:**

- ✅ Upload medical documents (lab results, prescriptions, records, etc.)
- ✅ Automatic OCR processing with entity extraction
- ✅ Secure storage in GCP Cloud Storage
- ✅ 8-year retention with automatic hard deletion
- ✅ Full audit logging for HIPAA compliance
- ✅ Rate limiting and file validation
- ✅ User-level authorization (users can only access their own documents)

---

## Prerequisites

1. **GCP Account** with billing enabled
2. **Document AI API** enabled
3. **Cloud Storage API** enabled
4. **Service Account** with appropriate permissions
5. **PostgreSQL database** (for metadata)

---

## Local Development Setup

### 1. Install Dependencies

```bash
# Install Google Cloud SDK packages
npm install @google-cloud/storage @google-cloud/documentai
```

### 2. GCP Setup (Development)

#### Authenticate with GCP

```bash
# Authenticate with your Google account
gcloud auth application-default login

# Set your project
gcloud config set project YOUR_PROJECT_ID
```

#### Create Development Buckets

```bash
# Create bucket for raw documents and processed output
gsutil mb -l us-central1 gs://your-dev-documents

# Create bucket for Document AI batch processing output
gsutil mb -l us-central1 gs://your-dev-docai-output
```

#### Create Document AI Processor

1. Navigate to [Document AI Console](https://console.cloud.google.com/ai/document-ai/processors)
2. Click **Create Processor**
3. Select **Enterprise Document OCR** (recommended for medical documents)
4. Choose location: **us** (or your preferred region)
5. Copy the **Processor ID** (format: `abc123def456...`)

#### Enable APIs

```bash
gcloud services enable documentai.googleapis.com
gcloud services enable storage-api.googleapis.com
```

### 3. Environment Variables

Copy the example file and configure:

```bash
cp env-example-relational .env
```

Edit `.env` and set:

```env
# GCP Configuration
DOC_PROCESSING_GCP_PROJECT_ID=your-project-id
DOC_PROCESSING_GCP_LOCATION=us
DOC_PROCESSING_PROCESSOR_ID=your-processor-id-from-step-2

# Storage Buckets
DOC_PROCESSING_STORAGE_BUCKET=your-dev-documents
DOC_PROCESSING_OUTPUT_BUCKET=your-dev-docai-output

# Processing Settings
DOC_PROCESSING_RAW_PREFIX=raw/
DOC_PROCESSING_PROCESSED_PREFIX=processed/
DOC_PROCESSING_MAX_FILE_SIZE_MB=10
DOC_PROCESSING_RETENTION_YEARS=8
DOC_PROCESSING_SYNC_MAX_PAGES=15
```

### 4. Run Database Migration

```bash
npm run migration:run
```

This creates the `documents` and `extracted_fields` tables.

### 5. Start the Server

```bash
npm run start:dev
```

Server should start on `http://localhost:3000`.

---

## Testing the API

### Authentication

First, authenticate to get a JWT token:

```bash
# Register a new user
curl -X POST http://localhost:3000/api/v1/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "secret123",
    "firstName": "Test",
    "lastName": "User"
  }'

# Login
curl -X POST http://localhost:3000/api/v1/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "secret123"
  }'
```

Copy the `token` from the response and use it in subsequent requests.

### 1. Upload Document

```bash
curl -X POST http://localhost:3000/api/v1/documents/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test-lab-result.pdf" \
  -F "documentType=LAB_RESULT" \
  -F "description=Annual blood work results"
```

**Response:**

```json
{
  "id": "doc_1733875200_abc123",
  "documentType": "LAB_RESULT",
  "status": "STORED",
  "fileName": "test-lab-result.pdf",
  "fileSize": 245678,
  "mimeType": "application/pdf",
  "description": "Annual blood work results",
  "uploadedAt": "2025-12-10T12:00:00.000Z",
  "createdAt": "2025-12-10T12:00:00.000Z"
}
```

**Note:** Status will be `STORED` initially, then change to `PROCESSING` → `PROCESSED` asynchronously.

### 2. Check Processing Status

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**

```json
{
  "id": "doc_1733875200_abc123",
  "status": "PROCESSING",
  "progress": 50,
  "processingStartedAt": "2025-12-10T12:00:05.000Z"
}
```

**Status Flow:**

- `UPLOADED` (10% progress)
- `STORED` (20%)
- `QUEUED` (30%)
- `PROCESSING` (50%)
- `PROCESSED` (100%) or `FAILED` (0%)

### 3. Get Document Details

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**

```json
{
  "id": "doc_1733875200_abc123",
  "documentType": "LAB_RESULT",
  "status": "PROCESSED",
  "fileName": "test-lab-result.pdf",
  "fileSize": 245678,
  "mimeType": "application/pdf",
  "description": "Annual blood work results",
  "confidence": 0.92,
  "uploadedAt": "2025-12-10T12:00:00.000Z",
  "processedAt": "2025-12-10T12:01:30.000Z",
  "createdAt": "2025-12-10T12:00:00.000Z"
}
```

### 4. Get Extracted Fields

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123/fields \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
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
  },
  {
    "fieldKey": "result_value",
    "fieldValue": "145 mg/dL",
    "fieldType": "string",
    "confidence": 0.91
  }
]
```

### 5. Get Download URL

```bash
curl http://localhost:3000/api/v1/documents/doc_1733875200_abc123/download \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**

```json
{
  "downloadUrl": "https://storage.googleapis.com/...",
  "expiresIn": 86400
}
```

**Note:** The signed URL expires in 24 hours (86400 seconds).

### 6. List User Documents

```bash
# Basic list
curl http://localhost:3000/api/v1/documents \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# With pagination
curl "http://localhost:3000/api/v1/documents?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Filter by status
curl "http://localhost:3000/api/v1/documents?status=PROCESSED&status=FAILED" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Filter by document type
curl "http://localhost:3000/api/v1/documents?documentType=LAB_RESULT&documentType=PRESCRIPTION" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**

```json
{
  "data": [
    {
      "id": "doc_1733875200_abc123",
      "documentType": "LAB_RESULT",
      "status": "PROCESSED",
      "fileName": "test-lab-result.pdf",
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

### 7. Delete Document (Soft Delete)

```bash
curl -X DELETE http://localhost:3000/api/v1/documents/doc_1733875200_abc123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:** `204 No Content`

**Note:** This is a soft delete. The document will be hard-deleted after the retention period (8 years by default).

---

## Document Types

Supported medical document types:

- `LAB_RESULT` - Laboratory test results
- `PRESCRIPTION` - Prescription documents
- `MEDICAL_RECORD` - General medical records
- `INSURANCE_CARD` - Insurance card scans
- `IMAGING_REPORT` - Radiology/imaging reports
- `IMMUNIZATION_RECORD` - Vaccination records
- `OTHER` - Other medical documents

---

## File Validation

**Allowed MIME Types:**

- `application/pdf`
- `image/jpeg`
- `image/png`
- `image/tiff`
- `image/gif`

**Max File Size:** 10 MB (configurable via `DOC_PROCESSING_MAX_FILE_SIZE_MB`)

---

## Rate Limiting

**Upload Endpoint:** 10 requests per 60 seconds per user

If you exceed the rate limit, you'll receive a `429 Too Many Requests` response.

---

## Troubleshooting

### "Processor not found"

**Cause:** Invalid `DOC_PROCESSING_PROCESSOR_ID` or processor in different location.

**Fix:**

1. Verify processor ID in [Document AI Console](https://console.cloud.google.com/ai/document-ai/processors)
2. Ensure processor location matches `DOC_PROCESSING_GCP_LOCATION`
3. Check service account has `roles/documentai.apiUser`

### "Access denied to bucket"

**Cause:** Service account lacks permissions.

**Fix:**

```bash
# Re-authenticate
gcloud auth application-default login

# Grant storage permissions
gsutil iam ch user:YOUR_EMAIL:objectAdmin gs://your-dev-documents
```

### "Processing stuck in PROCESSING status"

**Cause:** Document AI batch processing takes time for large documents.

**Check:**

1. Monitor Document AI quotas: [Quotas Console](https://console.cloud.google.com/apis/api/documentai.googleapis.com/quotas)
2. Check output bucket for results
3. Review application logs: `npm run logs`

**Timeouts:**

- Sync mode (≤15 pages): ~10-30 seconds
- Batch mode (>15 pages): ~2-10 minutes

### "Configuration validation error"

**Cause:** Missing or invalid environment variables.

**Fix:**

Ensure all required variables are set:

```bash
# Check configuration
npm run start:dev 2>&1 | grep "Document Processing"
```

Required variables:

- `DOC_PROCESSING_GCP_PROJECT_ID`
- `DOC_PROCESSING_PROCESSOR_ID`
- `DOC_PROCESSING_STORAGE_BUCKET`
- `DOC_PROCESSING_OUTPUT_BUCKET`

---

## Production Deployment

**Before deploying to production:**

1. ✅ Review [HIPAA Compliance Checklist](./document-processing-hipaa-checklist.md)
2. ✅ Sign BAA with Google Cloud
3. ✅ Move secrets to GCP Secret Manager
4. ✅ Enable audit logging
5. ✅ Configure bucket lifecycle policies (8-year retention)
6. ✅ Set up monitoring and alerting
7. ✅ Run security testing

See [HIPAA Checklist](./document-processing-hipaa-checklist.md) for full details.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     HEXAGONAL ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────┤
│  Controller (HTTP) → Service → Domain Service → Ports       │
│                                        ↓                     │
│                                   Adapters:                  │
│                    ├─ DocumentRepositoryAdapter (PostgreSQL)│
│                    ├─ GcpStorageAdapter (Cloud Storage)     │
│                    └─ GcpDocumentAiAdapter (Document AI)    │
└─────────────────────────────────────────────────────────────┘
```

**Processing Flow:**

1. User uploads file via REST API
2. File validated (type, size)
3. Saved to PostgreSQL (metadata) and GCS (file)
4. OCR processing started asynchronously
5. Results stored in GCS (JSON) and PostgreSQL (extracted fields)
6. User polls status endpoint or fetches results

---

## Cost Estimation

**GCP Document AI Pricing (as of 2025):**

- Enterprise OCR: $1.50 per 1000 pages
- Batch processing: $0.10 per page (first 1M pages)

**Example:**

- 1000 documents/month, avg 3 pages each = 3000 pages/month
- Cost: ~$5/month for OCR
- Storage: ~$0.02/GB/month (Cloud Storage)

**Production Considerations:**

- Enable budget alerts in GCP
- Monitor usage via Cloud Console
- Optimize batch processing for large documents

---

## API Reference

Full Swagger/OpenAPI documentation available at:

```
http://localhost:3000/docs
```

---

## Support

- **Documentation**: [docs/](.)
- **Issues**: [GitHub Issues](https://github.com/your-org/keystone-core-api/issues)
- **Security**: Report to [security@healthatlas.com](mailto:security@healthatlas.com)
- **HIPAA Compliance**: [HIPAA Checklist](./document-processing-hipaa-checklist.md)

---

**Last Updated**: December 2025  
**Version**: 1.0.0


