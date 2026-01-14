# Temporary Manager Support Feature

## Overview

The **Temporary Manager Support** feature (implemented in `feature/temporary-manager-support`) enables users to upload documents without requiring an assigned manager. When a user uploads a document, they automatically become a "temporary manager" with full origin manager capabilities. This allows for a more flexible document intake workflow while maintaining proper access control and authority management.

## Problem Statement

Previously, users were required to have an assigned manager before they could upload documents. This created a barrier for document intake, especially in scenarios where:
- Users need to upload documents before a manager relationship is established
- Users are uploading documents independently (e.g., patient self-service portals)
- Temporary or ad-hoc document submissions are needed

## Solution

The temporary manager feature allows:
- **Users** to upload documents without an assigned manager
- **Users** who upload to automatically become temporary managers with full authority
- **Temporary managers** to have all the same capabilities as origin managers
- **Authority transfer** from temporary manager to a real manager when needed

## Architecture

### Database Schema

The feature introduces a new column `temporary_manager_id` to the `documents` table:

```sql
-- Documents table structure
documents
├── origin_manager_id (nullable)      -- Real manager who is custodian
├── temporary_manager_id (nullable)   -- User who uploaded without manager
└── origin_user_context_id (nullable) -- Audit context (who uploaded)
```

**Constraints:**
- Exactly one of `origin_manager_id` OR `temporary_manager_id` must be set (never both, never neither)
- `origin_manager_id` references `manager_instances.id`
- `temporary_manager_id` references `user.id`
- Check constraint: `CHK_documents_origin_exclusive`

### Document Authority Model

```
┌─────────────────────────────────────────────────────────┐
│                    Document Authority                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Manager Upload → originManagerId set                  │
│  └─> Manager becomes origin manager                     │
│                                                          │
│  User Upload (no manager) → temporaryManagerId set     │
│  └─> User becomes temporary manager                    │
│                                                          │
│  Transfer → temporaryManagerId cleared                  │
│           → originManagerId set                         │
│  └─> Real manager takes over                           │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Behavior & Rules

### Upload Behavior

#### Manager Upload
- **Actor**: Manager (role: manager)
- **Result**: Document gets `originManagerId = manager.id`
- **Authority**: Manager becomes origin manager with full capabilities
- **Verification**: Manager must be verified

#### User Upload (No Manager Required)
- **Actor**: User (role: user)
- **Result**: Document gets `temporaryManagerId = user.id`
- **Authority**: User becomes temporary manager with full capabilities
- **Verification**: No manager verification required

### Temporary Manager Capabilities

Temporary managers have **all the same capabilities** as origin managers:

✅ **Full Authority:**
- Trigger OCR processing
- Modify document metadata (fileName, description, documentType)
- Create owner-level access grants
- Create delegated access grants
- Revoke any access grant
- View, download, and manage document

✅ **Same Restrictions:**
- Cannot delete documents (retention policy)
- Cannot modify OCR results (canonical data)
- Cannot modify extracted fields (users can edit, managers cannot)

### Authority Transfer

Temporary managers can transfer authority to a real manager:

**Endpoint**: `POST /v1/documents/:documentId/assign-manager`

**Request:**
```json
{
  "managerId": 123
}
```

**Behavior:**
1. Only the temporary manager can initiate transfer
2. Manager must exist and be verified
3. Document is updated:
   - `originManagerId` = manager.id
   - `temporaryManagerId` = null
4. Temporary manager loses all privileges
5. Real manager gains full origin manager authority

**After Transfer:**
- Temporary manager becomes a regular user (no special privileges)
- Real manager has full origin manager capabilities
- Transfer is irreversible (originManagerId is immutable after creation)

## API Endpoints

### Upload Document

**Endpoint**: `POST /v1/documents/upload`

**User Upload (No Manager):**
```json
POST /v1/documents/upload
Authorization: Bearer <user-token>
Content-Type: multipart/form-data

