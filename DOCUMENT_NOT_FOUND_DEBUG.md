# Document Not Found - Investigation Guide

## ❌ The Real Issue

```
[AUTH] Document 99ab0a61-a32d-445e-bc3b-b5b784218fae does not exist in database
documentExists=false
```

**The document ID you're using is NOT in the database!**

## 🔍 Possible Causes

### 1. Wrong Document ID
- You're using an old/incorrect ID
- ID was copied incorrectly
- Using ID from different environment (staging vs local)

### 2. Document Never Created
- Upload failed but returned an ID
- Database transaction rolled back
- Error during creation

### 3. Document Was Deleted
- Soft deleted (deletedAt is set)
- Hard deleted (removed from DB)
- Cleanup job ran

### 4. Wrong Database
- Connected to wrong database
- Different environment
- Local vs staging vs production

## 🚀 Diagnostic Steps

### Step 1: List Your Actual Documents

```bash
# Get ALL your documents
curl -X GET "http://localhost:3000/v1/documents?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq '.data[] | {id, fileName, status}'
```

**Expected Output:**
```json
[
  {
    "id": "abc-123-real-id",
    "fileName": "test.pdf",
    "status": "PROCESSED"
  },
  {
    "id": "def-456-another-id",
    "fileName": "document.pdf",
    "status": "UPLOADED"
  }
]
```

### Step 2: Check Database Directly

```sql
-- Check if document exists at all (including deleted)
SELECT 
  id, 
  user_id, 
  file_name, 
  status,
  created_at,
  deleted_at
FROM documents 
WHERE id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';

-- If no results: Document never existed or was hard-deleted
-- If has deleted_at: Document was soft-deleted
-- If no deleted_at: Different database or wrong ID
```

### Step 3: Check Recent Documents

```sql
-- See your recent documents
SELECT 
  id, 
  user_id,
  file_name, 
  status,
  created_at
FROM documents 
WHERE user_id = 1  -- Your user ID
ORDER BY created_at DESC
LIMIT 10;
```

### Step 4: Upload New Document & Track It

```bash
#!/bin/bash
# Save as: test-upload.sh

TOKEN="YOUR_TOKEN"

echo "=== Uploading Document ==="

# Upload and capture response
RESPONSE=$(curl -s -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result")

echo "Upload response:"
echo $RESPONSE | jq .

# Extract document ID
DOC_ID=$(echo $RESPONSE | jq -r '.id')
echo -e "\n=== Document ID: $DOC_ID ==="

# Wait for processing
echo "Waiting 3 seconds for processing..."
sleep 3

# Check if it exists in DB
echo -e "\n=== Checking Database ==="
psql $DATABASE_URL -c "SELECT id, status, file_name FROM documents WHERE id = '$DOC_ID';"

# Try to get document
echo -e "\n=== Getting Document ==="
curl -s http://localhost:3000/v1/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN" | jq .

# Try to download
echo -e "\n=== Getting Download URL ==="
curl -s http://localhost:3000/v1/documents/$DOC_ID/download \
  -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n=== Done ==="
```

### Step 5: Check Your Database Connection

```bash
# Verify which database you're connected to
echo "Database: $DATABASE_URL"

# Or check in .env
cat .env | grep DATABASE

# Connect and check documents table
psql $DATABASE_URL -c "SELECT COUNT(*) FROM documents;"
```

## 🎯 Quick Solutions

### Solution 1: Get a Valid Document ID

