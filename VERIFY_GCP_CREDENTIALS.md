# Verify GCP Credentials Setup

## Quick Check

Run these commands to verify your setup:

```bash
# 1. Check if environment variable is set
echo $GOOGLE_APPLICATION_CREDENTIALS

# 2. Check if the file exists
ls -la ~/keystone-sa-key.json

# 3. Verify the file contains client_email
cat ~/keystone-sa-key.json | grep client_email

# 4. Check what your NestJS app sees (if running)
# Look at startup logs for: "✅ Service account credentials validated"
```

## Common Issues

### Issue 1: Environment Variable Not Set

**Symptom:** App still uses ADC (Application Default Credentials)

**Fix:**
```bash
# Option A: Export in current shell
export GOOGLE_APPLICATION_CREDENTIALS=~/keystone-sa-key.json

# Option B: Add to .env file (recommended)
echo "GOOGLE_APPLICATION_CREDENTIALS=~/keystone-sa-key.json" >> .env

# Option C: Use absolute path (more reliable)
export GOOGLE_APPLICATION_CREDENTIALS=/Users/joelmartinez/keystone-sa-key.json
```

**Important:** After setting, **restart your NestJS application**!

### Issue 2: File Path Issues

**Symptom:** "Service account key file not found"

**Fix:**
```bash
# Use absolute path instead of ~
export GOOGLE_APPLICATION_CREDENTIALS=/Users/joelmartinez/keystone-sa-key.json

# Or verify the path
ls -la $GOOGLE_APPLICATION_CREDENTIALS
```

### Issue 3: App Not Picking Up .env File

**Symptom:** Variable set in .env but app doesn't see it

**Fix:**
- Make sure `.env` file is in the project root (same directory as `package.json`)
- Check that `dotenv` is loaded in your app (should be in `main.ts` or `app.module.ts`)
- Restart the app after adding to .env

### Issue 4: Wrong Credentials Type

**Symptom:** "missing 'client_email' field"

**Fix:**
- Make sure you're using a **service account key**, not user credentials
- Service account keys have `"type": "service_account"` and `"client_email"` fields
- User credentials from `gcloud auth application-default login` won't work

## Testing

After setting up, restart your app and check startup logs:

**✅ Success:**
```
✅ Service account credentials validated: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
```

**❌ Still failing:**
```
⚠️  GOOGLE_APPLICATION_CREDENTIALS not set. Signed URL generation will fail.
```

## Next Steps

1. Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable
2. Restart your NestJS application
3. Check startup logs for validation message
4. Test the download endpoint again