{
  "file": <file>,
  "documentType": "lab_result",
  "description": "Optional description"
}
```

**Response:**
```json
{
  "id": "uuid-here",
  "fileName": "document.pdf",
  "status": "STORED",
  "originManagerId": null,
  "temporaryManagerId": 456,  // User becomes temporary manager
  "documentType": "lab_result",
  "createdAt": "2025-01-20T10:00:00Z"
}
```

### Trigger OCR (Temporary Manager)

**Endpoint**: `POST /v1/documents/:documentId/ocr/trigger`

**Authorization**: Origin manager OR temporary manager

**Request:**
```json
POST /v1/documents/{documentId}/ocr/trigger
Authorization: Bearer <user-token>  // Temporary manager token
```

**Response:**
```json
{
  "message": "OCR processing triggered successfully"
}
```

### Assign Real Manager

**Endpoint**: `POST /v1/documents/:documentId/assign-manager`

**Authorization**: Temporary manager only

**Request:**
```json
POST /v1/documents/{documentId}/assign-manager
Authorization: Bearer <user-token>  // Temporary manager token

{
  "managerId": 123
}
```

**Response:**
```json
{
  "id": "uuid-here",
  "fileName": "document.pdf",
  "status": "PROCESSED",
  "originManagerId": 123,           // Now set
  "temporaryManagerId": null,      // Cleared
  "documentType": "lab_result",
  "updatedAt": "2025-01-20T11:00:00Z"
}
```

**Errors:**
- `403 Forbidden`: Not the temporary manager
- `404 Not Found`: Manager not found
- `403 Forbidden`: Manager not verified
- `400 Bad Request`: Document already has origin manager

## Access Control

### Authority Resolution

The system checks both origin manager and temporary manager for access:

```typescript
// Pseudo-code
function hasAccess(document, actor) {
  // Check origin manager
  if (actor.type === 'manager' && 
      document.originManagerId === manager.id) {
    return true;
  }
  
  // Check temporary manager
  if (actor.type === 'user' && 
      document.temporaryManagerId === actor.id) {
    return true;
  }
  
  // Check access grants
  return hasActiveGrant(document, actor);
}
```

### Access Grant Rules

**Temporary Managers Can:**
- Create owner grants (full authority)
- Create delegated grants
- Revoke any grant (their own or others')

**Cannot Create Grants For:**
- Themselves (they have implicit access)
- Origin manager (if document was transferred)

## Database Migration

### Migration: `1768000000000-AddTemporaryManagerToDocuments`

**Steps:**
1. Make `origin_manager_id` nullable (if not already)
2. Add `temporary_manager_id` column (nullable)
3. Update existing documents with NULL `origin_manager_id`:
   - Set `temporary_manager_id = user_id` for those documents
4. Add foreign key constraint to `user` table
5. Add check constraint (exactly one must be set)
6. Add index on `temporary_manager_id`

**Migration Command:**
```bash
npm run migration:run
```

**Data Migration:**
- Existing documents with `origin_manager_id = NULL` are updated to have `temporary_manager_id = user_id`
- This ensures all documents comply with the check constraint before it's added

## Use Cases

### Use Case 1: Patient Self-Service Upload

**Scenario**: Patient uploads lab results before seeing a doctor

1. Patient (user) uploads document via mobile app
2. User becomes temporary manager automatically
3. User can trigger OCR, view results, share with family
4. When doctor is assigned, patient transfers authority
5. Doctor becomes origin manager with full control

### Use Case 2: Independent Document Submission

**Scenario**: User needs to submit documents without manager assignment

1. User uploads document without manager relationship
2. User has full control as temporary manager
3. User can manage access, trigger processing
4. Later, when manager relationship is established, transfer occurs

### Use Case 3: Manager Upload (Unchanged)

**Scenario**: Manager uploads document directly

1. Manager uploads document
2. Manager becomes origin manager (no change from before)
3. Standard origin manager workflow applies

## Edge Cases & Validation

### Edge Case 1: User Uploads with Assigned Manager

**Current Behavior**: User uploads without manager requirement
- If user has assigned managers, they can still upload without selecting one
- User becomes temporary manager regardless
- User can later transfer to any verified manager

**Future Enhancement**: Allow user to select manager at upload time

### Edge Case 2: Transfer to Unverified Manager

**Validation**: Manager must be verified before transfer
- Returns `403 Forbidden` if manager not verified
- Temporary manager must contact admin to verify manager first

### Edge Case 3: Multiple Transfer Attempts

**Validation**: Only temporary manager can transfer
- Returns `403 Forbidden` if not temporary manager
- Returns `400 Bad Request` if document already has origin manager

### Edge Case 4: Temporary Manager Deletion

**Behavior**: If temporary manager (user) is deleted
- Foreign key constraint: `ON DELETE SET NULL`
- `temporary_manager_id` is set to NULL
- Document becomes orphaned (violates check constraint)
- **TODO**: Add application-level validation to prevent user deletion if they are temporary manager

## Testing Scenarios

### Test 1: User Upload Without Manager
```typescript
// User uploads document
const response = await uploadDocument(userToken, file);
expect(response.temporaryManagerId).toBe(userId);
expect(response.originManagerId).toBeNull();
```

### Test 2: Temporary Manager Triggers OCR
```typescript
// Temporary manager triggers OCR
await triggerOcr(documentId, userToken);
// Should succeed
```

### Test 3: Transfer Authority
```typescript
// Transfer to real manager
await assignManager(documentId, managerId, userToken);
const doc = await getDocument(documentId, managerToken);
expect(doc.originManagerId).toBe(managerId);
expect(doc.temporaryManagerId).toBeNull();
```

### Test 4: Access After Transfer
```typescript
// User loses access after transfer
const hasAccess = await checkAccess(documentId, userToken);
expect(hasAccess).toBe(false); // Unless granted via AccessGrant
```

## Security Considerations

### HIPAA Compliance

- **No PHI in OAuth**: Temporary manager feature doesn't change OAuth flow
- **Audit Logging**: All temporary manager actions are logged
- **Access Control**: Same access control rules apply
- **Data Retention**: Documents follow same retention policies

### Authorization

- **Temporary Manager Verification**: No additional verification required (user is already authenticated)
- **Transfer Verification**: Manager must be verified before transfer
- **Immutability**: `originManagerId` cannot be changed after transfer (except from temporary to real)

## Future Enhancements

### Potential Improvements

1. **Manager Selection at Upload**: Allow users to select manager at upload time (if they have assigned managers)
2. **Bulk Transfer**: Transfer multiple documents at once
3. **Transfer Notifications**: Notify manager when authority is transferred
4. **Temporary Manager Expiration**: Auto-transfer after period of time
5. **Manager Invitation**: Allow temporary manager to invite manager to claim document

## Related Documentation

- [Document Processing Architecture](../document-processing/architecture.md)
- [Access Control Design](../access-control/design.md)
- [Manager Role Architecture](../managers/architecture.md)
- [Database Migrations](../database/migrations.md)

## Branch Information

**Branch**: `feature/temporary-manager-support`  
**Base Branch**: `feature/anythingllm-endpoint-integration`  
**Status**: Ready for validation and testing

## Migration Notes

When running the migration, ensure:
1. Database backup is taken
2. All existing documents are reviewed
3. Documents with NULL `origin_manager_id` will be updated to have `temporary_manager_id = user_id`
4. Check constraint will be enforced after migration

## Support & Troubleshooting

### Common Issues

**Issue**: Migration fails with check constraint violation
- **Cause**: Documents with both NULL values
- **Solution**: Migration automatically fixes this by setting `temporary_manager_id = user_id`

**Issue**: User cannot transfer authority
- **Cause**: User is not temporary manager
- **Solution**: Verify document was uploaded by that user

**Issue**: Manager not found during transfer
- **Cause**: Manager ID doesn't exist or manager is deleted
- **Solution**: Verify manager exists and is active

## Summary

The Temporary Manager Support feature provides a flexible document upload workflow that:
- Removes the requirement for users to have assigned managers
- Gives users full document authority when they upload
- Allows seamless transfer to real managers when needed
- Maintains all security and access control requirements
- Preserves HIPAA compliance and audit requirements

This feature enables patient self-service, independent document submission, and more flexible intake workflows while maintaining proper authority management and access control.

