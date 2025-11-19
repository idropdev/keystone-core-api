# Download 404 Error - Quick Fix

## ❌ The Problem

```bash
GET /documents/99ab0a61-a32d-445e-bc3b-b5b784218fae/download
→ 404 Not Found
```

```json
{
  "event": "UNAUTHORIZED_DOCUMENT_ACCESS",
  "userId": 1,
  "documentId": "99ab0a61-..."
}
```

## 🔍 What It Means

**The document belongs to a DIFFERENT user!**

- Your userId: `1`
- Document owner: `2` (probably)

## 🚀 Quick Fix (30 seconds)

### Option 1: Upload New Document as Current User

```bash
# Upload new document with YOUR token
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_CURRENT_TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result"

# Get the new document ID from response
# Try download with NEW ID - should work!
```

### Option 2: Check Who Owns It

```sql
-- Run in your database
SELECT 
  id, 
  user_id as owner_id, 
  file_name 
FROM documents 
WHERE id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';
```

**If you see:**
- `owner_id = 2` → Document belongs to user 2
- `owner_id = 1` → Document belongs to you (different issue)

### Option 3: Login as Document Owner

```bash
# If owner is user 2, login as that user
curl -X POST http://localhost:3000/v1/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@example.com", "password": "password"}'

# Use returned token to access document
```

## 🧪 Verify the Fix

```bash
# 1. Check your user ID
curl http://localhost:3000/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
# Note the "id" field

# 2. Upload and download in one go
DOC_ID=$(curl -s -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result" | jq -r '.id')

echo "Uploaded: $DOC_ID"

# 3. Try download immediately
curl http://localhost:3000/v1/documents/$DOC_ID/download \
  -H "Authorization: Bearer YOUR_TOKEN"
# Should work! ✅
```

## 📊 New Debug Logs (Added)

After restarting your server, you'll now see:

```
[AUTH] Checking access: documentId=99ab0a61-..., requestUserId=1, documentExists=true, documentOwnerId=2
[AUTH] Document 99ab0a61-... exists but belongs to user 2, not 1
```

**This tells you exactly what's wrong!**

## 🎯 Common Scenarios

### Scenario 1: Testing with Multiple Users

**Problem:** Created document as user A, trying to access as user B

**Fix:** Either:
- Login as user A, OR
- Re-upload as user B

### Scenario 2: Seeded Test Data

**Problem:** Document created by seed script (user 999), accessing as user 1

**Fix:** Upload new document as user 1

### Scenario 3: Different Environment

**Problem:** Document in staging DB, accessing production DB

**Fix:** Check your DATABASE_URL environment variable

## ⚠️ Temporary Fix for Dev (Not for Production!)

If you just need to test and don't care about ownership:

```sql
-- UPDATE document to belong to you (dev only!)
UPDATE documents 
SET user_id = 1  -- Your current user ID
WHERE id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';
```

## ✅ Success Indicators

After fixing, you should see:

1. **No 404 error** ✅
2. **Download URL returned** ✅
3. **Log shows:** `[AUTH] Checking access: ... documentOwnerId=1` (matches requestUserId) ✅
4. **Audit log:** `DOCUMENT_ACCESSED` (not UNAUTHORIZED) ✅

## 🎓 Why This Happens

The API enforces **strict ownership**:

```typescript
// Authorization query
SELECT * FROM documents 
WHERE id = ? 
  AND user_id = ?  // ← Must match YOUR user ID!
```

**This is a SECURITY FEATURE!** 
- Users can only access their OWN documents
- Prevents data leaks between users
- HIPAA compliant (proper access control)

## 📚 Full Guide

For detailed debugging: See `DOCUMENT_DOWNLOAD_AUTH_DEBUG.md`

---

**TL;DR:** 
1. Restart server: `npm run start:dev`
2. Check logs to see document owner
3. Upload new document as current user
4. Use new document ID
5. Should work! ✅









