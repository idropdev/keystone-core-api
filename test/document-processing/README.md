# Document Processing E2E Tests

This directory contains comprehensive end-to-end tests for the document processing system.

## Test Files

### `full-workflow.e2e-spec.ts`
**Comprehensive full workflow tests covering:**
1. **User Creation and Authentication** - User and manager creation, token validation
2. **Document Upload Workflow** - Upload, validation, status checking
3. **Document Details and Metadata** - Retrieving document info, download URLs
4. **OCR Triggering and Processing** - Manual OCR trigger, authorization checks
5. **Status Checking During Processing** - Status progression monitoring
6. **Field Extraction and Retrieval** - Waiting for processing, retrieving extracted fields
7. **Manager Assignment and Access Control** - Origin manager access, access grants, secondary managers
8. **Full End-to-End Workflow Scenario** - Complete workflow from upload to field extraction
9. **Document Listing and Filtering** - Pagination, status filtering, documentType filtering
10. **Error Handling and Edge Cases** - 404 handling, invalid UUIDs, admin rejection

### `documents.e2e-spec.ts`
**Endpoint-specific authorization and validation tests:**
- Role-based access control (Admin, Manager, User)
- Access grant scenarios
- Endpoint validation and error handling

## Running the Tests

### Run all document processing tests:
```bash
npm run test:e2e test/document-processing/
```

### Run full workflow tests only:
```bash
npm run test:e2e test/document-processing/full-workflow.e2e-spec.ts
```

### Run in Docker:
```bash
npm run test:e2e:document:docker
```

## Test Coverage

### Document Lifecycle
- ✅ Upload → STORED status
- ✅ OCR trigger → PROCESSING → PROCESSED
- ✅ Field extraction and retrieval
- ✅ Status progression monitoring
- ✅ Error state handling

### Access Control
- ✅ Origin manager full access
- ✅ Access grants for users and secondary managers
- ✅ Admin hard-denied (403) from all document operations
- ✅ Unauthorized access rejection (403/404)

### OCR Processing
- ✅ Manual OCR trigger (origin manager only)
- ✅ Status tracking during processing
- ✅ Field extraction after processing
- ✅ Processing method tracking (DIRECT_EXTRACTION, OCR_SYNC, OCR_BATCH)

### Document Operations
- ✅ Upload with metadata (documentType, description)
- ✅ Download URL generation
- ✅ Document listing with pagination and filtering
- ✅ Document deletion (origin manager only)

## Test Data

Tests use:
- Test PDF file: `docs/test_docs/lab-result.pdf`
- Generated test users with unique emails
- Verified managers created via admin API
- Access grants for testing access control

## Important Notes

### Rate Limiting
Tests include delays and retry logic to handle rate limiting:
- Auth endpoints: 5 requests per 60 seconds (IP-based)
- Document endpoints: 10 requests per 60 seconds

### OCR Processing Time
OCR processing is asynchronous and may take time:
- Direct extraction (pdf2json): ~100-500ms
- OCR sync: 2-30 seconds
- OCR batch: 10-30 seconds

Tests include timeouts and retry logic for async operations.

### Manager Assignment
- Documents have an immutable `originManagerId` set at upload time
- Users need access grants to view documents
- Secondary managers can access documents via access grants
- Origin managers have implicit access (no grant needed)

## Future Enhancements

Potential test additions:
- [ ] Document field editing (PATCH /documents/:id/fields)
- [ ] Document metadata updates (PATCH /documents/:id)
- [ ] OCR retry functionality (POST /documents/:id/ocr/retry)
- [ ] Revocation request workflow
- [ ] Manager assignment to document (if endpoint is implemented)
- [ ] Batch document operations
- [ ] Document processing method validation

