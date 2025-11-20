# Document Download Authorization Debug Guide

## 🐛 The Issue

**Error:** `{"message": "Document not found", "error": "Not Found", "statusCode": 404}`

**Audit Log:**
```json
{
  "userId": 1,
  "provider": "document-processing",
  "event": "UNAUTHORIZED_DOCUMENT_ACCESS",
  "success": false,
  "metadata": {
    "documentId": "99ab0a61-a32d-445e-bc3b-b5b784218fae"
  }
}
```

## 🔍 Root Cause

The authorization check is failing because **the document belongs to a different user than the one making the request**.

### How Authorization Works

```typescript
// When you call GET /documents/:documentId/download
async getDownloadUrl(documentId, userId) {
  // Queries: SELECT * FROM documents WHERE id = ? AND userId = ?
  const document = await findByIdAndUserId(documentId, userId);
  
  if (!document) {
    // Document either doesn't exist OR belongs to different user
    throw new NotFoundException('Document not found');
  }
}
```

**Key Point:** The query requires BOTH `documentId` AND `userId` to match!

## 🧪 Enhanced Debugging

I've added debug logging to help diagnose this issue. Now when you try to access a document, you'll see:

```
[AUTH] Checking access: documentId=99ab0a61-..., requestUserId=1, documentExists=true, documentOwnerId=2
[AUTH] Document 99ab0a61-... exists but belongs to user 2, not 1
```

## 📊 Diagnostic Steps

### Step 1: Check Who Owns the Document

```sql
-- Query the database directly
SELECT id, user_id, file_name, status, created_at 
FROM documents 
WHERE id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';
```

**Look for:**
- `user_id` column - This is the document owner
- Compare with the userId from your access token (currently: 1)

### Step 2: Check Your Access Token

```bash
# Decode your JWT to see what userId it contains
echo "YOUR_ACCESS_TOKEN" | jwt decode -

# Or use https://jwt.io to decode manually
```

**Look for:**
```json
{
  "id": 1,  // ← This is the userId being used
  "role": "user",
  "sessionId": "..."
}
```

### Step 3: Watch Debug Logs

```bash
# Set log level to debug
LOG_LEVEL=debug npm run start:dev

# In another terminal, watch logs
tail -f logs/app.log | grep -E '\[AUTH\]'
```

**Try to download:**
```bash
curl -X GET http://localhost:3000/v1/documents/99ab0a61-.../download \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected log output:**
```
[AUTH] Checking access: documentId=99ab0a61-..., requestUserId=1, documentExists=true, documentOwnerId=2
[AUTH] Document 99ab0a61-... exists but belongs to user 2, not 1
```

## 🎯 Common Causes & Solutions

### Cause 1: Document Uploaded by Different User

**Scenario:**
- You uploaded the document while logged in as user A
- You're trying to download while logged in as user B

**Solution Option A:** Login as the Original User
```bash
# Login as the user who uploaded the document
curl -X POST http://localhost:3000/v1/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email": "original-user@example.com", "password": "password"}'

# Use the returned token
```

**Solution Option B:** Re-upload Document as Current User
```bash
# Upload again with your current token
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_CURRENT_TOKEN" \
  -F "file=@document.pdf" \
  -F "documentType=lab_result"
```

### Cause 2: Test Data vs Production User

**Scenario:**
- Document was created during testing/seeding
- Using a real user account now

**Solution:** Check Seeded Documents
```sql
-- Find all documents and their owners
SELECT d.id, d.file_name, d.user_id, u.email 
FROM documents d
LEFT JOIN users u ON u.id = d.user_id
ORDER BY d.created_at DESC
LIMIT 10;
```

**Fix:** Either use the test user or re-upload as current user

### Cause 3: Wrong Environment/Database

**Scenario:**
- Document exists in staging DB
- You're querying production DB (or vice versa)

**Solution:** Verify Database Connection
```bash
# Check your .env or environment
echo $DATABASE_HOST
echo $DATABASE_NAME

# Verify you're connected to the right database
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -c "\dt documents"
```

### Cause 4: User ID Type Mismatch

**Scenario:**
- JWT contains userId as string: `"id": "1"`
- Database stores as integer: `user_id = 1`
- String "1" !== Number 1 in strict comparison

**Good News:** ✅ Already handled in code:
```typescript
// Repository automatically converts
const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
```

But verify your JWT token has the correct type.

## 🔧 Quick Fixes

### Fix 1: Create Test Document as Current User

```bash
# 1. Get your current userId from token
curl -X GET http://localhost:3000/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
# Response: { "id": 1, "email": "..." }

# 2. Upload new document
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result"
# Response: { "id": "NEW_DOC_ID", ... }

# 3. Try download again with NEW document
curl -X GET http://localhost:3000/v1/documents/NEW_DOC_ID/download \
  -H "Authorization: Bearer YOUR_TOKEN"
