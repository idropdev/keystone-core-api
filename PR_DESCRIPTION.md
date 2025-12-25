# Fix: GCP Storage Signed URL Generation Requires Service Account Credentials

## 🐛 Problem

The document download endpoint (`GET /v1/documents/:documentId/download`) was failing with:
```
Cannot sign data without `client_email`
```

**Root Cause:** GCP Cloud Storage signed URLs require a service account with `client_email`. The Storage client was using Application Default Credentials (ADC) from `gcloud auth application-default login`, which are user credentials and don't have `client_email`.

## ✅ Solution

1. **Explicit Credential Initialization**
   - Storage adapter now uses explicit service account credentials when `GOOGLE_APPLICATION_CREDENTIALS` is set
   - Falls back to ADC with warning if not set

2. **Startup Validation**
   - Validates credentials on startup
   - Checks for service account key file existence and `client_email` field
   - Logs clear warnings/errors immediately

3. **Secure Error Handling**
   - API responses no longer expose internal configuration details
   - Detailed remediation steps only in server logs (security best practice)
   - Returns generic `503 Service Unavailable` to clients

4. **Developer Experience**
   - Added automated setup script (`SETUP_SERVICE_ACCOUNT.sh`)
   - Updated README with setup instructions
   - Updated `.gitignore` to exclude service account keys

## 📝 Changes

- `src/document-processing/infrastructure/storage/gcp-storage.adapter.ts`
  - Initialize Storage with explicit credentials if `GOOGLE_APPLICATION_CREDENTIALS` is set
  - Add startup credential validation
  - Improve error detection and handling

- `.gitignore`
  - Exclude `.secrets/` directory and service account key patterns

- `README.md`
  - Add GCP credentials setup section with automated and manual options

- `SETUP_SERVICE_ACCOUNT.sh` (new)
  - Automated script to create service account, grant permissions, and generate key

## 🔒 Security

- ✅ Service account keys excluded from git via `.gitignore`
- ✅ No internal configuration details exposed in API responses
- ✅ Detailed remediation steps only in server logs

## 🧪 Testing

1. Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable
2. Restart application
3. Check startup logs for credential validation
4. Test `GET /v1/documents/:documentId/download` endpoint

## 📚 Documentation

- Setup instructions added to README
- See `docs/gcp-authentication-setup.md` for complete guide
- See `VERIFY_GCP_CREDENTIALS.md` for troubleshooting

---

**Fixes:** Document download endpoint signed URL generation  
**Type:** Bug Fix  
**Breaking Change:** No (requires environment variable setup)

