#!/bin/bash
# Setup script for GCP Service Account for Keystone Document Processing
# This service account is required for generating signed URLs for document downloads

set -e  # Exit on error

PROJECT_ID="anythingllm-dropdev-hybrid-v1"
SERVICE_ACCOUNT_NAME="keystone-doc-processing"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_FILE_HOME="${HOME}/keystone-sa-key.json"
KEY_FILE_PROJECT=".secrets/keystone-sa-key.json"

echo "🔧 Setting up GCP Service Account for Keystone Document Processing"
echo "Project ID: ${PROJECT_ID}"
echo "Service Account: ${SERVICE_ACCOUNT_EMAIL}"
echo ""

# Step 1: Create service account (if it doesn't exist)
echo "📝 Step 1: Creating service account..."
if gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" --project="${PROJECT_ID}" &>/dev/null; then
  echo "✅ Service account already exists: ${SERVICE_ACCOUNT_EMAIL}"
else
  echo "Creating new service account..."
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" \
    --display-name="Keystone Document Processing" \
    --description="Service account for document storage and OCR" \
    --project="${PROJECT_ID}"
  echo "✅ Service account created: ${SERVICE_ACCOUNT_EMAIL}"
fi
echo ""

# Step 2: Grant required permissions
echo "🔐 Step 2: Granting required permissions..."

# Cloud Storage - read/write objects (required for upload/download)
echo "Granting storage.objectAdmin role..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  --condition=None

echo "✅ Permissions granted"
echo ""

# Step 3: Create and download key
echo "🔑 Step 3: Creating service account key..."
if [ -f "${KEY_FILE_HOME}" ]; then
  echo "⚠️  Key file already exists: ${KEY_FILE_HOME}"
  read -p "Do you want to overwrite it? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Skipping key creation. Using existing key file."
  else
    gcloud iam service-accounts keys create "${KEY_FILE_HOME}" \
      --iam-account="${SERVICE_ACCOUNT_EMAIL}" \
      --project="${PROJECT_ID}"
    echo "✅ Service account key created: ${KEY_FILE_HOME}"
  fi
else
  gcloud iam service-accounts keys create "${KEY_FILE_HOME}" \
    --iam-account="${SERVICE_ACCOUNT_EMAIL}" \
    --project="${PROJECT_ID}"
  echo "✅ Service account key created: ${KEY_FILE_HOME}"
fi
echo ""

# Step 4: Copy to project directory
echo "📁 Step 4: Copying key to project directory..."
mkdir -p .secrets
cp "${KEY_FILE_HOME}" "${KEY_FILE_PROJECT}"
chmod 600 "${KEY_FILE_PROJECT}"
echo "✅ Key copied to: ${KEY_FILE_PROJECT}"
echo ""

# Step 5: Verify key file
echo "🔍 Step 5: Verifying key file..."
if [ -f "${KEY_FILE_PROJECT}" ]; then
  CLIENT_EMAIL=$(cat "${KEY_FILE_PROJECT}" | grep -o '"client_email": "[^"]*"' | cut -d'"' -f4)
  if [ -n "${CLIENT_EMAIL}" ]; then
    echo "✅ Key file is valid"
    echo "   Client Email: ${CLIENT_EMAIL}"
  else
    echo "❌ Key file is invalid (missing client_email)"
    exit 1
  fi
else
  echo "❌ Key file not found: ${KEY_FILE_PROJECT}"
  exit 1
fi
echo ""

# Step 6: Set environment variable instructions
echo "📋 Step 6: Next steps"
echo ""
echo "The key file has been copied to the project directory:"
echo "  - Home: ${KEY_FILE_HOME}"
echo "  - Project: ${KEY_FILE_PROJECT}"
echo ""
echo "Add this to your .env file (using absolute path):"
ABSOLUTE_PATH=$(cd "$(dirname "${KEY_FILE_PROJECT}")" && pwd)/$(basename "${KEY_FILE_PROJECT}")
echo "GOOGLE_APPLICATION_CREDENTIALS=${ABSOLUTE_PATH}"
echo ""
echo "Or use relative path (if running from project root):"
echo "GOOGLE_APPLICATION_CREDENTIALS=${KEY_FILE_PROJECT}"
echo ""
echo "✅ Setup complete!"
echo ""
echo "⚠️  IMPORTANT:"
echo "   - Key files are in .gitignore and will NOT be committed"
echo "   - Keep these files secure and never commit them to git"
echo "   - Both copies are kept for convenience (home + project)"

