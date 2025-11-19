# GCP Authentication Setup Guide

## Overview

Keystone Core API uses Google Cloud Platform for document storage (Cloud Storage) and OCR (Document AI). This guide covers authentication for both local development and production.

---

## 🔐 Authentication Methods

### **Local Development: Application Default Credentials (ADC)**

**Recommended for:** Local development, testing, debugging

**How it works:**
- Uses your personal Google account
- No service account keys needed
- Simple one-time setup

**Setup:**

```bash
# Install gcloud CLI (if you haven't already)
# macOS:
brew install --cask google-cloud-sdk

# Authenticate
gcloud auth application-default login

# Set your project
gcloud config set project YOUR_PROJECT_ID

# Verify
gcloud auth application-default print-access-token
```

**Pros:**
- ✅ Quick setup
- ✅ No credential files to manage
- ✅ Works immediately with all GCP client libraries

**Cons:**
- ❌ Only works on your local machine
- ❌ Uses your personal account (not ideal for shared environments)

---

### **Production: Service Account with Secret Manager**

**Recommended for:** Production, staging, CI/CD

**How it works:**
- Uses a service account (robot account) with specific permissions
- Credentials stored in GCP Secret Manager (HIPAA compliant)
- Follows principle of least privilege

**Setup:**

#### 1. Create Service Account

```bash
PROJECT_ID="your-project-id"

# Create service account
gcloud iam service-accounts create keystone-doc-processing \
  --display-name="Keystone Document Processing" \
  --description="Service account for document storage and OCR"

SERVICE_ACCOUNT="keystone-doc-processing@${PROJECT_ID}.iam.gserviceaccount.com"
```

#### 2. Grant Minimal Required Permissions

```bash
# Cloud Storage - read/write objects
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/storage.objectAdmin" \
  --condition=None

# Document AI - use processors
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/documentai.apiUser"

# Optional: If using Secret Manager
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"
```

#### 3. Create and Download Key (Development/Staging Only)

```bash
# Create key
gcloud iam service-accounts keys create ~/keystone-sa-key.json \
  --iam-account=${SERVICE_ACCOUNT}

# Move to secure location
mkdir -p ~/gcp-keys
mv ~/keystone-sa-key.json ~/gcp-keys/
chmod 600 ~/gcp-keys/keystone-sa-key.json

echo "✅ Key saved to ~/gcp-keys/keystone-sa-key.json"
```

#### 4. Set Environment Variable

```bash
# In your .env file (DO NOT COMMIT THIS)
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/keystone-sa-key.json
```

**Pros:**
- ✅ Production-ready
- ✅ Least privilege (specific permissions only)
- ✅ Works in any environment
- ✅ Can be audited (who accessed what)

**Cons:**
- ❌ More setup required
- ❌ Key management responsibility

---

### **Cloud Run / GKE: Workload Identity (Production Best Practice)**

**Recommended for:** Production deployments on Cloud Run or GKE

**How it works:**
- No JSON keys needed at all
- Service account attached to the workload
- Automatic credential rotation
- Most secure option

**Setup for Cloud Run:**

```bash
# Deploy with service account attached
gcloud run deploy keystone-core-api \
  --image=gcr.io/${PROJECT_ID}/keystone-core-api \
  --service-account=${SERVICE_ACCOUNT} \
  --region=us-central1

# No GOOGLE_APPLICATION_CREDENTIALS needed!
# The GCP client libraries automatically detect and use the attached service account
```

**Setup for GKE:**

```bash
# Enable Workload Identity on cluster
gcloud container clusters update CLUSTER_NAME \
  --workload-pool=${PROJECT_ID}.svc.id.goog

# Bind Kubernetes service account to GCP service account
gcloud iam service-accounts add-iam-policy-binding ${SERVICE_ACCOUNT} \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:${PROJECT_ID}.svc.id.goog[NAMESPACE/KSA_NAME]"

# Annotate Kubernetes service account
kubectl annotate serviceaccount KSA_NAME \
  iam.gke.io/gcp-service-account=${SERVICE_ACCOUNT}
```

**Pros:**
- ✅ Most secure (no keys to leak)
- ✅ Automatic credential rotation
- ✅ HIPAA compliant
- ✅ No credential management needed

