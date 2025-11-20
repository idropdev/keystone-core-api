# Keystone Core API - MVP Hosting Guide

**Quick Start Guide for Minimum Viable Product Deployment**

---

## Overview

This guide provides **practical, cost-effective hosting options** for deploying Keystone Core API during the MVP phase. While your production architecture targets GCP Cloud Run (see [hosting-deployment.md](./hosting-deployment.md)), MVP hosting focuses on:

- ✅ **Fast deployment** (< 1 hour setup)
- ✅ **Low cost** ($0-25/month)
- ✅ **Minimal configuration**
- ✅ **Easy to migrate** to production later

---

## Quick Decision Matrix

| Platform | Cost (MVP) | Setup Time | HIPAA Ready | Production Path |
|----------|-----------|------------|-------------|-----------------|
| **GCP Cloud Run** ⭐ | $5-15/mo | 30 min | ✅ Yes | ✅ Already production |
| **Render** | Free-$7/mo | 15 min | ⚠️ With BAA | 🔄 Migrate to GCP |
| **Railway** | Free-$5/mo | 10 min | ⚠️ With BAA | 🔄 Migrate to GCP |

**Recommendation:** Start with **GCP Cloud Run** (minimal cost difference, direct production path).

---

## Option 1: GCP Cloud Run (Recommended for MVP) ⭐

### Why Cloud Run for MVP?

- ✅ **Same platform as production** - No migration needed later
- ✅ **HIPAA-eligible** with signed BAA (required for healthcare)
- ✅ **Very cheap at MVP scale** ($5-15/month with free tier credits)
- ✅ **Docker-ready** - Your existing Dockerfile works immediately
- ✅ **Auto-scaling** - Handles traffic spikes automatically
- ✅ **Built-in HTTPS** - SSL certificates managed automatically

### Cost Breakdown (MVP Scale)

**Free Tier Benefits:**
- 2 million requests/month free
- 360,000 GiB-seconds compute free
- 200K egress GB free

**Typical MVP Usage (~1K users, 10K req/day):**
- Cloud Run: **$0-5/month** (covered by free tier)
- Cloud SQL (db-f1-micro): **~$10/month**
- Cloud Storage (10 GB): **$0.25/month**
- **Total: ~$10-15/month**

### Prerequisites

