# GCP Deployment Guide - Keystone Core API

**Best Practice: Reliable & Cost-Effective Hosting on Google Cloud Platform**

---

## Executive Summary

**Recommended Solution: Google Cloud Run** ⭐

For the Keystone Core API (NestJS monolith, HIPAA-aligned), **Cloud Run** is the optimal choice because:

- ✅ **Most Cost-Effective**: Pay only for actual usage, scales to zero when idle
- ✅ **HIPAA-Eligible**: Automatically compliant with signed BAA
- ✅ **Simplest Deployment**: Single command deployment, no cluster management
- ✅ **Auto-Scaling**: Handles traffic spikes automatically (0 to 1000+ instances)
- ✅ **Built-in Security**: TLS 1.3, IAM integration, Cloud Logging
- ✅ **Production-Ready**: Same platform for MVP and production (no migration needed)

### Cost Comparison (Monthly Estimates)

| Option | Small Scale (1K users) | Medium Scale (10K users) | Large Scale (100K users) |
|--------|------------------------|--------------------------|--------------------------|
| **Cloud Run** ⭐ | **$56** | **$180** | **$1,200** |
| GKE (Kubernetes) | $333 | $500 | $2,000 |
| Compute Engine VMs | $173 | $400 | $1,500 |

**Winner: Cloud Run** - 3-6x cheaper than alternatives at all scales.

---

## Why Cloud Run is the Best Choice

### 1. Cost Efficiency

**Pay-Per-Use Model:**
- Only charged when handling requests
- Scales to zero during idle periods (no costs)
- No upfront costs or reserved capacity needed
- Free tier: 2M requests/month, 360K GiB-seconds compute

**Example Cost Breakdown (Small Scale - 50K requests/day):**
```
Cloud Run Compute:
  - CPU: 2 vCPU × 730 hours × $0.00002400/vCPU-second = $49/month
  - Memory: 2 GB × 730 hours × $0.00000250/GB-second = $5/month
  - Requests: 1.5M requests × $0.40/million = $0.60/month
  - Networking: 10 GB egress × $0.12/GB = $1.20/month
  Total: ~$56/month
```

**vs. GKE (Always-On):**
```
GKE Cluster:
  - Management fee: $73/month
  - Nodes (3 × n1-standard-2): $208/month
  - Persistent disks: $51/month
  Total: ~$333/month (6x more expensive)
```

### 2. HIPAA Compliance

**Automatic Compliance:**
- ✅ Runs in Google's HIPAA-eligible infrastructure
- ✅ Encryption at rest (AES-256) - automatic
- ✅ Encryption in transit (TLS 1.3) - automatic
- ✅ IAM integration for access control
- ✅ Cloud Logging for audit trails
- ✅ No PHI in logs (enforced by your code)