```bash
# 1. List your documents
curl -X GET "http://localhost:3000/v1/documents" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 2. Copy a REAL document ID from the response
# 3. Use that ID instead

# 4. Try download with real ID
curl -X GET "http://localhost:3000/v1/documents/REAL_ID/download" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Solution 2: Upload Fresh Document

```bash
# Upload new document right now
RESPONSE=$(curl -s -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result")

# Get the ID from response
DOC_ID=$(echo $RESPONSE | jq -r '.id')
echo "New document ID: $DOC_ID"

# Try download immediately
curl -X GET "http://localhost:3000/v1/documents/$DOC_ID/download" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Solution 3: Check Upload Logs

```bash
# Check if upload succeeded
tail -f logs/app.log | grep -E 'Document uploaded|DOCUMENT_UPLOADED'
```

## 📊 Database Investigation Queries

### Check Total Documents

```sql
-- How many documents exist?
SELECT 
  status,
  COUNT(*) as count
FROM documents
GROUP BY status;
```

### Find Documents by User

```sql
-- All documents for user 1
SELECT 
  id,
  file_name,
  status,
  created_at,
  deleted_at IS NOT NULL as is_deleted
FROM documents
WHERE user_id = 1
ORDER BY created_at DESC;
```

### Check for Specific ID Pattern

```sql
-- Check if similar IDs exist
SELECT id, file_name, status
FROM documents
WHERE id::text LIKE '99ab0a61%'
   OR id::text LIKE '%b5b784218fae';
```

### Check Deleted Documents

```sql
-- Was it soft-deleted?
SELECT 
  id,
  file_name,
  deleted_at,
  scheduled_deletion_at
FROM documents
WHERE id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';
```

## 🐛 Common Issues

### Issue 1: Using ID from Postman/Old Test

**Problem:** The ID `99ab0a61-a32d-445e-bc3b-b5b784218fae` looks like it might be from:
- An old test
- A different environment
- A deleted document
- Example documentation

**Fix:** Get a CURRENT, VALID ID:
```bash
# Upload NOW and use THAT ID
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result" | jq -r '.id'
```

### Issue 2: Database Was Reset

**Problem:** You seeded/reset the database and lost all documents

**Fix:** Upload new documents

### Issue 3: Wrong Environment Variable

**Problem:** Using production document ID on local database

**Check:**
```bash
echo $DATABASE_URL
# Should point to your LOCAL database, not production!
```

## 🧪 Full Test Workflow

```bash
#!/bin/bash
# Complete test from scratch

TOKEN="YOUR_TOKEN"
BASE_URL="http://localhost:3000/v1"

echo "=== 1. Check Current User ==="
USER=$(curl -s $BASE_URL/auth/me -H "Authorization: Bearer $TOKEN")
echo $USER | jq '{id, email}'
USER_ID=$(echo $USER | jq -r '.id')

echo -e "\n=== 2. List Existing Documents ==="
curl -s "$BASE_URL/documents?page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, fileName, status}'

echo -e "\n=== 3. Upload New Document ==="
UPLOAD=$(curl -s -X POST $BASE_URL/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result")
echo $UPLOAD | jq .

DOC_ID=$(echo $UPLOAD | jq -r '.id')
echo "Document ID: $DOC_ID"

echo -e "\n=== 4. Wait for Processing ==="
sleep 5

echo -e "\n=== 5. Get Document ==="
curl -s $BASE_URL/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN" | jq '{id, status, fileName}'

echo -e "\n=== 6. Get Download URL ==="
curl -s $BASE_URL/documents/$DOC_ID/download \
  -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n=== 7. Delete Document ==="
curl -s -X DELETE $BASE_URL/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN"

echo -e "\n=== Done! ==="
```

## ✅ Verification Checklist

- [ ] Ran `GET /documents` - got list of real documents
- [ ] Uploaded new document - got valid ID back
- [ ] Checked database - document exists with correct user_id
- [ ] Used the NEW document ID for download
- [ ] Download endpoint worked
- [ ] Verified I'm connected to correct database
- [ ] No longer using old/invalid document ID

## 🎯 Most Likely Solution

**The ID you're using simply doesn't exist.** 

**Quick fix:**
```bash
# 1. Upload new document RIGHT NOW
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=lab_result"

# 2. Copy the "id" from the response
# 3. Use THAT id for download
# 4. Should work! ✅
```

## 📊 Expected vs Actual

### What You Expected
```
ID: 99ab0a61-a32d-445e-bc3b-b5b784218fae
↓
Database has this document
↓
Download works ✅
```

### What's Actually Happening
```
ID: 99ab0a61-a32d-445e-bc3b-b5b784218fae
↓
Database: "No such document" ❌
↓
404 Not Found
```

## 🎓 Key Takeaway

**Always use fresh document IDs from your own uploads!**

Don't reuse IDs from:
- ❌ Documentation examples
- ❌ Old tests
- ❌ Different environments
- ❌ Other users

Instead:
- ✅ Upload document
- ✅ Get ID from response
- ✅ Use that ID immediately
- ✅ Verify it works

---

**TL;DR:**
1. The document ID doesn't exist in your database
2. Upload a NEW document RIGHT NOW
3. Use the ID from that response
4. Everything will work ✅










