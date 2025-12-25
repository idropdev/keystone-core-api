# Document Download Endpoint Description

## Endpoint Overview

**Endpoint:** `GET /v1/documents/:documentId/download`

**Purpose:** Generate a secure, time-limited signed URL that allows the authenticated user to download the original document file from cloud storage (GCP Cloud Storage).

---

## What This Endpoint Should Do

### 1. **Authentication & Authorization**
   - Requires a valid JWT access token in the `Authorization: Bearer <token>` header
   - Extracts the `userId` from the JWT token payload
   - Verifies that the document exists AND belongs to the requesting user
   - Returns `401 Unauthorized` if token is invalid/expired
   - Returns `404 Not Found` if document doesn't exist OR doesn't belong to the user

### 2. **Document Validation**
   - Validates that the document exists in the database
   - Checks that `document.rawFileUri` is present (document file was successfully stored)
   - Returns `404 Not Found` if the file URI is missing

### 3. **Signed URL Generation**
   - Parses the GCS URI (format: `gs://bucket-name/path/to/file`)
   - Generates a GCP Cloud Storage v4 signed URL using the storage service
   - Sets expiration to **24 hours (86400 seconds)** from generation time
   - The signed URL allows direct access to the file without additional authentication

### 4. **Response Format**
   ```json
   {
     "downloadUrl": "https://storage.googleapis.com/bucket-name/path/to/file.pdf?X-Goog-Algorithm=...&X-Goog-Signature=...",
     "expiresIn": 86400
   }
   ```

### 5. **Audit Logging**
   - Logs successful document access events
   - Logs unauthorized access attempts (for security monitoring)
   - Includes metadata: `documentId`, `userId`, `event type`, `success status`

---

## Request Flow

```
1. Client Request
   GET /v1/documents/{documentId}/download
   Headers: Authorization: Bearer <jwt_token>

2. Controller Layer (document-processing.controller.ts)
   - Validates UUID format for documentId
   - Extracts userId from req.user.id (set by JWT guard)
   - Calls documentProcessingService.getDownloadUrl(documentId, userId)

3. Application Service Layer (document-processing.service.ts)
   - Thin orchestration layer
   - Delegates to domainService.getDownloadUrl(documentId, userId)

4. Domain Service Layer (document-processing.domain.service.ts)
   - Calls getDocument(documentId, userId) for authorization
     - Queries: SELECT * FROM documents WHERE id = ? AND userId = ?
     - Throws NotFoundException if document doesn't exist or wrong owner
   - Validates document.rawFileUri exists
   - Calls storageService.getSignedUrl(rawFileUri, 86400)

5. Storage Adapter (gcp-storage.adapter.ts)
   - Parses GCS URI: gs://bucket/path → { bucket, objectKey }
   - Uses GCP Storage SDK: file.getSignedUrl({ version: 'v4', action: 'read', expires: ... })
   - Returns signed HTTPS URL

6. Response
   - Returns { downloadUrl, expiresIn: 86400 }
```

---

## Security Considerations

### HIPAA Compliance
- ✅ **No PHI in logs**: Only logs documentId and userId, never file contents or URIs at INFO level
- ✅ **User isolation**: Each user can only access their own documents
- ✅ **Time-limited access**: Signed URLs expire after 24 hours
- ✅ **Audit trail**: All access attempts are logged for compliance

### Authorization Model
- **Strict ownership check**: Document must belong to the requesting user
- **No admin bypass**: Currently, even admins cannot access other users' documents
- **Soft-delete aware**: Deleted documents are still accessible (for retention period)

---

## Error Scenarios

| Error Code | Scenario | Response |
|------------|----------|----------|
| `401 Unauthorized` | Missing/invalid JWT token | `{ "message": "Unauthorized", "statusCode": 401 }` |
| `404 Not Found` | Document doesn't exist OR wrong owner | `{ "message": "Document not found", "statusCode": 404 }` |
| `404 Not Found` | Document exists but `rawFileUri` is null | `{ "message": "Document file not available", "statusCode": 404 }` |
| `500 Internal Server Error` | GCP authentication failure | `{ "message": "Failed to generate download URL", "statusCode": 500 }` |
| `500 Internal Server Error` | GCS bucket/file access error | `{ "message": "Failed to generate download URL", "statusCode": 500 }` |

---

## Key Files

1. **Controller**: `src/document-processing/document-processing.controller.ts` (line 262-309)
   - Handles HTTP request/response
   - Validates UUID parameter
   - Extracts userId from authenticated request

2. **Application Service**: `src/document-processing/document-processing.service.ts` (line 98-103)
   - Thin orchestration layer
   - Delegates to domain service

3. **Domain Service**: `src/document-processing/domain/services/document-processing.domain.service.ts` (line 699-710)
   - Business logic: authorization check
   - Calls storage service for signed URL generation

4. **Storage Adapter**: `src/document-processing/infrastructure/storage/gcp-storage.adapter.ts` (line 189-221)
   - GCP Cloud Storage integration
   - Generates v4 signed URLs

5. **Repository**: `src/document-processing/infrastructure/persistence/.../repositories/document.repository.ts`
   - Database queries: `findByIdAndUserId(documentId, userId)`

---

## Expected Behavior Summary

✅ **Should Work:**
- User requests download URL for their own document
- Document has a valid `rawFileUri` stored
- GCP credentials are valid and have storage permissions
- Returns signed URL that works for 24 hours

❌ **Should Fail:**
- User tries to access another user's document → 404
- Document doesn't exist → 404
- Document exists but file was never uploaded (`rawFileUri` is null) → 404
- GCP authentication fails → 500
- Invalid JWT token → 401

---

## Related Documentation

- `DOCUMENT_DOWNLOAD_AUTH_DEBUG.md` - Debugging guide for authorization issues
- `docs/document-processing.md` - Full API documentation
- `docs/gcp-deployment-guide.md` - GCP setup and configuration

---

**Created:** Branch `bug/document-download-link-issue`  
**Purpose:** Bug investigation and fix for download endpoint errors