**Required Action:**
- Sign Business Associate Agreement (BAA) with Google Cloud
- [Request BAA here](https://cloud.google.com/terms/hipaa-baa)
- Typically takes 1-2 weeks to process

### 3. Operational Simplicity

**Deployment:**
```bash
# Single command deployment
gcloud run deploy keystone-core-api \
  --image gcr.io/PROJECT/keystone-core-api:latest \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 100
```

**vs. GKE (Complex):**
- Requires Kubernetes manifests (Deployment, Service, HPA, Ingress)
- Cluster management, node pools, networking
- Steeper learning curve

### 4. Auto-Scaling

**Cloud Run:**
- Scales from 0 to 1000+ instances automatically
- Handles traffic spikes instantly
- No configuration needed

**vs. VMs:**
- Manual scaling or Managed Instance Groups (more complex)
- Always-on costs even during low traffic

---

## Complete Deployment Guide

### Prerequisites

1. **Google Cloud Account**
   - Sign up at [cloud.google.com](https://cloud.google.com)
   - Free tier includes $300 credit (valid 90 days)
   - Enable billing (required for production)

2. **Install Tools**
   ```bash
   # Install gcloud CLI
   # macOS:
   brew install google-cloud-sdk
   
   # Linux:
   curl https://sdk.cloud.google.com | bash
   
   # Windows:
   # Download from https://cloud.google.com/sdk/docs/install
   
   # Verify installation
   gcloud --version
   ```

3. **Docker** (for building images)
   ```bash
   # macOS:
   brew install docker
   
   # Or use Docker Desktop: https://www.docker.com/products/docker-desktop
   ```

### Step 1: Initialize GCP Project

```bash
# Login to Google Cloud
gcloud auth login

# Create new project (or use existing)
gcloud projects create keystone-api-prod \
  --name="Keystone Core API Production"

# Set as active project
gcloud config set project keystone-api-prod

# Get project ID (save this)
PROJECT_ID=$(gcloud config get-value project)
echo "Project ID: $PROJECT_ID"

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com \
  documentai.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com
```

### Step 2: Set Up Database (Cloud SQL PostgreSQL)

```bash
# Create Cloud SQL instance (production tier)
gcloud sql instances create keystone-db \
  --database-version POSTGRES_15 \
  --tier db-custom-2-8192 \
  --region us-central1 \
  --network default \
  --no-assign-ip \
  --availability-type REGIONAL \
  --backup \
  --backup-start-time 02:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count 30 \
  --maintenance-window-day SUN \
  --maintenance-window-hour 3

# Create database
gcloud sql databases create keystone_prod \
  --instance keystone-db

# Create database user
gcloud sql users create keystone-api \
  --instance keystone-db \
  --password YOUR_STRONG_PASSWORD_HERE

# Get connection name (needed for Cloud Run)
CONNECTION_NAME=$(gcloud sql instances describe keystone-db \
  --format="value(connectionName)")
echo "Connection Name: $CONNECTION_NAME"
# Output: keystone-api-prod:us-central1:keystone-db
```

**Cost:** ~$150/month (db-custom-2-8192: 2 vCPU, 8 GB RAM)

**For MVP/Testing:** Use `db-f1-micro` instead (~$10/month):
```bash
gcloud sql instances create keystone-db-mvp \
  --database-version POSTGRES_15 \
  --tier db-f1-micro \
  --region us-central1
```

### Step 3: Set Up Cloud Storage (Document Storage)

```bash
# Create bucket for documents
gsutil mb -c STANDARD -l us-central1 \
  -b on gs://keystone-documents-prod

# Enable uniform bucket-level access (security)
gsutil uniformbucketlevelaccess set on \
  gs://keystone-documents-prod

# Set lifecycle policy (delete after 8 years for HIPAA)
cat > lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 2920,
          "matchesPrefix": ["raw/", "processed/"]
        }
      }
    ]
  }
}
EOF
gsutil lifecycle set lifecycle.json \
  gs://keystone-documents-prod

# Create service account for Cloud Run
gcloud iam service-accounts create keystone-api \
  --display-name="Keystone Core API Service Account"

# Grant storage permissions
gsutil iam ch \
  serviceAccount:keystone-api@${PROJECT_ID}.iam.gserviceaccount.com:objectCreator,objectViewer \
  gs://keystone-documents-prod
```

**Cost:** ~$0.023/GB/month storage + $0.12/GB egress
- 100 GB storage: ~$2.30/month
- 10 GB egress: ~$1.20/month
- **Total: ~$3.50/month**

### Step 4: Set Up Secret Manager (HIPAA Requirement)

```bash
# Create secrets (replace with your actual secrets)
echo -n "YOUR_STRONG_JWT_SECRET_32_CHARS_MIN" | \
  gcloud secrets create auth-jwt-secret --data-file=-

echo -n "YOUR_STRONG_REFRESH_SECRET_32_CHARS_MIN" | \
  gcloud secrets create auth-refresh-secret --data-file=-

echo -n "YOUR_DATABASE_PASSWORD" | \
  gcloud secrets create database-password --data-file=-

echo -n "YOUR_GOOGLE_CLIENT_SECRET" | \
  gcloud secrets create google-oauth-secret --data-file=-

# Grant Cloud Run service account access
gcloud secrets add-iam-policy-binding auth-jwt-secret \
  --member="serviceAccount:keystone-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding auth-refresh-secret \
  --member="serviceAccount:keystone-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding database-password \
  --member="serviceAccount:keystone-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding google-oauth-secret \
  --member="serviceAccount:keystone-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Cost:** $0.06/secret/month + $0.03 per 10,000 accesses
- 4 secrets: ~$0.24/month
- 1M accesses/month: ~$3/month
- **Total: ~$3.24/month**

### Step 5: Build and Push Docker Image

```bash
# Navigate to project root
cd /path/to/keystone-core-api

# Build Docker image
docker build -t gcr.io/${PROJECT_ID}/keystone-core-api:latest .

# Configure Docker authentication
gcloud auth configure-docker

# Push to Google Container Registry
docker push gcr.io/${PROJECT_ID}/keystone-core-api:latest
```

**Alternative: Use Cloud Build (Automated)**
```bash
# Submit build to Cloud Build
gcloud builds submit --tag gcr.io/${PROJECT_ID}/keystone-core-api:latest
```

### Step 6: Deploy to Cloud Run

```bash
# Deploy service
gcloud run deploy keystone-core-api \
  --image gcr.io/${PROJECT_ID}/keystone-core-api:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 100 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 80 \
  --service-account keystone-api@${PROJECT_ID}.iam.gserviceaccount.com \
  --add-cloudsql-instances ${CONNECTION_NAME} \
  --set-env-vars \
    NODE_ENV=production,\
    APP_PORT=8080,\
    APP_NAME="Keystone Core API",\
    API_PREFIX=api,\
    DATABASE_TYPE=postgres,\
    DATABASE_HOST=/cloudsql/${CONNECTION_NAME},\
    DATABASE_PORT=5432,\
    DATABASE_USERNAME=keystone-api,\
    DATABASE_NAME=keystone_prod,\
    DATABASE_SSL_ENABLED=true,\
    DATABASE_MAX_CONNECTIONS=100,\
    DATABASE_SYNCHRONIZE=false,\
    FRONTEND_DOMAIN=https://app.healthatlas.com,\
    BACKEND_DOMAIN=https://api.healthatlas.com,\
    GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID,\
    APPLE_APP_AUDIENCE=["com.healthatlas.app"] \
  --set-secrets \
    AUTH_JWT_SECRET=auth-jwt-secret:latest,\
    AUTH_REFRESH_SECRET=auth-refresh-secret:latest,\
    DATABASE_PASSWORD=database-password:latest,\
    GOOGLE_CLIENT_SECRET=google-oauth-secret:latest

# Get service URL
SERVICE_URL=$(gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format="value(status.url)")
echo "Service URL: $SERVICE_URL"
```

### Step 7: Run Database Migrations

```bash
# Create Cloud Run job for migrations
gcloud run jobs create keystone-migrations \
  --image gcr.io/${PROJECT_ID}/keystone-core-api:latest \
  --region us-central1 \
  --service-account keystone-api@${PROJECT_ID}.iam.gserviceaccount.com \
  --add-cloudsql-instances ${CONNECTION_NAME} \
  --set-env-vars \
    NODE_ENV=production,\
    DATABASE_HOST=/cloudsql/${CONNECTION_NAME},\
    DATABASE_USERNAME=keystone-api,\
    DATABASE_NAME=keystone_prod,\
    DATABASE_SSL_ENABLED=true \
  --set-secrets DATABASE_PASSWORD=database-password:latest \
  --command npm -- args run migration:run

# Execute migration job
gcloud run jobs execute keystone-migrations \
  --region us-central1 \
  --wait
```

### Step 8: Verify Deployment

```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format="value(status.url)")

# Test health endpoint
curl ${SERVICE_URL}/api/health

# Expected response:
# {"status":"ok","database":"connected","timestamp":"2025-01-XX..."}

# Test Swagger docs
curl ${SERVICE_URL}/docs

# View logs
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=keystone-core-api" \
  --limit 50 \
  --format json
```

---

## Cost Optimization Strategies

### 1. Use Free Tier Credits

**GCP Free Tier (Always Free):**
- Cloud Run: 2M requests/month, 360K GiB-seconds compute
- Cloud SQL: db-f1-micro (shared-core) - limited hours
- Cloud Storage: 5 GB storage, 1 GB egress/month
- Cloud Logging: 50 GB logs/month

**New Customer Credits:**
- $300 credit valid for 90 days
- Use for initial testing and MVP deployment

### 2. Scale to Zero (During Off-Peak)

```bash
# Set minimum instances to 0 during off-peak hours
gcloud run services update keystone-core-api \
  --min-instances 0 \
  --region us-central1

# Savings: ~$30-50/month (if acceptable cold start latency)
```

**Trade-off:** First request after idle takes 1-3 seconds (cold start)

### 3. Right-Size Resources

**Start Small, Scale Up:**
```bash
# MVP/Testing: 1 vCPU, 1 GB memory
gcloud run services update keystone-core-api \
  --cpu 1 \
  --memory 1Gi \
  --region us-central1

# Production: 2 vCPU, 2 GB memory (current)
# High Traffic: 4 vCPU, 4 GB memory (if needed)
```

**Cost Impact:**
- 1 vCPU, 1 GB: ~$28/month (50% savings)
- 2 vCPU, 2 GB: ~$56/month (current)
- 4 vCPU, 4 GB: ~$112/month

### 4. Optimize Database Tier

**Use Committed Use Discounts:**
```bash
# 1-year commitment: 25% discount
# 3-year commitment: 52% discount

# Purchase committed use discount
gcloud billing accounts list
gcloud compute commitments create keystone-db-commitment \
  --region us-central1 \
  --plan TWELVE_MONTH \
  --resources vcpu=2,memory=8192
```

**Savings:** 25-52% on database costs (~$37-78/month savings)

### 5. Cloud Storage Lifecycle Policies

**Move Old Documents to Nearline:**
```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {"age": 365, "matchesPrefix": ["raw/"]}
      }
    ]
  }
}
```

**Savings:** 50% on storage for documents older than 1 year

### 6. Monitor and Set Budget Alerts

```bash
# Create budget alert
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="Keystone API Budget" \
  --budget-amount=500USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90 \
  --threshold-rule=percent=100
