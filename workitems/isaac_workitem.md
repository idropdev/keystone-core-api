# Work Item: Document Fields Edit Endpoint

## Overview

Add the ability for users to edit OCR-extracted fields from documents. The workflow ensures OCR completes first, then allows user edits, and finally returns both OCR fields and user-edited fields.

## Current State

- ✅ `POST /v1/documents/upload` - Upload document
- ✅ `GET /v1/documents/:documentId/status` - Check processing status
- ✅ `GET /v1/documents/:documentId/fields` - Get extracted fields (OCR only)
- ❌ **Missing**: Edit endpoint for fields
- ❌ **Missing**: Database fields to track user edits

## Required Workflow

```
1. Upload Document
   POST /v1/documents/upload
   → Returns: { id, status: "STORED", ... }

2. Check Status (Poll until PROCESSED)
   GET /v1/documents/:documentId/status
   → Returns: { status: "PROCESSING" | "PROCESSED", progress: 50-100 }

3a. If status === "PROCESSED" AND user wants to edit:
   PATCH /v1/documents/:documentId/fields
   → Body: { fields: [{ fieldKey: "patient_name", fieldValue: "John Doe" }, ...] }
   → Returns: { fields: [...], ocrFields: [...], editedFields: [...] }

3b. If no edit needed:
   Continue to step 4

4. Get Final Fields (OCR + Edited)
   GET /v1/documents/:documentId/fields
   → Returns: {
       ocrFields: [...],      // Original OCR extracted fields
       editedFields: [...],    // User-edited fields (if any)
       mergedFields: [...]     // Final merged view (edited takes precedence)
     }
```

## Preconditions

Edits are **only allowed** when:

- Document **must exist**
- Document **must belong to the requesting user**
- Document **status must be `PROCESSED`** (OCR must complete first)
- OCR extraction must already be complete

Edits are **rejected** if these conditions are not met.

## Functional Requirements

### 1. Field Editing

- Users can update values for existing OCR-extracted fields
- Users can add new fields not detected by OCR
- Field identity is determined by `fieldKey`
- Multiple fields can be edited in a single request

### 2. OCR Preservation

- Original OCR values **must never be overwritten**
- User edits are stored separately and linked to the original field
- Original `fieldValue` from OCR is preserved
- Edited value is stored in `editedValue` field

### 3. Edit Tracking

Each edited field must retain:

- `editedValue` - The user-provided corrected value
- `isEdited` - Boolean flag indicating if field was edited
- `editedBy` - User ID who made the edit
- `editedAt` - Timestamp of the edit

### 4. Data Views

The system must support **three simultaneous views** of document fields:

| View | Description |
|------|-------------|
| **OCR Fields** | Original, unmodified OCR output |
| **Edited Fields** | Only fields that were user-modified |
| **Merged Fields** | Final authoritative view (edits override OCR) |

**Rules:**
- `mergedFields.fieldValue` reflects edited value if present, otherwise OCR value
- OCR confidence scores remain attached to original fields
- New user-added fields appear only in edited + merged views

## API Contract

### PATCH /v1/documents/:documentId/fields

**Description:** Edit OCR-extracted fields. Only works after document status is PROCESSED.

**Request:**
```json
{
  "fields": [
    {
      "fieldKey": "patient_name",
      "fieldValue": "John Doe"
    },
    {
      "fieldKey": "test_date",
      "fieldValue": "2025-01-15"
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "ocrFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "Jon Doe",
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": false
    }
  ],
  "editedFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "Jon Doe",
      "editedValue": "John Doe",
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": true,
      "editedAt": "2025-01-20T10:30:00Z"
    }
  ],
  "mergedFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "John Doe",
      "editedValue": "John Doe",
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": true,
      "editedAt": "2025-01-20T10:30:00Z"
    }
  ]
}
```

**Error Responses:**
- `400 Bad Request` - Document not PROCESSED yet or invalid field data
- `401 Unauthorized` - Invalid or expired access token
- `404 Not Found` - Document not found or access denied

### Updated GET /v1/documents/:documentId/fields

**Description:** Get structured fields extracted from the document. Returns OCR, edited, and merged views.

