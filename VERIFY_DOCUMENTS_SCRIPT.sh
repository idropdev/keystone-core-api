#!/bin/bash

# Document Verification & Testing Script
# Run this to diagnose and fix document access issues

set -e

# Configuration
BASE_URL="${API_BASE_URL:-http://localhost:3000/v1}"
TOKEN="${API_TOKEN:-}"
TEST_FILE="${TEST_FILE:-test.pdf}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "Document Verification & Testing Script"
echo "========================================"
echo ""

# Check if token is provided
if [ -z "$TOKEN" ]; then
    echo -e "${RED}ERROR: API_TOKEN not set${NC}"
    echo "Usage: API_TOKEN=your_token ./VERIFY_DOCUMENTS_SCRIPT.sh"
    echo "Or: export API_TOKEN=your_token"
    exit 1
fi

# Function to print section headers
print_section() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
}

# Function to print success
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Function to print error
print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 1. Check current user
print_section "1. Checking Current User"
USER_RESPONSE=$(curl -s $BASE_URL/auth/me \
  -H "Authorization: Bearer $TOKEN")

if echo "$USER_RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
    USER_ID=$(echo "$USER_RESPONSE" | jq -r '.id')
    USER_EMAIL=$(echo "$USER_RESPONSE" | jq -r '.email')
    print_success "Logged in as: $USER_EMAIL (ID: $USER_ID)"
else
    print_error "Failed to get user info. Check your token!"
    echo "$USER_RESPONSE"
    exit 1
fi

# 2. List existing documents
print_section "2. Listing Your Existing Documents"
DOCS_RESPONSE=$(curl -s "$BASE_URL/documents?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN")

DOC_COUNT=$(echo "$DOCS_RESPONSE" | jq -r '.data | length')
TOTAL_COUNT=$(echo "$DOCS_RESPONSE" | jq -r '.total')

echo "Found $TOTAL_COUNT document(s) total, showing first $DOC_COUNT:"
echo ""

if [ "$DOC_COUNT" -gt 0 ]; then
    echo "$DOCS_RESPONSE" | jq -r '.data[] | "  ID: \(.id)\n  File: \(.fileName)\n  Status: \(.status)\n  Created: \(.createdAt)\n  ---"'
    
    # Get first document ID for testing
    FIRST_DOC_ID=$(echo "$DOCS_RESPONSE" | jq -r '.data[0].id')
    print_success "You have existing documents!"
    echo "  First document ID: $FIRST_DOC_ID"
else
    print_warning "No existing documents found"
    FIRST_DOC_ID=""
fi

# 3. Check if the problematic document exists
print_section "3. Checking Problematic Document"
PROBLEM_DOC_ID="99ab0a61-a32d-445e-bc3b-b5b784218fae"
echo "Checking if document $PROBLEM_DOC_ID exists..."

PROBLEM_DOC=$(curl -s "$BASE_URL/documents/$PROBLEM_DOC_ID" \
  -H "Authorization: Bearer $TOKEN")

if echo "$PROBLEM_DOC" | jq -e '.statusCode' > /dev/null 2>&1; then
    STATUS_CODE=$(echo "$PROBLEM_DOC" | jq -r '.statusCode')
    if [ "$STATUS_CODE" = "404" ]; then
        print_error "Document $PROBLEM_DOC_ID does NOT exist!"
        echo "  This is why you're getting 404 errors."
    else
        print_error "Error accessing document: $STATUS_CODE"
        echo "$PROBLEM_DOC" | jq .
    fi
else
    print_success "Document exists!"
    echo "$PROBLEM_DOC" | jq '{id, fileName, status, userId}'
fi

# 4. Upload new test document
print_section "4. Uploading New Test Document"

if [ ! -f "$TEST_FILE" ]; then
    print_warning "Test file '$TEST_FILE' not found, creating dummy PDF..."
    # Create a minimal PDF for testing
    echo "%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
190
%%EOF" > "$TEST_FILE"
    print_success "Created test PDF: $TEST_FILE"
fi

