# GCP Deployment Quick Reference

**TL;DR: Use Cloud Run - It's the cheapest, simplest, and most reliable option for this NestJS API.**

---

## Quick Decision Matrix

| Criterion | Cloud Run ⭐ | GKE | Compute Engine |
|-----------|------------|-----|----------------|
| **Monthly Cost (Small)** | **$56** | $333 | $173 |
| **HIPAA Eligible** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Setup Complexity** | ⭐⭐⭐⭐⭐ Very Easy | ⭐⭐ Complex | ⭐⭐⭐ Moderate |
| **Auto-Scaling** | ✅ 0-1000+ instances | ✅ HPA | ⚠️ Manual/MIG |
| **Scale to Zero** | ✅ Yes | ❌ No | ❌ No |
| **Cold Start** | ⚠️ 1-3s | ✅ None | ✅ None |
| **Best For** | **This API** | Microservices | Legacy apps |

**Winner: Cloud Run** - 3-6x cheaper, simpler, perfect fit.

---

## Cost Summary

### Small Scale (1K users, 50K req/day)
```
Cloud Run:        $56/month
Cloud SQL:        $150/month
Cloud Storage:    $3.50/month
Secret Manager:   $3.24/month
Document AI:      $15/month
─────────────────────────────
Total:            ~$243/month
```

### Medium Scale (10K users, 500K req/day)
```
Total:            ~$720/month
```

### Large Scale (100K users, 5M req/day)
```
Total:            ~$5,100/month
```

---

## One-Command Deployment

```bash
# Deploy to Cloud Run
gcloud run deploy keystone-core-api \
  --image gcr.io/PROJECT/keystone-core-api:latest \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 100 \
  --memory 2Gi \
  --cpu 2
```

**That's it!** No Kubernetes manifests, no VM management, no cluster setup.

---

## Why Cloud Run?

1. **Cheapest** - Pay only for actual usage, scales to zero
2. **Simplest** - Single command deployment
3. **HIPAA-Ready** - Automatic compliance with signed BAA
4. **Auto-Scales** - Handles traffic spikes automatically
5. **Production-Ready** - Same platform for MVP and production

---

## Cost Optimization Tips

1. **Use Free Tier** - 2M requests/month free
2. **Scale to Zero** - Save $30-50/month (if cold starts acceptable)
3. **Right-Size Resources** - Start with 1 vCPU, 1 GB (~$28/month)
4. **Committed Use Discounts** - 25-52% off database costs
5. **Set Budget Alerts** - Prevent surprise bills

---

## HIPAA Requirements

**Before Production:**
- [ ] Sign BAA with Google Cloud (1-2 weeks processing)
- [ ] Move secrets to Secret Manager
- [ ] Enable audit logging (7-year retention)
- [ ] Configure backups (daily, 30-day retention)

**Already Automatic:**
- ✅ Encryption at rest (AES-256)
- ✅ Encryption in transit (TLS 1.3)
- ✅ IAM access controls

---

## Quick Start (5 Minutes)

```bash
# 1. Login
gcloud auth login

# 2. Create project
gcloud projects create keystone-api-prod
gcloud config set project keystone-api-prod

# 3. Enable APIs
gcloud services enable run.googleapis.com sqladmin.googleapis.com

# 4. Build & deploy
docker build -t gcr.io/$(gcloud config get-value project)/keystone-core-api:latest .
docker push gcr.io/$(gcloud config get-value project)/keystone-core-api:latest

gcloud run deploy keystone-core-api \
  --image gcr.io/$(gcloud config get-value project)/keystone-core-api:latest \
  --region us-central1 \
  --allow-unauthenticated
```

---

## Full Guide

For complete deployment instructions, see:
- **[gcp-deployment-guide.md](./gcp-deployment-guide.md)** - Complete step-by-step guide
- **[hosting-deployment.md](./hosting-deployment.md)** - Full production architecture
- **[mvp-hosting-guide.md](./mvp-hosting-guide.md)** - MVP quick start

---

**Last Updated:** January 2025