**Cons:**
- ❌ Only works on GCP compute (Cloud Run, GKE, GCE)

---

## 🎯 Which Method Should I Use?

| Environment | Recommended Method | Why |
|-------------|-------------------|-----|
| **Local Dev** | `gcloud auth application-default login` | Quick, simple, uses your account |
| **Staging** | Service Account + JSON Key | Isolated credentials, easy to test |
| **Production** | Workload Identity (Cloud Run/GKE) | Most secure, no keys to manage |
| **CI/CD** | Service Account + JSON Key in Secrets | Portable, works in GitHub Actions/GitLab CI |

---

## 🔍 How GCP Client Libraries Find Credentials

The `@google-cloud/storage` and `@google-cloud/documentai` libraries use **Application Default Credentials (ADC)**.

When you call `new Storage()` with no arguments, it searches for credentials in this order:

1. **GOOGLE_APPLICATION_CREDENTIALS** environment variable (path to JSON key)
2. **ADC from `gcloud auth application-default login`** (stored in `~/.config/gcloud/application_default_credentials.json`)
3. **Attached service account** (when running on Cloud Run, GKE, GCE, Cloud Functions)
4. **Error** if none found: `"Could not load the default credentials"`

---

## 🧪 Testing Your Setup

### Test 1: Verify ADC is Working

```bash
# Should print an access token
gcloud auth application-default print-access-token

# Should print your project ID
gcloud config get-value project
```

### Test 2: Test Storage Access

```bash
# List buckets (should not error)
gsutil ls

# Try to read from your document bucket
gsutil ls gs://your-storage-bucket/
```

### Test 3: Test from Node.js

Create a test script `test-gcp-auth.js`:

```javascript
const { Storage } = require('@google-cloud/storage');

async function testAuth() {
  try {
    const storage = new Storage();
    const [buckets] = await storage.getBuckets();
    console.log('✅ Authentication working!');
    console.log('Buckets:', buckets.map(b => b.name));
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
  }
}

testAuth();
```

Run it:

```bash
node test-gcp-auth.js
```

---

## 🚨 Security Best Practices

### ✅ DO:
- Use `gcloud auth application-default login` for local development
- Use Workload Identity for production on GCP
- Store service account keys in Secret Manager for CI/CD
- Rotate service account keys every 90 days
- Use least-privilege IAM roles
- Enable audit logging on all GCP resources

### ❌ DON'T:
- **NEVER** commit service account JSON keys to git
- **NEVER** put keys in Docker images
- **NEVER** use overly permissive roles (like `roles/owner` or `roles/editor`)
- **NEVER** share keys between environments (dev/staging/prod)
- **NEVER** log credentials or tokens

---

## 🆘 Troubleshooting

### Error: "Could not load the default credentials"

**Cause:** No credentials found by ADC

**Fix:**
```bash
# Option 1: Use your personal account
gcloud auth application-default login

# Option 2: Set service account key
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
```

### Error: "Permission denied"

**Cause:** Service account lacks required IAM roles

**Fix:**
```bash
# Grant Storage permissions
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Grant Document AI permissions
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/documentai.apiUser"
```

### Error: "Bucket does not exist"

**Cause:** Bucket name in config doesn't match actual bucket

**Fix:**
```bash
# List your buckets
gsutil ls

# Update .env with correct bucket name
DOC_PROCESSING_STORAGE_BUCKET=your-actual-bucket-name
```

---

## 📚 Additional Resources

- [GCP Authentication Guide](https://cloud.google.com/docs/authentication)
- [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)
- [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Service Account Best Practices](https://cloud.google.com/iam/docs/best-practices-service-accounts)
- [HIPAA on GCP](https://cloud.google.com/security/compliance/hipaa)

---

## ✅ Quick Reference

```bash
# Local dev setup (do this once)
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID

# Check if auth is working
gcloud auth application-default print-access-token

# Revoke ADC (if you want to switch accounts)
gcloud auth application-default revoke

# List service accounts
gcloud iam service-accounts list

# Create service account key
gcloud iam service-accounts keys create key.json \
  --iam-account=SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com

# Delete service account key (after rotation)
gcloud iam service-accounts keys delete KEY_ID \
  --iam-account=SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com
```

---

**Last Updated:** 2025-11-13