```

---

## Monthly Cost Estimates

### Scenario 1: MVP / Small Scale (1,000 users, 50K requests/day)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **Cloud Run** | Min: 1, Max: 10, 2 vCPU, 2 GB | $56 |
| **Cloud SQL** | db-custom-2-8192 (2 vCPU, 8 GB) | $150 |
| **Cloud Storage** | 100 GB storage, 10 GB egress | $3.50 |
| **Secret Manager** | 4 secrets, 1M accesses | $3.24 |
| **Cloud Logging** | 10 GB logs/month | $5 |
| **Document AI** | 500 pages/month | $15 |
| **Total** | | **~$243/month** |

**With Free Tier Credits (First 3 months):** ~$0-50/month

### Scenario 2: Medium Scale (10,000 users, 500K requests/day)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **Cloud Run** | Min: 2, Max: 50, 2 vCPU, 2 GB | $180 |
| **Cloud SQL** | db-custom-4-16384 (4 vCPU, 16 GB) | $300 |
| **Cloud Storage** | 1 TB storage, 100 GB egress | $35 |
| **Secret Manager** | 4 secrets, 10M accesses | $30 |
| **Cloud Logging** | 50 GB logs/month | $25 |
| **Document AI** | 5,000 pages/month | $150 |
| **Total** | | **~$720/month** |

### Scenario 3: Large Scale (100,000 users, 5M requests/day)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **Cloud Run** | Min: 10, Max: 100, 4 vCPU, 4 GB | $1,200 |
| **Cloud SQL** | db-custom-16-65536 (16 vCPU, 64 GB) | $1,500 |
| **Cloud Storage** | 10 TB storage, 1 TB egress | $350 |
| **Secret Manager** | 4 secrets, 100M accesses | $300 |
| **Cloud Logging** | 200 GB logs/month | $100 |
| **Document AI** | 50,000 pages/month | $1,500 |
| **Memorystore (Redis)** | 5 GB, High Availability | $150 |
| **Total** | | **~$5,100/month** |

---

## HIPAA Compliance Checklist

### Required Before Production

- [ ] **Sign BAA with Google Cloud**
  - [Request BAA](https://cloud.google.com/terms/hipaa-baa)
  - Processing time: 1-2 weeks
  - Store executed BAA with compliance documentation

- [ ] **Enable Encryption**
  - ✅ Cloud SQL: Automatic (AES-256)
  - ✅ Cloud Storage: Automatic (AES-256)
  - ✅ Cloud Run: TLS 1.3 (automatic)

- [ ] **Configure Secret Manager**
  - ✅ All secrets in Secret Manager (not env vars)
  - ✅ IAM roles with least privilege
  - ✅ Secret rotation policy (90 days)

- [ ] **Set Up Audit Logging**
  - ✅ Cloud Logging enabled
  - ✅ 7-year retention policy
  - ✅ Log sink to Cloud Storage

- [ ] **Access Controls**
  - ✅ IAM roles configured
  - ✅ MFA enforced for GCP console
  - ✅ Service account with least privilege

- [ ] **Backup & Recovery**
  - ✅ Daily database backups
  - ✅ 30-day retention
  - ✅ Point-in-time recovery enabled

---

## CI/CD Pipeline (GitHub Actions)

Create `.github/workflows/deploy-production.yml`:

```yaml
name: Deploy to Production (Cloud Run)

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  GCP_PROJECT_ID: keystone-api-prod
  GCP_REGION: us-central1
  SERVICE_NAME: keystone-core-api

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v1
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
      
      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v1
      
      - name: Build and Push Docker Image
        run: |
          gcloud builds submit --tag gcr.io/${{ env.GCP_PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }}
          gcloud builds submit --tag gcr.io/${{ env.GCP_PROJECT_ID }}/${{ env.SERVICE_NAME }}:latest
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image gcr.io/${{ env.GCP_PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }} \
            --region ${{ env.GCP_REGION }} \
            --platform managed \
            --allow-unauthenticated