**Response (200 OK):**
```json
{
  "ocrFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "Jon Doe",
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": false
    }
  ],
  "editedFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "Jon Doe",
      "editedValue": "John Doe",
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": true,
      "editedAt": "2025-01-20T10:30:00Z"
    }
  ],
  "mergedFields": [
    {
      "id": "field-uuid-1",
      "fieldKey": "patient_name",
      "fieldValue": "John Doe",
      "editedValue": "John Doe",
      "fieldType": "string",
      "confidence": 0.85,
      "isEdited": true,
      "editedAt": "2025-01-20T10:30:00Z"
    }
  ]
}
```

## Data Model Changes

### ExtractedField Entity Updates

Add fields to track user edits:

**New Fields:**
- `editedValue?: string` - User-edited value (null if not edited)
- `isEdited: boolean` - Flag indicating if field was edited (default: false)
- `editedBy?: string | number` - User ID who edited (null if not edited)
- `editedAt?: Date` - Timestamp of edit (null if not edited)

**Preserved Fields:**
- `fieldValue` - Original OCR value (never overwritten)
- `fieldKey` - Field identifier
- `fieldType` - Field type
- `confidence` - OCR confidence score

## Validation Rules

- Reject edits if document is not `PROCESSED`
- Reject edits for documents not owned by the user
- Reject invalid or empty field payloads
- Field keys must be deterministic and consistent
- `fieldValue` in request body is required and non-empty

## Security & Compliance

### HIPAA Considerations

- Field edits are considered PHI - ensure encrypted at rest
- Enforce access control per document ownership
- Audit every edit action without logging PHI values
- Log only: `userId`, `documentId`, `fieldKey`, `timestamp` (not `fieldValue`)

### Access Control

- Users can only edit their own documents
- JWT authentication required
- Session validation on every request

## Workflow Validation

1. **OCR Must Complete First**: Endpoint rejects edits if `status !== PROCESSED`
2. **User Can Edit Any Field**: Can edit existing OCR fields or add new fields
3. **Preserve Original OCR**: Original `fieldValue` is kept, `editedValue` stores the edit
4. **Merged View**: `mergedFields` shows edited values where applicable, OCR values otherwise

## Testing Requirements

### Unit Tests

- Domain service: editFields logic
- Repository: upsert behavior for edited fields
- DTO validation
- Validation rules (status check, ownership check)

### Integration Tests

- Edit fields endpoint (happy path)
- Edit fields when document not processed (should fail with 400)
- Edit fields for non-existent document (should fail with 404)
- Edit fields for another user's document (should fail with 404)
- Get fields returns OCR + edited separation
- Merged fields correctly prioritize edits

### E2E Tests

1. Upload document → Check status → Edit fields → Get fields
2. Verify OCR fields preserved
3. Verify edited fields override in merged view
4. Verify new user-added fields appear correctly

## Documentation Updates

1. **API Docs** (`docs/document-processing.md`):
   - Add PATCH endpoint documentation
   - Update GET /fields response format
   - Document workflow: Upload → Status → Edit → Get Fields

2. **Quick Start** (`docs/document-processing-quick-start.md`):
   - Add edit fields example
   - Show complete workflow with edit step

3. **Workflow Diagrams**:
   - Update to include edit step after OCR completion

## Implementation Considerations

### Database Migration

- Add new columns to `extracted_fields` table:
  - `edited_value` (text, nullable)
  - `is_edited` (boolean, default false)
  - `edited_by` (integer, nullable)
  - `edited_at` (timestamp, nullable)

### Backward Compatibility

- Existing OCR records remain valid (all new fields nullable/default)
- No destructive changes to existing OCR data
- GET /fields endpoint maintains backward compatibility by returning all three views

### Performance

- Field updates should use upsert logic (insert or update)
- Index on `document_id` and `field_key` for efficient lookups
- Consider batch updates for multiple field edits

## Acceptance Criteria

- [ ] Users can edit document fields after OCR completes
- [ ] Original OCR values are preserved and immutable
- [ ] Edited fields track who and when
- [ ] Merged fields provide authoritative output
- [ ] Unauthorized or premature edits are rejected
- [ ] API responses expose all three field views (OCR, edited, merged)
- [ ] Database migration runs successfully
- [ ] All tests pass (unit, integration, e2e)
- [ ] Documentation reflects updated workflow
- [ ] Audit logging captures edit events without PHI

## Implementation Order

1. Database migration (add edit columns)
2. Domain entity updates
3. Repository updates (upsert logic)
4. DTOs (request and response)
5. Domain service method
6. Application service method
7. Controller endpoint (PATCH)
8. Update GET /fields endpoint
9. Tests (unit, integration, e2e)
10. Documentation updates
