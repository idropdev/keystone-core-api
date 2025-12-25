# Bug Fix: Document Download Signed URL Generation Failure

## 🐛 Bug Description

**Error:** `500 Internal Server Error` when calling `GET /v1/documents/:documentId/download`

**Root Cause:** 
```
Cannot sign data without `client_email`
```

**Console Error:**
```
[GcpStorageAdapter] Failed to generate signed URL: Cannot sign data without `client_email`.
[ExceptionsHandler] Error: Failed to generate download URL
```

---

## 🔍 Root Cause Analysis

### The Problem

GCP Cloud Storage signed URLs require a **service account** with a `client_email` field. The Storage client was initialized with `new Storage()` which uses Application Default Credentials (ADC) from `gcloud auth application-default login`. 

**ADC credentials are user credentials** and don't have a `client_email` field, so they cannot be used to generate signed URLs.

### Why This Happened

1. **Storage initialization** used `new Storage()` without explicit credentials
2. **ADC fallback** worked for regular operations (upload, download) but failed for signed URLs
3. **Error detection** didn't catch this specific case, leading to a generic 500 error

---

## ✅ Solution Implemented

### 1. **Explicit Credential Initialization**

Updated the Storage constructor to use explicit service account credentials when `GOOGLE_APPLICATION_CREDENTIALS` is set:

```typescript
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialsPath) {
  this.storage = new Storage({
    keyFilename: credentialsPath,
  });
} else {
  // Fallback to ADC with warning
  this.storage = new Storage();
  this.logger.warn(
    'GCP Storage initialized with ADC. Signed URLs require a service account key file.'
  );
}
```

### 2. **Startup Credential Validation**

Added validation on startup to catch credential issues early:

```typescript
private validateSignedUrlCredentials(): void {
  // Checks if GOOGLE_APPLICATION_CREDENTIALS is set
  // Validates file exists and contains client_email
  // Logs clear warnings/errors on startup
}
```

### 3. **Specific Error Detection**

Added detection for the `client_email` missing error with clear remediation:

```typescript
if (
  errorMessage.includes('Cannot sign data without') ||
  errorMessage.includes('client_email') ||
  errorMessage.includes('client_email is required')
) {
  // Provide detailed remediation steps
}
```

### 4. **Improved HTTP Error Responses**

Changed from generic `Error` (500) to `ServiceUnavailableException` (503) with structured response:

```typescript
throw new ServiceUnavailableException({
  message: authError.userMessage,
  error: 'Service Unavailable',
  statusCode: 503,
  details: {
    issue: 'GCP credentials not configured for signed URL generation',
    remediation: authError.remediation,
  },
});
```

**Response Format:**
```json
{
  "message": "Failed to generate download URL: Service account credentials required...",
  "error": "Service Unavailable",
  "statusCode": 503,
  "details": {
    "issue": "GCP credentials not configured for signed URL generation",
    "remediation": "Step-by-step instructions..."
  }
}
```

### 5. **Improved Error Messages**

Error messages now include:
- Clear explanation of the issue
- Step-by-step remediation instructions
- Different guidance for dev vs production environments
- Structured HTTP response with details

---

## 🔧 How to Fix Your Environment

### Option 1: Use Service Account Key (Recommended for Production)

```bash
# 1. Create service account (if needed)
gcloud iam service-accounts create keystone-doc-processing \
  --display-name="Keystone Document Processing"

# 2. Grant required permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:keystone-doc-processing@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# 3. Create and download key
gcloud iam service-accounts keys create ~/keystone-sa-key.json \
  --iam-account=keystone-doc-processing@YOUR_PROJECT_ID.iam.gserviceaccount.com

# 4. Set environment variable
export GOOGLE_APPLICATION_CREDENTIALS=~/keystone-sa-key.json

# 5. Restart your application
```

### Option 2: Use Application Default Credentials (Local Dev Only)

**Note:** This will NOT work for signed URLs. Use only for testing uploads/downloads.

```bash
# For local development (limited functionality)
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

**Limitation:** ADC cannot generate signed URLs. You'll still need a service account key for the download endpoint.

---

## 📋 Testing the Fix

### 1. Verify Service Account Key

```bash
# Check that the key file exists and is valid
cat $GOOGLE_APPLICATION_CREDENTIALS | jq '.client_email'

# Should output: "your-service-account@project.iam.gserviceaccount.com"
```

### 2. Test Upload (Should Work)

```bash
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "documentType=LAB_RESULT"
```

### 3. Test Download URL Generation (Should Now Work)

```bash
curl -X GET http://localhost:3000/v1/documents/DOCUMENT_ID/download \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "downloadUrl": "https://storage.googleapis.com/bucket/path/file.pdf?X-Goog-Algorithm=...",
  "expiresIn": 86400
}
```

---

## 🔒 Security Considerations

### HIPAA Compliance

- ✅ Service account keys should be stored securely (not in git)
- ✅ Use GCP Secret Manager in production
- ✅ Rotate keys regularly
- ✅ Use Workload Identity on Cloud Run/GKE (no keys needed)

### Best Practices

1. **Local Development:**
   - Use service account key file
   - Store in `~/.gcp-keys/` with `chmod 600`
   - Never commit to git

2. **Staging/Production:**
   - Use GCP Secret Manager
   - Or use Workload Identity (Cloud Run/GKE)
   - Never use ADC in production

---

## 📝 Files Changed

- `src/document-processing/infrastructure/storage/gcp-storage.adapter.ts`
  - Updated constructor to use explicit credentials
  - Added specific error detection for `client_email` missing
  - Improved error messages with remediation steps

---

## 🎯 Expected Behavior After Fix

### Before Fix:
- ❌ `GET /v1/documents/:id/download` → 500 Internal Server Error
- ❌ Generic error message
- ❌ No guidance on how to fix

### After Fix:
- ✅ `GET /v1/documents/:id/download` → 200 OK with signed URL
- ✅ Clear error messages if credentials are missing
- ✅ Step-by-step remediation instructions
- ✅ Warning logged if using ADC (which won't work for signed URLs)

---

## 🚀 Next Steps

1. **Set up service account key** (if not already done)
2. **Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable**
3. **Restart the application**
4. **Test the download endpoint**
5. **For production:** Migrate to GCP Secret Manager or Workload Identity

---

## 📚 Related Documentation

- `docs/gcp-authentication-setup.md` - Complete GCP authentication guide
- `BUG_DOCUMENT_DOWNLOAD_ENDPOINT_DESCRIPTION.md` - Endpoint specification
- `DOCUMENT_DOWNLOAD_AUTH_DEBUG.md` - Authorization debugging guide

---

**Branch:** `bug/document-download-link-issue`  
**Status:** ✅ Fixed  
**Date:** December 18, 2025