# Should work! ✅
```

### Fix 2: Update Document Owner (Temporary for Testing)

**⚠️ ONLY FOR LOCAL DEVELOPMENT/TESTING**

```sql
-- DANGEROUS: Only use in dev environment!
UPDATE documents 
SET user_id = 1  -- Your current user ID
WHERE id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';
```

### Fix 3: Add Admin Override (Not Recommended)

For admin users who need to access any document, you could add:

```typescript
// In domain service (not implemented yet - just an example)
async getDocument(documentId: string, userId: string | number): Promise<Document> {
  const user = await this.userService.findById(userId);
  
  // Admin bypass (implement carefully with audit logging!)
  if (user.role === 'admin') {
    return this.documentRepository.findById(documentId);
  }
  
  // Normal authorization
  return this.documentRepository.findByIdAndUserId(documentId, userId);
}
```

**⚠️ Important:** This bypasses security. Only implement if you have proper audit logging and RBAC controls.

## 🧪 Testing Script

Create a test script to verify ownership:

```bash
#!/bin/bash
# save as: test-document-ownership.sh

TOKEN="YOUR_ACCESS_TOKEN"
DOC_ID="99ab0a61-a32d-445e-bc3b-b5b784218fae"

echo "=== Testing Document Ownership ==="

# 1. Get current user
echo -e "\n1. Current user:"
curl -s http://localhost:3000/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq '.id, .email'

# 2. Get document details
echo -e "\n2. Document details:"
curl -s http://localhost:3000/v1/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN"

# 3. Try to download
echo -e "\n3. Download URL:"
curl -s http://localhost:3000/v1/documents/$DOC_ID/download \
  -H "Authorization: Bearer $TOKEN"

echo -e "\n=== Done ==="
```

## 📊 Database Queries for Debugging

### Check Document Ownership

```sql
-- Find document and its owner
SELECT 
  d.id as document_id,
  d.file_name,
  d.status,
  d.user_id as owner_id,
  u.email as owner_email,
  d.created_at
FROM documents d
LEFT JOIN users u ON u.id = d.user_id
WHERE d.id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';
```

### Find All Your Documents

```sql
-- Replace 1 with your user ID
SELECT id, file_name, status, created_at
FROM documents
WHERE user_id = 1
ORDER BY created_at DESC;
```

### Check User Sessions

```sql
-- Verify your user ID from sessions
SELECT 
  s.id as session_id,
  s.user_id,
  s.hash,
  s.created_at,
  u.email
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.hash = 'YOUR_SESSION_HASH'  -- From your JWT
ORDER BY s.created_at DESC
LIMIT 1;
```

## 🎯 Expected Log Flow

### Successful Access

```
[AUTH] Checking access: documentId=abc-123, requestUserId=1, documentExists=true, documentOwnerId=1
// No warning - document found and authorized
{"event":"DOCUMENT_ACCESSED","success":true,"userId":1}
```

### Failed Access (Wrong Owner)

```
[AUTH] Checking access: documentId=abc-123, requestUserId=1, documentExists=true, documentOwnerId=2
[AUTH] Document abc-123 exists but belongs to user 2, not 1
{"event":"UNAUTHORIZED_DOCUMENT_ACCESS","success":false,"userId":1,"metadata":{"documentOwnerId":2}}
```

### Failed Access (Document Not Found)

```
[AUTH] Checking access: documentId=abc-123, requestUserId=1, documentExists=false, documentOwnerId=undefined
[AUTH] Document abc-123 does not exist in database
{"event":"UNAUTHORIZED_DOCUMENT_ACCESS","success":false,"userId":1,"metadata":{"documentExists":false}}
```

## ✅ Solution Checklist

To fix your specific issue:

- [ ] Restart server with debug logging: `LOG_LEVEL=debug npm run start:dev`
- [ ] Check logs when accessing document
- [ ] Run SQL query to check document ownership
- [ ] Verify your JWT token has correct userId
- [ ] Compare JWT userId with document's user_id
- [ ] **If different owners:** Re-upload document as current user
- [ ] **If same owner:** Check for type mismatch or DB connection issue
- [ ] Test with newly uploaded document
- [ ] Verify download works

## 🎉 Success Criteria

After fixing, you should:

1. ✅ See successful auth log: `[AUTH] Checking access: ... documentOwnerId=1`
2. ✅ Get download URL successfully
3. ✅ Audit log shows: `DOCUMENT_ACCESSED` (not UNAUTHORIZED)
4. ✅ Can download the file from the URL

## 📚 Related Files

- **Controller**: `src/document-processing/document-processing.controller.ts` (line 211)
- **Domain Service**: `src/document-processing/domain/services/document-processing.domain.service.ts` (line 577)
- **Repository**: `src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts` (line 50)

---

**Status**: ✅ Debug logging added  
**Next Step**: Restart server and check logs  
**Most Likely Fix**: Re-upload document as current user

**Last Updated**: November 13, 2025










