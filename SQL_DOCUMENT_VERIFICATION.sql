-- =====================================================
-- Document Verification SQL Queries
-- Run these to diagnose document access issues
-- =====================================================

-- 1. Check if the problematic document exists
-- Expected: 0 rows (document doesn't exist)
SELECT 
  id, 
  user_id, 
  file_name, 
  status,
  processing_method,
  created_at,
  deleted_at,
  CASE 
    WHEN deleted_at IS NOT NULL THEN 'SOFT DELETED'
    ELSE 'ACTIVE'
  END as record_status
FROM documents 
WHERE id = '99ab0a61-a32d-445e-bc3b-b5b784218fae';

-- RESULT: If this returns 0 rows, the document DOES NOT EXIST!


-- =====================================================
-- 2. List ALL documents for user 1
-- Expected: Show your actual documents
SELECT 
  id, 
  user_id,
  file_name, 
  status,
  processing_method,
  confidence,
  created_at::date as uploaded_date,
  CASE 
    WHEN deleted_at IS NOT NULL THEN 'DELETED'
    ELSE 'ACTIVE'
  END as record_status
FROM documents 
WHERE user_id = 1  -- Replace with your user ID
ORDER BY created_at DESC
LIMIT 20;

-- RESULT: Use these document IDs for testing!


-- =====================================================
-- 3. Count documents by status
-- Shows distribution of your documents
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
FROM documents
WHERE user_id = 1  -- Replace with your user ID
GROUP BY status
ORDER BY count DESC;


-- =====================================================
-- 4. Find recent documents (last 24 hours)
-- See what was recently uploaded
SELECT 
  id,
  file_name,
  status,
  processing_method,
  created_at,
  processed_at,
  EXTRACT(EPOCH FROM (processed_at - processing_started_at)) as processing_seconds
FROM documents
WHERE user_id = 1  -- Replace with your user ID
  AND created_at > NOW() - INTERVAL '24 hours'
  AND deleted_at IS NULL
ORDER BY created_at DESC;


-- =====================================================
-- 5. Check for documents with similar UUID pattern
-- In case you have a typo in the UUID
SELECT 
  id,
  user_id,
  file_name,
  status
FROM documents
WHERE id::text LIKE '99ab0a61%'
   OR id::text LIKE '%a32d-445e%'
   OR id::text LIKE '%b5b784218fae';

-- RESULT: If this returns rows, you might have a typo


-- =====================================================
-- 6. Find all documents (any user) to verify database connection
-- Helps confirm you're connected to the right database
SELECT 
  COUNT(*) as total_documents,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_documents,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_documents,
  MIN(created_at) as oldest_document,
  MAX(created_at) as newest_document
FROM documents;


-- =====================================================
-- 7. Get a valid document ID to use for testing
-- Use this ID instead of the problematic one
SELECT 
  id as document_id_to_use,
  file_name,
  status,
  created_at
FROM documents
WHERE user_id = 1  -- Replace with your user ID
  AND deleted_at IS NULL
  AND status IN ('PROCESSED', 'STORED')
ORDER BY created_at DESC
LIMIT 1;

-- COPY THIS ID AND USE IT FOR YOUR API CALLS!


-- =====================================================
-- 8. Check extracted fields for a document
-- Replace the ID with a real document ID from query #7
SELECT 
  id,
  field_key,
  field_value,
  field_type,
  confidence,
  created_at
FROM extracted_fields
WHERE document_id = 'REPLACE_WITH_REAL_ID'
ORDER BY confidence DESC
LIMIT 10;


-- =====================================================
-- 9. Verify document ownership
-- Check if document belongs to you
SELECT 
  d.id as document_id,
  d.user_id as document_owner_id,
  u.email as owner_email,
  d.file_name,
  d.status,
  CASE 
    WHEN d.user_id = 1 THEN 'YOU OWN THIS'  -- Replace 1 with your user ID
    ELSE 'OWNED BY ANOTHER USER'
  END as ownership
FROM documents d
LEFT JOIN users u ON u.id = d.user_id
WHERE d.id = 'REPLACE_WITH_DOCUMENT_ID';


-- =====================================================
-- 10. Find documents that failed processing
-- Useful for debugging
SELECT 
  id,
  file_name,
  status,
  error_message,
  retry_count,
  created_at
FROM documents
WHERE user_id = 1  -- Replace with your user ID
  AND status = 'FAILED'
  AND deleted_at IS NULL
ORDER BY created_at DESC;


-- =====================================================
-- QUICK DIAGNOSTIC COMMANDS
-- =====================================================

-- Check your user ID
SELECT id, email, first_name, last_name 
FROM users 
WHERE email = 'your-email@example.com';  -- Replace with your email

-- Check database name (to verify you're in the right DB)
SELECT current_database();

-- Check table exists
SELECT COUNT(*) 
FROM information_schema.tables 
WHERE table_name = 'documents';

-- Check if you have any documents at all
SELECT EXISTS(
  SELECT 1 FROM documents WHERE user_id = 1  -- Replace with your user ID
);


-- =====================================================
-- EXAMPLE WORKFLOW
-- =====================================================

/*
1. Run query #1 to confirm document doesn't exist
   ✅ Expected: 0 rows

2. Run query #2 to get YOUR real document IDs
   ✅ Copy one of these IDs

3. Run query #7 to get a processed document ID
   ✅ Use this ID for testing download/delete

4. Test in your API client with the REAL ID
   ✅ Should work!

5. If still failing, run query #9 to check ownership
   ✅ Verify user_id matches your token
*/


-- =====================================================
-- TROUBLESHOOTING TIPS
-- =====================================================

/*
If query #1 returns 0 rows:
  → The document ID doesn't exist
  → Use a real ID from query #2 or #7

If query #2 returns 0 rows:
  → You have no documents
  → Upload a new document via API

If query #9 shows different user_id:
  → Document belongs to another user
  → Upload your own document

If all queries return 0 rows:
  → Wrong database connection
  → Check your DATABASE_URL environment variable
*/