UPLOAD_RESPONSE=$(curl -s -X POST $BASE_URL/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$TEST_FILE" \
  -F "documentType=lab_result")

if echo "$UPLOAD_RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
    NEW_DOC_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.id')
    NEW_DOC_STATUS=$(echo "$UPLOAD_RESPONSE" | jq -r '.status')
    print_success "Document uploaded successfully!"
    echo "  New Document ID: $NEW_DOC_ID"
    echo "  Status: $NEW_DOC_STATUS"
else
    print_error "Upload failed!"
    echo "$UPLOAD_RESPONSE" | jq .
    exit 1
fi

# 5. Wait for processing
print_section "5. Waiting for Document Processing"
echo "Waiting 5 seconds for processing to complete..."
sleep 5

# 6. Test download endpoint
print_section "6. Testing Download Endpoint"
echo "Trying to get download URL for: $NEW_DOC_ID"

DOWNLOAD_RESPONSE=$(curl -s -X GET "$BASE_URL/documents/$NEW_DOC_ID/download" \
  -H "Authorization: Bearer $TOKEN")

if echo "$DOWNLOAD_RESPONSE" | jq -e '.downloadUrl' > /dev/null 2>&1; then
    DOWNLOAD_URL=$(echo "$DOWNLOAD_RESPONSE" | jq -r '.downloadUrl')
    print_success "Download URL generated successfully!"
    echo "  URL: ${DOWNLOAD_URL:0:80}..."
    echo "  Expires in: $(echo "$DOWNLOAD_RESPONSE" | jq -r '.expiresIn') seconds"
else
    print_error "Failed to get download URL!"
    echo "$DOWNLOAD_RESPONSE" | jq .
fi

# 7. Test get document endpoint
print_section "7. Testing Get Document Endpoint"
echo "Getting document details for: $NEW_DOC_ID"

DOC_DETAILS=$(curl -s "$BASE_URL/documents/$NEW_DOC_ID" \
  -H "Authorization: Bearer $TOKEN")

if echo "$DOC_DETAILS" | jq -e '.id' > /dev/null 2>&1; then
    print_success "Document details retrieved successfully!"
    echo "$DOC_DETAILS" | jq '{id, fileName, status, processingMethod, confidence}'
else
    print_error "Failed to get document details!"
    echo "$DOC_DETAILS" | jq .
fi

# 8. Test get fields endpoint
print_section "8. Testing Get Fields Endpoint"
echo "Getting extracted fields for: $NEW_DOC_ID"

FIELDS_RESPONSE=$(curl -s "$BASE_URL/documents/$NEW_DOC_ID/fields" \
  -H "Authorization: Bearer $TOKEN")

if echo "$FIELDS_RESPONSE" | jq -e '.data' > /dev/null 2>&1; then
    FIELD_COUNT=$(echo "$FIELDS_RESPONSE" | jq -r '.data | length')
    print_success "Fields retrieved successfully!"
    echo "  Field count: $FIELD_COUNT"
    if [ "$FIELD_COUNT" -gt 0 ]; then
        echo "  Sample fields:"
        echo "$FIELDS_RESPONSE" | jq -r '.data[0:3][] | "    - \(.fieldKey): \(.fieldValue) (confidence: \(.confidence))"'
    fi
else
    print_warning "Failed to get fields or no fields extracted"
    echo "$FIELDS_RESPONSE" | jq .
fi

# 9. Test delete endpoint
print_section "9. Testing Delete Endpoint"
echo "Attempting to delete document: $NEW_DOC_ID"

DELETE_RESPONSE=$(curl -s -X DELETE "$BASE_URL/documents/$NEW_DOC_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP_STATUS:%{http_code}")

HTTP_STATUS=$(echo "$DELETE_RESPONSE" | grep "HTTP_STATUS:" | cut -d':' -f2)

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "204" ]; then
    print_success "Document deleted successfully!"
else
    print_error "Delete failed with status: $HTTP_STATUS"
    echo "$DELETE_RESPONSE" | grep -v "HTTP_STATUS:"
fi

# 10. Summary
print_section "SUMMARY & RECOMMENDATIONS"
echo ""

if [ "$DOC_COUNT" -gt 0 ]; then
    print_success "You have $TOTAL_COUNT existing document(s)"
    echo "  Use these document IDs for testing:"
    echo "$DOCS_RESPONSE" | jq -r '.data[0:3][] | "    - \(.id)"'
else
    print_warning "No existing documents found"
    echo "  Upload documents to test with"
fi

echo ""
print_success "New document created for testing: $NEW_DOC_ID"
echo "  Use this ID for your API calls"

echo ""
echo "Working endpoint examples:"
echo "  GET    $BASE_URL/documents"
echo "  POST   $BASE_URL/documents/upload"
echo "  GET    $BASE_URL/documents/$NEW_DOC_ID"
echo "  GET    $BASE_URL/documents/$NEW_DOC_ID/download"
echo "  GET    $BASE_URL/documents/$NEW_DOC_ID/fields"
echo "  DELETE $BASE_URL/documents/$NEW_DOC_ID"

echo ""
print_error "DO NOT USE: 99ab0a61-a32d-445e-bc3b-b5b784218fae"
echo "  This document ID does NOT exist in your database!"

echo ""
echo "========================================"
echo "Test Complete!"
echo "========================================"