1. Google Cloud account ([Free tier $300 credit](https://cloud.google.com/free))
2. Docker installed locally (for building images)
3. `gcloud` CLI installed ([Install guide](https://cloud.google.com/sdk/docs/install))

### Step-by-Step Deployment

#### 1. Initialize GCP Project

```bash
# Install gcloud CLI (if not installed)
# macOS: brew install google-cloud-sdk
# Linux: curl https://sdk.cloud.google.com | bash

# Login to GCP
gcloud auth login

# Create project (or use existing)
gcloud projects create keystone-api-mvp --name="Keystone Core API MVP"
gcloud config set project keystone-api-mvp

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

#### 2. Set Up Database (Cloud SQL PostgreSQL)

```bash
# Create Cloud SQL instance (smallest tier for MVP)
gcloud sql instances create keystone-db-mvp \
  --database-version POSTGRES_15 \
  --tier db-f1-micro \
  --region us-central1 \
  --storage-type SSD \
  --storage-size 10GB \
  --backup \
  --no-assign-ip

# Create database
gcloud sql databases create keystone_mvp --instance keystone-db-mvp

# Create user
gcloud sql users create keystone-api \
  --instance keystone-db-mvp \
  --password YOUR_STRONG_PASSWORD_HERE

# Get connection name (needed for Cloud Run)
gcloud sql instances describe keystone-db-mvp --format="value(connectionName)"
# Output: keystone-api-mvp:us-central1:keystone-db-mvp
```

#### 3. Create Cloud Storage Bucket

```bash
# Create bucket for documents
gsutil mb -c STANDARD -l us-central1 gs://keystone-documents-mvp

# Set uniform bucket-level access (security)
gsutil uniformbucketlevelaccess set on gs://keystone-documents-mvp
```

#### 4. Build and Push Docker Image

```bash
# Build image
docker build -t gcr.io/keystone-api-mvp/keystone-core-api:latest .

# Configure Docker auth
gcloud auth configure-docker

# Push to Container Registry
docker push gcr.io/keystone-api-mvp/keystone-core-api:latest
```

#### 5. Deploy to Cloud Run

```bash
# Get connection name from step 2
CONNECTION_NAME="keystone-api-mvp:us-central1:keystone-db-mvp"

# Deploy service
gcloud run deploy keystone-core-api \
  --image gcr.io/keystone-api-mvp/keystone-core-api:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 10 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --concurrency 80 \
  --add-cloudsql-instances $CONNECTION_NAME \
  --set-env-vars \
    NODE_ENV=production,\
    APP_PORT=8080,\
    DATABASE_TYPE=postgres,\
    DATABASE_HOST=/cloudsql/$CONNECTION_NAME,\
    DATABASE_PORT=5432,\
    DATABASE_USERNAME=keystone-api,\
    DATABASE_PASSWORD=YOUR_PASSWORD_HERE,\
    DATABASE_NAME=keystone_mvp,\
    DATABASE_SSL_ENABLED=true,\
    DATABASE_MAX_CONNECTIONS=10,\
    API_PREFIX=api,\
    FRONTEND_DOMAIN=https://your-app-domain.com,\
    BACKEND_DOMAIN=https://your-api-domain.com

# Get service URL
gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format="value(status.url)"
# Output: https://keystone-core-api-xxxxx-uc.a.run.app
```

#### 6. Run Database Migrations

```bash
# Create Cloud Run job for migrations
gcloud run jobs create keystone-migrations \
  --image gcr.io/keystone-api-mvp/keystone-core-api:latest \
  --region us-central1 \
  --set-env-vars NODE_ENV=production,DATABASE_HOST=/cloudsql/$CONNECTION_NAME,DATABASE_PASSWORD=YOUR_PASSWORD,DATABASE_NAME=keystone_mvp \
  --add-cloudsql-instances $CONNECTION_NAME \
  --command npm -- args run migration:run

# Execute migration job
gcloud run jobs execute keystone-migrations --region us-central1 --wait
```

#### 7. Verify Deployment

```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format="value(status.url)")

# Test health endpoint
curl $SERVICE_URL/api/health

# Should return: {"status":"ok","database":"connected"}
```

### Environment Variables for MVP

Create a `.env.production` file with these values:

```env
NODE_ENV=production
APP_PORT=8080
APP_NAME="Keystone Core API"
API_PREFIX=api

# Database (Cloud SQL via Unix socket)
DATABASE_TYPE=postgres
DATABASE_HOST=/cloudsql/YOUR_PROJECT:us-central1:keystone-db-mvp
DATABASE_PORT=5432
DATABASE_USERNAME=keystone-api
DATABASE_PASSWORD=YOUR_STRONG_PASSWORD
DATABASE_NAME=keystone_mvp
DATABASE_SSL_ENABLED=true
DATABASE_MAX_CONNECTIONS=10
DATABASE_SYNCHRONIZE=false

# OAuth Providers (use test credentials for MVP)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret

APPLE_APP_AUDIENCE=["com.your.app"]

# Auth Secrets (generate strong random strings)
AUTH_JWT_SECRET=your-strong-jwt-secret-here-min-32-chars
AUTH_JWT_TOKEN_EXPIRES_IN=15m
AUTH_REFRESH_SECRET=your-strong-refresh-secret-here-min-32-chars
AUTH_REFRESH_TOKEN_EXPIRES_IN=3650d

# File Storage (Cloud Storage)
FILE_DRIVER=s3
AWS_S3_REGION=us-central1
AWS_DEFAULT_S3_BUCKET=keystone-documents-mvp
ACCESS_KEY_ID=your-gcs-access-key
SECRET_ACCESS_KEY=your-gcs-secret-key

# Frontend/Backend domains
FRONTEND_DOMAIN=https://your-app-domain.com
BACKEND_DOMAIN=https://your-api-domain.com
```

**⚠️ Security Note:** For production, migrate secrets to [GCP Secret Manager](https://cloud.google.com/secret-manager) instead of environment variables.

### Auto-Deployment with GitHub Actions

Create `.github/workflows/deploy-mvp.yml`:

```yaml
name: Deploy MVP to Cloud Run

on:
  push:
    branches: [main]

env:
  GCP_PROJECT_ID: keystone-api-mvp
  GCP_REGION: us-central1
  SERVICE_NAME: keystone-core-api

jobs:
  deploy:
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
      
      - name: Configure Docker
        run: gcloud auth configure-docker
      
      - name: Build and Push Docker Image
        run: |
          docker build -t gcr.io/${{ env.GCP_PROJECT_ID }}/${{ env.SERVICE_NAME }}:latest .
          docker push gcr.io/${{ env.GCP_PROJECT_ID }}/${{ env.SERVICE_NAME }}:latest
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image gcr.io/${{ env.GCP_PROJECT_ID }}/${{ env.SERVICE_NAME }}:latest \
            --region ${{ env.GCP_REGION }} \
            --platform managed \
            --allow-unauthenticated
```

---

## Option 2: Render (Alternative for Non-GCP Preference)

### Why Render?

- ✅ **Free tier** for small services
- ✅ **PostgreSQL included** (free tier: 90 days, then $7/mo)
- ✅ **GitHub auto-deploy** - Push to deploy
- ✅ **HTTPS included** - SSL certificates automatic
- ✅ **Easy database migrations** - Runs automatically

### Cost Breakdown

- Web Service: **Free** (sleeps after 15 min inactivity) or **$7/mo** (always-on)
- PostgreSQL: **Free** (90 days), then **$7/mo**
- **Total: $0-14/month**

### Deployment Steps

1. **Sign up at [render.com](https://render.com)** (GitHub OAuth)

2. **Create PostgreSQL Database:**
   - Dashboard → New → PostgreSQL
   - Name: `keystone-db-mvp`
   - Plan: Free (or Starter $7/mo)
   - Region: US East (Oregon)
   - Copy connection string

3. **Create Web Service:**
   - Dashboard → New → Web Service
   - Connect GitHub repo
   - Settings:
     - **Name:** `keystone-core-api`
     - **Environment:** `Docker`
     - **Dockerfile Path:** `Dockerfile`
     - **Build Command:** (leave empty, Render builds Dockerfile)
     - **Start Command:** `npm run start:prod`
     - **Plan:** Free (or Starter $7/mo)

4. **Set Environment Variables:**
   ```
   NODE_ENV=production
   APP_PORT=10000
   DATABASE_TYPE=postgres
   DATABASE_URL=<from PostgreSQL service connection string>
   DATABASE_SSL_ENABLED=true
   GOOGLE_CLIENT_ID=...
   AUTH_JWT_SECRET=...
   # ... (other env vars from env-example-relational)
   ```

5. **Deploy:**
   - Click "Create Web Service"
   - Render builds and deploys automatically
   - Service URL: `https://keystone-core-api.onrender.com`

**⚠️ Limitations:**
- Free tier services sleep after 15 min (first request after sleep takes ~30s)
- Database free tier expires after 90 days
- Not HIPAA-eligible (migrate to GCP before production with PHI)

---

## Option 3: Railway (Fastest Setup)

### Why Railway?

- ✅ **Free $5 credit/month** (sufficient for MVP)
- ✅ **Zero-config deployment** - Detects Dockerfile automatically
- ✅ **PostgreSQL one-click** - Database setup in 30 seconds
- ✅ **GitHub integration** - Auto-deploy on push

### Cost Breakdown

- Web Service: **Free** (covered by $5 credit)
- PostgreSQL: **Free** (covered by $5 credit)
- **Total: $0/month** (within credit limit)

### Deployment Steps

1. **Sign up at [railway.app](https://railway.app)** (GitHub OAuth)

2. **Create New Project:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Add PostgreSQL:**
   - Project → "+ New" → Database → PostgreSQL
   - Railway auto-creates database and connection string

4. **Configure Environment Variables:**
   - Project → Variables tab
   - Add variables (Railway auto-injects `DATABASE_URL` from PostgreSQL service):
   ```
   NODE_ENV=production
   PORT=8080
   DATABASE_TYPE=postgres
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   DATABASE_SSL_ENABLED=true
   GOOGLE_CLIENT_ID=...
   AUTH_JWT_SECRET=...
   # ... (other env vars)
   ```

5. **Deploy:**
   - Railway detects Dockerfile and builds automatically
   - Service URL: `https://keystone-core-api.up.railway.app`

**⚠️ Limitations:**
- $5 credit may run out with high traffic
- Not HIPAA-eligible (migrate to GCP before production with PHI)

---

## Comparison: MVP vs Production

| Aspect | MVP Hosting | Production Hosting |
|--------|------------|-------------------|
| **Platform** | Cloud Run / Render / Railway | GCP Cloud Run |
| **Cost** | $0-15/month | $250-5K/month |
| **Database** | db-f1-micro / Free tier | db-custom-2-8192+ (HA) |
| **Scaling** | 0-10 instances | 1-100+ instances |
| **HIPAA BAA** | ⚠️ Recommended | ✅ Required |
| **Secret Manager** | ⚠️ Env vars OK | ✅ GCP Secret Manager |
| **Backups** | Daily (basic) | Daily + Point-in-time |
| **Monitoring** | Basic logs | Cloud Monitoring + Alerts |
| **SSL** | Auto (managed) | Auto (managed) |

---

## Migration Path: MVP → Production

When you're ready to move to production:

1. **Sign HIPAA BAA** with Google Cloud ([Request here](https://cloud.google.com/terms/hipaa-baa))
2. **Upgrade database** to production tier (db-custom-2-8192 or higher)
3. **Migrate secrets** to GCP Secret Manager
4. **Set up Cloud Monitoring** alerts and dashboards
5. **Enable Cloud Armor** for DDoS protection
6. **Configure backup retention** (30 days + point-in-time recovery)
7. **Set minimum instances** to 1+ (avoid cold starts)
8. **Add custom domain** with SSL certificate

See [hosting-deployment.md](./hosting-deployment.md) for full production setup.

---

## Quick Troubleshooting

### Issue: Database connection fails

**Cloud Run:**
```bash
# Verify Cloud SQL connection
gcloud sql instances describe keystone-db-mvp --format="value(connectionName)"

# Check Cloud Run service has correct connection name
gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)"

# Verify Unix socket path in DATABASE_HOST
# Should be: /cloudsql/PROJECT:REGION:INSTANCE
```

**Render/Railway:**
- Verify `DATABASE_URL` environment variable is set
- Check database service is running (not sleeping)

### Issue: Service returns 502 Bad Gateway

**Common causes:**
1. Application crashed on startup
2. Wrong `APP_PORT` (Cloud Run uses `PORT`, Render uses `10000`)
3. Database connection timeout

**Fix:**
```bash
# Check logs
gcloud logging read "resource.type=cloud_run_revision" --limit 50

# For Render: View logs in Dashboard → Logs tab
# For Railway: View logs in Deployments → Logs
```

### Issue: Cold starts too slow

**Cloud Run:**
```bash
# Set minimum instances to 1
gcloud run services update keystone-core-api \
  --min-instances 1 \
  --region us-central1
```

**Render:**
- Upgrade to paid plan ($7/mo) for always-on

**Railway:**
- Service stays warm if traffic > 1 req/hour

---

## MVP Checklist

### Pre-Deployment

- [ ] Choose hosting platform (Cloud Run recommended)
- [ ] Set up GCP/Render/Railway account
- [ ] Create database instance
- [ ] Generate strong secrets (JWT, refresh tokens)
- [ ] Configure OAuth providers (Google, Apple test credentials)
- [ ] Set up Cloud Storage bucket (if using GCP)

### Deployment

- [ ] Build and push Docker image
- [ ] Deploy service with environment variables
- [ ] Run database migrations
- [ ] Verify health endpoint (`/api/health`)
- [ ] Test authentication endpoints (`/v1/auth/google/login`)
- [ ] Configure custom domain (optional for MVP)

### Post-Deployment

- [ ] Set up monitoring (basic logs)
- [ ] Test API endpoints from Flutter app
- [ ] Document API URLs for team
- [ ] Set up GitHub Actions for auto-deploy (optional)

### Before Production

- [ ] Sign HIPAA BAA with Google Cloud
- [ ] Migrate secrets to Secret Manager
- [ ] Upgrade database tier
- [ ] Set up Cloud Monitoring alerts
- [ ] Complete security audit
- [ ] See [hosting-deployment.md](./hosting-deployment.md) for full checklist

---

## Cost Optimization Tips for MVP

1. **Use free tier credits** (GCP: $300 credit, Railway: $5/mo)
2. **Set `min-instances 0`** (Cloud Run scales to zero when idle)
3. **Use smallest database tier** (db-f1-micro is sufficient for MVP)
4. **Disable unnecessary services** (e.g., Document AI if not using OCR yet)
5. **Monitor usage** in GCP Console / Render Dashboard / Railway Dashboard
6. **Set budget alerts** (GCP: $20/month, Render/Railway: usage alerts)

---

## Next Steps

1. **Choose Option 1 (GCP Cloud Run)** for easiest production path
2. **Follow deployment steps** above
3. **Test with Flutter app** - Update API base URL
4. **Monitor usage** for first week
5. **Plan production migration** when ready (see [hosting-deployment.md](./hosting-deployment.md))

---

## Additional Resources

- **Production Hosting Guide:** [hosting-deployment.md](./hosting-deployment.md)
- **HIPAA Authentication:** [hipaa-authentication.md](./hipaa-authentication.md)
- **GCP Cloud Run Docs:** [cloud.google.com/run/docs](https://cloud.google.com/run/docs)
- **Render Docs:** [render.com/docs](https://render.com/docs)
- **Railway Docs:** [docs.railway.app](https://docs.railway.app)

---

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Author:** HealthAtlas Engineering Team