```

---

## Monitoring & Alerts

### Set Up Cloud Monitoring

```bash
# Create uptime check
gcloud monitoring uptime-checks create keystone-api-health \
  --http-check-path=/api/health \
  --resource-name=$SERVICE_URL \
  --display-name="Keystone API Health Check"

# Create alert policy (high error rate)
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High Error Rate" \
  --condition-display-name="Error rate > 5%" \
  --condition-threshold-value=0.05 \
  --condition-threshold-duration=300s \
  --condition-filter='
    resource.type="cloud_run_revision"
    AND resource.labels.service_name="keystone-core-api"
    AND metric.type="run.googleapis.com/request_count"
    AND metric.labels.response_code_class="5xx"
  '
```

---

## Troubleshooting

### Issue: Service returns 502 Bad Gateway

**Causes:**
1. Application crashed on startup
2. Wrong `APP_PORT` (should be 8080 or use `PORT` env var)
3. Database connection timeout

**Fix:**
```bash
# Check logs
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=keystone-core-api" \
  --limit 50

# Verify environment variables
gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)"
```

### Issue: Database connection fails

**Fix:**
```bash
# Verify Cloud SQL connection name
gcloud sql instances describe keystone-db \
  --format="value(connectionName)"

# Verify Cloud Run has correct connection
gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)"

# DATABASE_HOST should be: /cloudsql/PROJECT:REGION:INSTANCE
```

### Issue: Cold starts too slow

**Fix:**
```bash
# Set minimum instances to 1 (prevents cold starts)
gcloud run services update keystone-core-api \
  --min-instances 1 \
  --region us-central1

# Cost impact: +$49/month (2 vCPU × 730 hours)
```

---

## Next Steps

1. **Deploy MVP** using steps above
2. **Sign HIPAA BAA** with Google Cloud
3. **Set up monitoring** and alerts
4. **Configure custom domain** (api.healthatlas.com)
5. **Set up CI/CD** pipeline
6. **Load test** before production launch
7. **Review costs** monthly and optimize

---

## Additional Resources

- **Full Production Guide:** [hosting-deployment.md](./hosting-deployment.md)
- **MVP Quick Start:** [mvp-hosting-guide.md](./mvp-hosting-guide.md)
- **HIPAA Authentication:** [hipaa-authentication.md](./hipaa-authentication.md)
- **GCP Cloud Run Docs:** https://cloud.google.com/run/docs
- **GCP Pricing Calculator:** https://cloud.google.com/products/calculator

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Author:** HealthAtlas Engineering Team














