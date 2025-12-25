# Update .env for GCP Credentials

## Quick Update

Add this line to your `.env` file:

```bash
# GCP Service Account Credentials (for document processing signed URLs)
GOOGLE_APPLICATION_CREDENTIALS=.secrets/keystone-sa-key.json
```

## Using Absolute Path (More Reliable)

If relative paths don't work, use the absolute path:

```bash
# Get the absolute path
cd /Users/joelmartinez/Documents/dropdev/keystone-core-api
pwd
# Output: /Users/joelmartinez/Documents/dropdev/keystone-core-api

# Add to .env
GOOGLE_APPLICATION_CREDENTIALS=/Users/joelmartinez/Documents/dropdev/keystone-core-api/.secrets/keystone-sa-key.json
```

## Verify Setup

After updating `.env`, restart your NestJS app and check startup logs:

**✅ Success:**
```
✅ Service account credentials validated: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
```

**❌ Still failing:**
```
❌ Service account key file not found: .secrets/keystone-sa-key.json
```

If you see the error, try:
1. Use absolute path instead of relative
2. Verify file exists: `ls -la .secrets/keystone-sa-key.json`
3. Check file permissions: should be `-rw-------` (600)

## File Locations

- **Project copy:** `.secrets/keystone-sa-key.json` (used by app)
- **Home backup:** `~/keystone-sa-key.json` (backup copy)

Both files are identical and excluded from git via `.gitignore`.

