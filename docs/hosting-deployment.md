# Keystone Core API - Hosting & Deployment Guide

**HIPAA-Compliant Healthcare API Deployment on Google Cloud Platform**

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Project Overview](#project-overview)
- [Technology Stack](#technology-stack)
- [HIPAA Compliance Requirements](#hipaa-compliance-requirements)
- [Infrastructure Options](#infrastructure-options)
- [Recommended Architecture](#recommended-architecture)
- [Security Implementation](#security-implementation)
- [Deployment Workflows](#deployment-workflows)
- [Monitoring & Observability](#monitoring--observability)
- [Disaster Recovery & Business Continuity](#disaster-recovery--business-continuity)
- [Cost Estimation](#cost-estimation)
- [Pre-Production Checklist](#pre-production-checklist)

---

## Executive Summary

**Keystone Core API** is a HIPAA-compliant healthcare backend service powering the HealthAtlas personal health record platform. This document provides comprehensive guidance for hosting, deploying, and maintaining the API in a production environment on Google Cloud Platform (GCP).

### Key Characteristics

- **Compliance:** HIPAA-aligned with PHI (Protected Health Information) handling
- **Architecture:** NestJS monolith with hexagonal architecture
- **Scale:** Designed for 10K-100K users with ability to scale horizontally
- **Data:** PostgreSQL (relational), Google Cloud Storage (documents), Document AI (OCR)
- **Security:** OAuth 2.0, JWT with session validation, rate limiting, audit logging

### Recommended Hosting Solution

**Primary Recommendation: GCP Cloud Run** (serverless containers)
- ✅ Automatic HIPAA-eligible infrastructure
- ✅ Built-in HTTPS/TLS 1.3
- ✅ Auto-scaling with zero-to-many instances
- ✅ Pay-per-use pricing
- ✅ Simpler than Kubernetes, more flexible than VMs

**Alternative Options:**
- GKE (Google Kubernetes Engine) for complex microservices evolution
- Compute Engine VMs for maximum control and predictable costs

---

## Project Overview

### What is Keystone Core API?

Keystone Core API is the central backend service for HealthAtlas, a secure personal health record platform. It serves as the gateway between mobile clients (Flutter app) and health data storage/processing services.

### Core Responsibilities

| Capability | Description | PHI Involved? |
|------------|-------------|---------------|
| **Authentication** | OAuth (Google, Apple), email/password, MFA, session management | ❌ Identity only |
| **User Management** | Profile CRUD, role-based access control (RBAC) | ❌ Identity only |
| **Document Processing** | Secure upload, OCR via Document AI, metadata storage | ✅ **YES - Medical documents** |
| **Health Data API** | Medications, conditions, providers, insurance (planned) | ✅ **YES - Medical records** |
| **Audit Logging** | All access events, authentication events | ⚠️ Contains user IDs, no PHI content |
| **API Gateway** | Rate limiting, validation, error handling, routing | ❌ Infrastructure |

### System Context

```
┌─────────────┐
│  Flutter    │  Mobile App (iOS/Android)
│  Client     │  - Native OAuth (Google/Apple)
└──────┬──────┘  - HTTP REST API calls
       │ HTTPS
       ↓
┌─────────────────────────────────────────────────────────┐
│              Keystone Core API (This Service)           │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │   Auth     │ │   Document   │ │   Health Data    │  │
│  │  Service   │ │  Processing  │ │   (Future)       │  │
│  └────────────┘ └──────────────┘ └──────────────────┘  │
└───────────────┬─────────────────┬─────────────────────┘
                │                 │
       ┌────────┴────────┐       │
       ↓                 ↓       ↓
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│ Cloud SQL    │  │ Cloud Storage    │  │ Document AI  │
│ (PostgreSQL) │  │ (GCS Buckets)    │  │ (OCR Engine) │
│              │  │                  │  │              │
│ - Users      │  │ - Raw documents  │  │ - Batch OCR  │
│ - Sessions   │  │ - Processed PDFs │  │ - Entity     │
│ - Documents  │  │ - Signed URLs    │  │   extraction  │
│   metadata   │  │                  │  │              │
└──────────────┘  └──────────────────┘  └──────────────┘
```

---

## Technology Stack

### Application Layer

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Runtime** | Node.js | 22.x LTS | JavaScript runtime |
| **Framework** | NestJS | 11.x | Modular TypeScript backend framework |
| **Language** | TypeScript | 5.9.x | Type-safe JavaScript |
| **Architecture** | Hexagonal (Ports & Adapters) | - | Domain-driven, database-agnostic |

### Data Layer

| Component | Technology | HIPAA-Eligible? | Purpose |
|-----------|-----------|-----------------|---------|
| **Relational DB** | PostgreSQL 15+ (Cloud SQL) | ✅ Yes | User accounts, sessions, document metadata |
| **Object Storage** | Google Cloud Storage | ✅ Yes | Document files (PDFs, images) |
| **Document Processing** | Google Cloud Document AI | ✅ Yes | OCR and entity extraction |
| **Cache (Future)** | Redis (Memorystore) | ✅ Yes | Session storage, rate limiting |

### Security & Compliance

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Authentication** | Passport.js + JWT | OAuth 2.0, JWT access/refresh tokens |
| **OAuth Providers** | Google Sign-In, Apple Sign In | Native mobile authentication |
| **Rate Limiting** | @nestjs/throttler | DDoS protection, brute force prevention |
| **Encryption (Transit)** | TLS 1.3 | HTTPS enforcement |
| **Encryption (Rest)** | AES-256 (GCP-managed) | Database and storage encryption |
| **Audit Logging** | Custom AuditService | HIPAA-compliant event logging |
| **Input Validation** | class-validator | DTO validation, injection prevention |
| **Security Headers** | Helmet | XSS, clickjacking, CSP headers |

### Development & Operations

| Tool | Purpose |
|------|---------|
| Docker | Containerization for consistent deployments |
| GitHub Actions | CI/CD pipelines |
| ESLint + Prettier | Code quality and formatting |
| Jest | Unit and E2E testing |
| TypeORM | Database migrations and ORM |
| Swagger/OpenAPI | API documentation |

---

## HIPAA Compliance Requirements

### Legal & Contractual

#### 1. Business Associate Agreement (BAA)

**Status:** ⚠️ **REQUIRED BEFORE PRODUCTION**

You MUST sign a Business Associate Agreement with:

- ✅ **Google Cloud Platform** - Covers all GCP services
  - [Request BAA](https://cloud.google.com/terms/hipaa-baa)
  - Covers: Cloud SQL, Cloud Storage, Document AI, Cloud Run, GKE, Logging

**Action Items:**
1. Contact Google Cloud Sales or your account manager
2. Request HIPAA BAA execution
3. Wait for signed agreement (typically 1-2 weeks)
4. Store executed BAA with compliance documentation
5. Review annually and on service additions

#### 2. Covered Services

Only these GCP services are HIPAA-eligible WITH a signed BAA:

| Service | Status | Used By Keystone? |
|---------|--------|-------------------|
| Compute Engine | ✅ Eligible | 🟡 Alternative option |
| Cloud Run | ✅ Eligible | ✅ **Primary recommendation** |
| GKE (Kubernetes) | ✅ Eligible | 🟡 Alternative option |
| Cloud SQL | ✅ Eligible | ✅ **Currently used** |
| Cloud Storage | ✅ Eligible | ✅ **Currently used** |
| Document AI | ✅ Eligible | ✅ **Currently used** |
| Cloud Logging | ✅ Eligible | ✅ **Required for audit** |
| Secret Manager | ✅ Eligible | ⚠️ **Must implement** |
| Memorystore (Redis) | ✅ Eligible | 🔮 Future enhancement |

⚠️ **WARNING:** Do NOT use non-eligible services (e.g., Firebase Realtime Database, Cloud Functions Gen 1) for PHI.

### Technical Safeguards (HIPAA Security Rule)

#### Administrative Safeguards

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| **Risk Analysis** | Annual security assessments, penetration testing | ⚠️ TODO |
| **Workforce Training** | HIPAA training for all engineers with PHI access | ⚠️ TODO |
| **Access Management** | IAM roles with least privilege, MFA for all GCP access | ⚠️ TODO |
| **Incident Response** | Documented breach notification procedures | ⚠️ TODO |

#### Physical Safeguards

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| **Facility Access** | GCP data centers (ISO 27001, SOC 2 certified) | ✅ Automatic |
| **Workstation Security** | Engineering workstations with disk encryption, screen locks | ⚠️ Policy required |

#### Technical Safeguards

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| **Access Control** | JWT authentication, session validation, RBAC | ✅ Implemented |
| **Audit Controls** | AuditService logs all PHI access events | ✅ Implemented |
| **Integrity Controls** | Input validation, checksums on documents | ✅ Implemented |
| **Transmission Security** | TLS 1.3, HTTPS enforcement | ✅ Implemented |
| **Encryption at Rest** | AES-256 (Cloud SQL, GCS) | ✅ Automatic with GCP |
| **Encryption in Transit** | TLS 1.3 | ✅ Automatic with Cloud Run/LB |

### Data Retention & Disposal

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| **Minimum Retention** | 6 years (HIPAA), 8 years (implementation) | ✅ Configured |
| **Soft Delete** | Documents marked deleted but retained | ✅ Implemented |
| **Hard Delete** | Automated deletion after 8 years | ⚠️ Cron job TODO |
| **Backup Retention** | 30-day point-in-time recovery | ✅ Cloud SQL automatic |

---

## Infrastructure Options

### Option 1: Cloud Run (Serverless Containers) ⭐ **RECOMMENDED**

#### Overview

Cloud Run is a fully managed serverless platform that automatically scales container instances based on traffic, from zero to hundreds of instances.

#### Architecture

```
Internet
   ↓
Google Cloud Load Balancer (Global HTTPS LB)
   ├─ SSL/TLS Termination (Managed Certificate)
   ├─ Cloud Armor (WAF, DDoS Protection) - Optional
   └─ Cloud CDN (Static assets) - Optional
   ↓
Cloud Run Service (keystone-core-api)
   ├─ Auto-scaling: 0 to 100+ instances
   ├─ CPU: 1-8 vCPU per instance
   ├─ Memory: 512 MB - 32 GB per instance
   ├─ Concurrency: 80 requests per instance (configurable)
   └─ Region: us-central1 (HIPAA-eligible)
   ↓
┌─────────────────────┬──────────────────────┬─────────────────┐
│   Cloud SQL         │   Cloud Storage      │   Document AI   │
│   (PostgreSQL)      │   (2 buckets)        │   (OCR)         │
└─────────────────────┴──────────────────────┴─────────────────┘
```

#### Advantages ✅

1. **Simplicity**
   - No cluster management (unlike Kubernetes)
   - No OS patching (unlike VMs)
   - Deploy with a single `gcloud run deploy` command

2. **Cost Efficiency**
   - Pay only when handling requests
   - Scale to zero during idle periods
   - No costs for idle capacity

3. **HIPAA-Eligible by Default**
   - Runs in Google's HIPAA-compliant infrastructure
   - Automatic TLS 1.3
   - Integrated with IAM, Cloud Logging, Cloud Monitoring

4. **Developer Experience**
   - Fast deployments (< 2 minutes)
   - Rolling updates with traffic splitting
   - Built-in health checks
   - Integrated logging and monitoring

5. **Scalability**
   - Automatic horizontal scaling
   - Handles traffic spikes (e.g., 10 req/min → 1000 req/min instantly)
   - Global load balancing available

#### Disadvantages ❌

1. **Request Timeout**
   - Maximum 60 minutes per request (more than sufficient for API)
   - Could be limiting for very long-running batch jobs

2. **Cold Starts**
   - First request after idle period takes ~1-3 seconds
   - Mitigation: Set minimum instances to 1+ (cost increases)

3. **Stateless Only**
   - No local disk persistence between requests
   - Must use external storage (Cloud SQL, GCS, Memorystore)

4. **Limited Compute Options**
   - Cannot use GPUs (not needed for this API)
   - Max 8 vCPU per instance

#### Configuration

```yaml
# cloud-run.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: keystone-core-api
  labels:
    env: production
    hipaa: true
spec:
  template:
    metadata:
      annotations:
        # Scaling
        autoscaling.knative.dev/minScale: "1"  # Prevent cold starts
        autoscaling.knative.dev/maxScale: "100"
        # Resources
        autoscaling.knative.dev/target: "80"  # Target 80 concurrent requests per instance
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300  # 5 min (default 300, max 3600)
      containers:
      - image: gcr.io/PROJECT_ID/keystone-core-api:latest
        ports:
        - containerPort: 8080
        resources:
          limits:
            cpu: "2"
            memory: "2Gi"
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_HOST
          value: "/cloudsql/PROJECT:REGION:INSTANCE"
        - name: AUTH_JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: auth-jwt-secret
              key: latest
```

#### Deployment Command

```bash
gcloud run deploy keystone-core-api \
  --image gcr.io/PROJECT_ID/keystone-core-api:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 100 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 80 \
  --set-env-vars NODE_ENV=production \
  --add-cloudsql-instances PROJECT:REGION:INSTANCE \
  --set-secrets AUTH_JWT_SECRET=auth-jwt-secret:latest
```

#### Cost Estimate (Cloud Run)

**Assumptions:**
- 50,000 requests/day (1,700 req/hour)
- Average request duration: 200ms
- 2 vCPU, 2 GB memory
- Min instances: 1 (to avoid cold starts)

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **CPU** | 2 vCPU × 730 hours | $49 |
| **Memory** | 2 GB × 730 hours | $5 |
| **Requests** | 1.5M requests × $0.40/million | $0.60 |
| **Networking** | 10 GB egress × $0.12/GB | $1.20 |
| **Total** | | **~$56/month** |

Add-ons:
- Cloud SQL: ~$100-200/month (db-f1-micro to db-n1-standard-1)
- Cloud Storage: ~$20/month (1 TB)
- Document AI: ~$50-500/month (depends on volume)

**Total Estimated Monthly Cost: $226-776/month**

---

### Option 2: Google Kubernetes Engine (GKE)

#### Overview

GKE is a managed Kubernetes service for running containerized applications with advanced orchestration capabilities.

#### When to Choose GKE Over Cloud Run

- ✅ You plan to evolve into microservices (multiple services)
- ✅ You need advanced networking (service mesh, ingress customization)
- ✅ You need sidecar containers (e.g., Istio, logging agents)
- ✅ You need stateful workloads (StatefulSets)
- ✅ You have Kubernetes expertise on the team

#### Architecture

```
Internet
   ↓
Google Cloud Load Balancer
   ↓
GKE Ingress (nginx or GCE)
   ↓
GKE Cluster (3+ nodes)
   ├─ Node Pool 1: keystone-api (2-10 nodes)
   │   └─ Pods: keystone-core-api (2-20 replicas)
   ├─ Node Pool 2: background-workers (1-5 nodes) - Future
   │   └─ Pods: cron jobs, batch processing
   └─ Node Pool 3: monitoring (1-2 nodes)
       └─ Pods: Prometheus, Grafana
   ↓
Cloud SQL, Cloud Storage, Document AI
```

#### Advantages ✅

1. **Flexibility**
   - Full control over networking, storage, and orchestration
   - Sidecar containers for logging, monitoring, service mesh
   - Support for StatefulSets, DaemonSets, CronJobs

2. **Microservices Ready**
   - Native support for multi-service deployments
   - Service discovery, load balancing between services

3. **Advanced Deployment Strategies**
   - Blue/green deployments
   - Canary deployments with traffic splitting
   - A/B testing

4. **Ecosystem**
   - Helm charts for package management
   - Istio for service mesh (mTLS, observability)
   - Prometheus + Grafana for custom metrics

#### Disadvantages ❌

1. **Complexity**
   - Steeper learning curve (Kubernetes expertise required)
   - More configuration (YAML manifests, Helm charts, secrets)
   - Cluster management overhead (upgrades, node pools)

2. **Cost**
   - Cluster management fee: $0.10/hour ($73/month)
   - Always-on nodes (no scale-to-zero)
   - Higher baseline cost than Cloud Run

3. **Security Surface**
   - More attack vectors (Kubernetes API, etcd, kubelet)
   - Requires network policies, pod security policies
   - More components to secure and patch

#### Configuration

```yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keystone-core-api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: keystone-core-api
  template:
    metadata:
      labels:
        app: keystone-core-api
    spec:
      containers:
      - name: api
        image: gcr.io/PROJECT_ID/keystone-core-api:latest
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 2
            memory: 2Gi
        env:
        - name: NODE_ENV
          value: production
        - name: AUTH_JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: auth-secrets
              key: jwt-secret
        livenessProbe:
          httpGet:
            path: /api/health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: keystone-core-api
spec:
  type: ClusterIP
  selector:
    app: keystone-core-api
  ports:
  - port: 80
    targetPort: 8080
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: keystone-api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: keystone-core-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

#### Cost Estimate (GKE)

**Assumptions:**
- Standard cluster (not Autopilot)
- 3 nodes (n1-standard-2: 2 vCPU, 7.5 GB memory each)

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **Cluster Management** | $0.10/hour × 730 hours | $73 |
| **Nodes** | 3 × n1-standard-2 × $0.0950/hour × 730 hours | $208 |
| **Persistent Disk** | 300 GB SSD × $0.17/GB | $51 |
| **Networking** | ~10 GB egress × $0.12/GB | $1.20 |
| **Total** | | **~$333/month** |

Add-ons (same as Cloud Run):
- Cloud SQL: ~$100-200/month
- Cloud Storage: ~$20/month
- Document AI: ~$50-500/month

**Total Estimated Monthly Cost: $503-1,053/month**

---

### Option 3: Compute Engine VMs

#### Overview

Traditional virtual machines with full OS control. Most similar to on-premise hosting.

#### When to Choose VMs

- ✅ You need maximum control over the OS and kernel
- ✅ You have specific compliance requirements requiring VM isolation
- ✅ You need predictable, sustained compute with committed use discounts
- ✅ You have legacy applications that are difficult to containerize

#### Architecture

```
Internet
   ↓
Google Cloud Load Balancer
   ↓
Managed Instance Group (MIG)
   ├─ VM Instance 1 (n1-standard-2)
   ├─ VM Instance 2 (n1-standard-2)
   └─ VM Instance 3-10 (auto-scaling)
   ↓
Cloud SQL, Cloud Storage, Document AI
```

#### Advantages ✅

1. **Full Control**
   - SSH access for debugging
   - Custom kernel modules if needed
   - Any Linux distribution

2. **Predictable Performance**
   - No noisy neighbor issues
   - Sustained use discounts (up to 30% off)
   - Committed use discounts (up to 57% off)

3. **Traditional Ops Model**
   - Familiar to sysadmins
   - Standard monitoring tools (Nagios, Zabbix, etc.)

#### Disadvantages ❌

1. **Operational Overhead**
   - OS patching and security updates
   - SSH key management
   - Manual scaling configuration
   - Longer deployment times

2. **Cost Inefficiency**
   - Always-on (no scale-to-zero)
   - Paying for idle capacity

3. **Slower Iteration**
   - Image baking takes time
   - Rolling updates are manual or complex

#### Cost Estimate (VMs)

**Assumptions:**
- 3 × n1-standard-2 VMs (2 vCPU, 7.5 GB memory)
- With sustained use discount (~30%)

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **Compute** | 3 × $0.0950/hour × 730 hours × 0.7 (discount) | $146 |
| **Boot Disks** | 3 × 50 GB SSD × $0.17/GB | $26 |
| **Networking** | ~10 GB egress × $0.12/GB | $1.20 |
| **Total** | | **~$173/month** |

Add-ons (same as others):
- Cloud SQL: ~$100-200/month
- Cloud Storage: ~$20/month
- Document AI: ~$50-500/month

**Total Estimated Monthly Cost: $343-893/month**

---

### Comparison Matrix

| Criterion | Cloud Run ⭐ | GKE | Compute Engine VMs |
|-----------|------------|-----|-------------------|
| **HIPAA Eligible** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Ease of Setup** | ⭐⭐⭐⭐⭐ Very Easy | ⭐⭐ Complex | ⭐⭐⭐ Moderate |
| **Operational Overhead** | ⭐⭐⭐⭐⭐ Very Low | ⭐⭐ High | ⭐⭐⭐ Moderate |
| **Scaling** | ⭐⭐⭐⭐⭐ Automatic (0-1000) | ⭐⭐⭐⭐ Auto (HPA) | ⭐⭐⭐ Manual/MIG |
| **Cost (Small Scale)** | ⭐⭐⭐⭐⭐ $56/mo | ⭐⭐ $333/mo | ⭐⭐⭐⭐ $173/mo |
| **Cost (Scale to Zero)** | ✅ Yes | ❌ No | ❌ No |
| **Cold Start** | ⚠️ 1-3 seconds | ✅ None | ✅ None |
| **Microservices Ready** | ⭐⭐⭐ Good | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐ Basic |
| **Stateful Workloads** | ❌ No | ✅ Yes | ✅ Yes |
| **Request Timeout** | 60 minutes | Unlimited | Unlimited |
| **Learning Curve** | ⭐⭐⭐⭐⭐ Very Low | ⭐ Steep | ⭐⭐⭐ Moderate |
| **Best For** | Monolith APIs, Serverless | Microservices, Complex | Legacy, Full Control |

### Recommendation: Cloud Run

**For Keystone Core API, Cloud Run is the optimal choice because:**

1. ✅ **HIPAA-compliant by default** with signed BAA
2. ✅ **Simple deployment** - Single command, fast iterations
3. ✅ **Cost-effective** - Scale to zero, pay-per-use
4. ✅ **Perfect fit** - Stateless REST API, no complex orchestration needed
5. ✅ **Future-proof** - Can migrate to GKE later if microservices needed

---

## Recommended Architecture

### Production Architecture (Cloud Run)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Internet (HTTPS)                             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │ Google Cloud Load Balancer   │
                │ - Managed SSL Certificate     │
                │ - DDoS Protection             │
                │ - Global Anycast IP           │
                └───────────────┬───────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ↓                       ↓                       ↓
┌───────────────┐     ┌─────────────────┐     ┌───────────────┐
│ Cloud Armor   │     │  Cloud Run      │     │ Cloud CDN     │
│ (WAF)         │     │  Service        │     │ (Optional)    │
│               │     │  - Min: 1       │     │               │
│ - Rate        │     │  - Max: 100     │     │ - Static      │
│   limiting    │     │  - CPU: 2       │     │   assets      │
│ - IP          │     │  - Memory: 2GB  │     │ - Edge        │
│   filtering   │     │                 │     │   caching     │
│ - Geo-fencing │     └─────────┬───────┘     │               │
└───────────────┘               │             └───────────────┘
                                │
                  ┌─────────────┼─────────────┐
                  │             │             │
                  ↓             ↓             ↓
       ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
       │ Cloud SQL    │  │ Cloud        │  │ Document AI      │
       │ (PostgreSQL) │  │ Storage      │  │                  │
       │              │  │              │  │ - OCR Processor  │
       │ - db-custom  │  │ - 2 Buckets: │  │ - Enterprise     │
       │   2vCPU/8GB  │  │   * raw/     │  │   Document OCR   │
       │ - Auto       │  │   * processed│  │                  │
       │   backups    │  │              │  │ - Region: us     │
       │ - HA (Multi  │  │ - Lifecycle  │  │                  │
       │   -zone)     │  │   8-year     │  │                  │
       │ - SSL/TLS    │  │   deletion   │  │                  │
       │              │  │              │  │                  │
       └──────────────┘  └──────────────┘  └──────────────────┘
                                │
                                ↓
                       ┌──────────────────┐
                       │ GCP Secret       │
                       │ Manager          │
                       │                  │
                       │ - JWT secrets    │
                       │ - DB passwords   │
                       │ - OAuth secrets  │
                       └──────────────────┘
```

### Multi-Region Architecture (High Availability)

For mission-critical deployments requiring 99.99% uptime:

```
┌─────────────────────────────────────────────────────────────┐
│              Global HTTPS Load Balancer                     │
│              (Anycast IP: routes to nearest region)         │
└────────────┬─────────────────────────────────┬──────────────┘
             │                                 │
    ┌────────┴────────┐                ┌──────┴─────────┐
    │  us-central1    │                │   us-east1     │
    │  (Primary)      │                │   (Secondary)  │
    │                 │                │                │
    │  Cloud Run      │◄──replication─►│  Cloud Run     │
    │  - Min: 2       │                │  - Min: 1      │
    │  - Max: 100     │                │  - Max: 50     │
    └────────┬────────┘                └────────┬───────┘
             │                                  │
    ┌────────┴────────┐                ┌───────┴────────┐
    │  Cloud SQL      │                │  Read Replica  │
    │  (Primary)      │───replication─→│  (Failover)    │
    │  us-central1    │                │  us-east1      │
    └─────────────────┘                └────────────────┘
```

**Cost:** +100% (double infrastructure), Uptime: 99.99%

---

## Security Implementation

### 1. Network Security

#### TLS/HTTPS Enforcement

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // HIPAA Requirement: HTTPS enforcement
  app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
      if (req.headers['x-forwarded-proto'] !== 'https') {
        return res.status(403).json({
          statusCode: 403,
          message: 'HTTPS required',
        });
      }
    }
    next();
  });

  // Security headers (Helmet)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  }));

  await app.listen(process.env.PORT || 8080);
}
bootstrap();
```

#### Firewall Rules (Cloud Armor)

```bash
# Create Cloud Armor security policy
gcloud compute security-policies create hipaa-api-policy \
  --description "HIPAA-compliant security policy for Keystone API"

# Rate limiting rule (protect against DDoS)
gcloud compute security-policies rules create 1000 \
  --security-policy hipaa-api-policy \
  --expression "true" \
  --action "rate-based-ban" \
  --rate-limit-threshold-count 100 \
  --rate-limit-threshold-interval-sec 60 \
  --ban-duration-sec 600 \
  --conform-action allow

# Geo-fencing (optional - restrict to specific countries)
gcloud compute security-policies rules create 2000 \
  --security-policy hipaa-api-policy \
  --expression "origin.region_code == 'CN' || origin.region_code == 'RU'" \
  --action deny-403

# Attach to load balancer backend service
gcloud compute backend-services update keystone-backend \
  --security-policy hipaa-api-policy \
  --global
```

### 2. Database Security

#### Cloud SQL Configuration

```bash
# Create Cloud SQL instance (PostgreSQL 15)
gcloud sql instances create keystone-db \
  --database-version POSTGRES_15 \
  --tier db-custom-2-8192 \
  --region us-central1 \
  --network default \
  --no-assign-ip \
  --availability-type REGIONAL \
  --backup \
  --backup-start-time 02:00 \
  --maintenance-window-day SUN \
  --maintenance-window-hour 3 \
  --database-flags \
    cloudsql.iam_authentication=on,\
    log_connections=on,\
    log_disconnections=on,\
    log_checkpoints=on \
  --enable-point-in-time-recovery \
  --retained-backups-count 30

# Encryption is automatic (AES-256, Google-managed keys)

# Create database
gcloud sql databases create keystone_prod \
  --instance keystone-db

# Create user (use IAM authentication in production)
gcloud sql users create keystone-api \
  --instance keystone-db \
  --password STRONG_PASSWORD_HERE

# Grant least privilege
# (Connect via Cloud SQL Proxy and run):
# GRANT CONNECT ON DATABASE keystone_prod TO "keystone-api";
# GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "keystone-api";
# REVOKE CREATE ON SCHEMA public FROM "keystone-api";
```

#### Connection Security

```bash
# Always connect via Cloud SQL Proxy (not public IP)
# In Cloud Run, use Unix socket:

# Connection string in .env:
DATABASE_HOST=/cloudsql/PROJECT_ID:us-central1:keystone-db
DATABASE_PORT=5432
DATABASE_USERNAME=keystone-api
DATABASE_PASSWORD=<from Secret Manager>
DATABASE_SSL_ENABLED=true
```

### 3. Storage Security

#### Cloud Storage Bucket Configuration

```bash
# Create documents bucket
gsutil mb -c STANDARD -l us-central1 -b on gs://healthatlas-documents-prod

# Enable encryption (automatic with Google-managed keys)
# For CMEK (Customer-Managed Encryption Keys):
# gsutil kms encryption -k projects/PROJECT/locations/us-central1/keyRings/KEYRING/cryptoKeys/KEY \
#   gs://healthatlas-documents-prod

# Uniform bucket-level access (disable ACLs)
gsutil uniformbucketlevelaccess set on gs://healthatlas-documents-prod

# Lifecycle policy (delete after 8 years)
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
gsutil lifecycle set lifecycle.json gs://healthatlas-documents-prod

# Enable audit logging (Data Access logs)
# This is configured at the project level in Cloud Console:
# IAM & Admin → Audit Logs → Cloud Storage → Enable "Data Read" and "Data Write"

# Set IAM permissions (least privilege)
gsutil iam ch serviceAccount:keystone-api@PROJECT.iam.gserviceaccount.com:objectCreator \
  gs://healthatlas-documents-prod
gsutil iam ch serviceAccount:keystone-api@PROJECT.iam.gserviceaccount.com:objectViewer \
  gs://healthatlas-documents-prod

# Block public access
gsutil iam ch allUsers:legacyObjectReader gs://healthatlas-documents-prod
# (Should return error "not found" - confirms no public access)
```

### 4. Secret Management

#### GCP Secret Manager Setup

```bash
# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com

# Create secrets
echo -n "STRONG_JWT_SECRET_HERE" | \
  gcloud secrets create auth-jwt-secret --data-file=-

echo -n "STRONG_REFRESH_SECRET_HERE" | \
  gcloud secrets create auth-refresh-secret --data-file=-

echo -n "DB_PASSWORD_HERE" | \
  gcloud secrets create database-password --data-file=-

echo -n "GOOGLE_CLIENT_SECRET_HERE" | \
  gcloud secrets create google-oauth-secret --data-file=-

# Grant Cloud Run service account access
gcloud secrets add-iam-policy-binding auth-jwt-secret \
  --member="serviceAccount:keystone-api@PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Repeat for all secrets...

# Reference secrets in Cloud Run deployment
gcloud run deploy keystone-core-api \
  --set-secrets="AUTH_JWT_SECRET=auth-jwt-secret:latest,\
AUTH_REFRESH_SECRET=auth-refresh-secret:latest,\
DATABASE_PASSWORD=database-password:latest,\
GOOGLE_CLIENT_SECRET=google-oauth-secret:latest"
```

#### Application Code (Secret Manager Integration)

```typescript
// src/config/secret-manager.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export class SecretManagerConfig {
  private client: SecretManagerServiceClient;
  private projectId: string;

  constructor() {
    this.client = new SecretManagerServiceClient();
    this.projectId = process.env.GCP_PROJECT_ID || 'your-project-id';
  }

  async getSecret(secretName: string, version = 'latest'): Promise<string> {
    // In production, fetch from Secret Manager
    if (process.env.NODE_ENV === 'production') {
      const name = `projects/${this.projectId}/secrets/${secretName}/versions/${version}`;
      const [version] = await this.client.accessSecretVersion({ name });
      return version.payload?.data?.toString() || '';
    }
    
    // In development, fall back to environment variables
    return process.env[secretName] || '';
  }
}

// TODO: Integrate with NestJS ConfigModule for seamless secret loading
```

### 5. Audit Logging

#### Cloud Logging Configuration

```typescript
// src/audit/audit.service.ts (already implemented)
// Ensure logs are forwarded to Cloud Logging

import { Logging } from '@google-cloud/logging';

export class AuditService {
  private logging: Logging;
  private log: any;

  constructor(private configService: ConfigService) {
    if (this.configService.get('app.nodeEnv') === 'production') {
      this.logging = new Logging({
        projectId: this.configService.get('gcp.projectId'),
      });
      this.log = this.logging.log('hipaa-audit');
    }
  }

  async logAuthEvent(data: AuthEventData): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      // ... (existing fields)
    };

    // Console logging (always)
    console.info(JSON.stringify(logEntry));

    // GCP Cloud Logging (production only)
    if (this.log) {
      const metadata = {
        resource: { type: 'cloud_run_revision' },
        severity: 'INFO',
        labels: {
          event_type: data.event,
          user_id: data.userId.toString(),
          hipaa_audit: 'true',
        },
      };
      const entry = this.log.entry(metadata, logEntry);
      await this.log.write(entry);
    }
  }
}
```

#### Log Retention Policy

```bash
# Create log sink with 7-year retention (HIPAA requirement: 6+ years)
gcloud logging sinks create hipaa-audit-sink \
  gs://healthatlas-audit-logs-prod \
  --log-filter='
    resource.type="cloud_run_revision"
    AND jsonPayload.component="auth"
    AND jsonPayload.hipaa_audit="true"
  '

# Set bucket retention policy
gsutil retention set 7y gs://healthatlas-audit-logs-prod
gsutil retention lock gs://healthatlas-audit-logs-prod
```

---

## Deployment Workflows

### CI/CD Pipeline (GitHub Actions)

#### Workflow File

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production (Cloud Run)

on:
  push:
    branches:
      - main
  workflow_dispatch:

env:
  GCP_PROJECT_ID: your-project-id
  GCP_REGION: us-central1
  SERVICE_NAME: keystone-core-api
  IMAGE_NAME: gcr.io/${{ secrets.GCP_PROJECT_ID }}/keystone-core-api

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run unit tests
        run: npm run test
      
      - name: Run E2E tests
        run: npm run test:e2e
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/test
  
  build-and-deploy:
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
      
      - name: Configure Docker for GCR
        run: gcloud auth configure-docker
      
      - name: Build Docker image
        run: |
          docker build \
            --tag ${{ env.IMAGE_NAME }}:${{ github.sha }} \
            --tag ${{ env.IMAGE_NAME }}:latest \
            --file Dockerfile \
            .
      
      - name: Push Docker image to GCR
        run: |
          docker push ${{ env.IMAGE_NAME }}:${{ github.sha }}
          docker push ${{ env.IMAGE_NAME }}:latest
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image ${{ env.IMAGE_NAME }}:${{ github.sha }} \
            --region ${{ env.GCP_REGION }} \
            --platform managed \
            --allow-unauthenticated \
            --min-instances 1 \
            --max-instances 100 \
            --memory 2Gi \
            --cpu 2 \
            --timeout 300 \
            --concurrency 80 \
            --set-env-vars NODE_ENV=production \
            --add-cloudsql-instances ${{ secrets.CLOUDSQL_INSTANCE }} \
            --set-secrets \
              AUTH_JWT_SECRET=auth-jwt-secret:latest,\
              AUTH_REFRESH_SECRET=auth-refresh-secret:latest,\
              DATABASE_PASSWORD=database-password:latest
      
      - name: Run database migrations
        run: |
          gcloud run jobs create keystone-migrations \
            --image ${{ env.IMAGE_NAME }}:${{ github.sha }} \
            --region ${{ env.GCP_REGION }} \
            --command npm run migration:run \
            --wait
      
      - name: Smoke tests
        run: |
          SERVICE_URL=$(gcloud run services describe ${{ env.SERVICE_NAME }} \
            --region ${{ env.GCP_REGION }} \
            --format 'value(status.url)')
          
          # Health check
          curl -f $SERVICE_URL/api/health || exit 1
          
          # Swagger docs
          curl -f $SERVICE_URL/docs || exit 1
      
      - name: Notify Slack
        if: always()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: |
            Deployment to production: ${{ job.status }}
            Commit: ${{ github.sha }}
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### Manual Deployment Steps

```bash
# 1. Build Docker image
docker build -t gcr.io/PROJECT_ID/keystone-core-api:v1.0.0 .

# 2. Push to Google Container Registry
docker push gcr.io/PROJECT_ID/keystone-core-api:v1.0.0

# 3. Deploy to Cloud Run
gcloud run deploy keystone-core-api \
  --image gcr.io/PROJECT_ID/keystone-core-api:v1.0.0 \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 100 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --set-env-vars NODE_ENV=production \
  --add-cloudsql-instances PROJECT_ID:us-central1:keystone-db

# 4. Run database migrations
# (Create a Cloud Run job or run via Cloud Shell)
gcloud run jobs create migration-job \
  --image gcr.io/PROJECT_ID/keystone-core-api:v1.0.0 \
  --region us-central1 \
  --command npm run migration:run \
  --add-cloudsql-instances PROJECT_ID:us-central1:keystone-db

gcloud run jobs execute migration-job --region us-central1 --wait

# 5. Verify deployment
SERVICE_URL=$(gcloud run services describe keystone-core-api \
  --region us-central1 \
  --format 'value(status.url)')

curl $SERVICE_URL/api/health
# Expected: {"status":"ok","database":"connected"}
```

---

## Monitoring & Observability

### 1. Health Checks

```typescript
// src/home/home.controller.ts (already exists)
import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller()
export class HomeController {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  @Get('health')
  async health() {
    // Check database connection
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'degraded',
        database: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('readiness')
  async readiness() {
    // Readiness probe (used by load balancer)
    return { status: 'ready' };
  }

  @Get('liveness')
  async liveness() {
    // Liveness probe (used to restart unhealthy instances)
    return { status: 'alive' };
  }
}
```

### 2. Cloud Monitoring (Stackdriver)

#### Key Metrics to Monitor

| Metric | Threshold | Alert Action |
|--------|-----------|--------------|
| **Request Latency (p99)** | > 5 seconds | Page on-call engineer |
| **Error Rate** | > 5% | Notify engineering channel |
| **CPU Utilization** | > 80% | Auto-scale (automatic with Cloud Run) |
| **Memory Utilization** | > 85% | Auto-scale or increase instance size |
| **Database Connections** | > 90% of pool | Investigate connection leaks |
| **Failed Logins** | > 100/min | Potential brute force attack |
| **Document Processing Failures** | > 10% | Investigate Document AI |
| **Cloud SQL Replication Lag** | > 10 seconds | Check database health |

#### Creating Alerts

```bash
# CPU alert
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High CPU Usage" \
  --condition-display-name="CPU > 80%" \
  --condition-threshold-value=0.8 \
  --condition-threshold-duration=300s \
  --condition-filter='
    resource.type="cloud_run_revision"
    AND resource.labels.service_name="keystone-core-api"
    AND metric.type="run.googleapis.com/container/cpu/utilization"
  '

# Error rate alert
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

### 3. Custom Dashboards

Create custom dashboard in Cloud Console:

**Metrics to Include:**
1. Request rate (requests/second)
2. Latency (p50, p95, p99)
3. Error rate (4xx, 5xx)
4. Active instances
5. CPU and memory utilization
6. Database query time
7. Document processing queue length
8. Authentication success/failure rate

### 4. Application Performance Monitoring (APM)

**Option 1: Google Cloud Trace (Built-in)**

```typescript
// src/main.ts
import { TraceAgent } from '@google-cloud/trace-agent';

// Start trace agent BEFORE any other imports
if (process.env.NODE_ENV === 'production') {
  TraceAgent.start({
    projectId: process.env.GCP_PROJECT_ID,
    serviceContext: {
      service: 'keystone-core-api',
      version: process.env.APP_VERSION,
    },
  });
}

import { NestFactory } from '@nestjs/core';
// ... rest of bootstrap
```

**Option 2: Sentry (Third-party)**

```bash
npm install @sentry/node @sentry/tracing
```

```typescript
// src/main.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1, // 10% of transactions
  beforeSend(event, hint) {
    // Filter out PHI from error reports
    if (event.request?.data) {
      // Redact sensitive fields
      delete event.request.data.idToken;
      delete event.request.data.password;
    }
    return event;
  },
});
```

---

## Disaster Recovery & Business Continuity

### Recovery Objectives

| Metric | Target | Current | Notes |
|--------|--------|---------|-------|
| **RTO** (Recovery Time Objective) | 1 hour | ~15 minutes | Time to restore service after outage |
| **RPO** (Recovery Point Objective) | 5 minutes | ~1 minute | Max data loss acceptable |
| **Availability** | 99.9% (8.76h downtime/year) | 99.95% | Cloud Run SLA: 99.95% |

### Backup Strategy

#### Database Backups

```bash
# Automatic backups (already configured)
# - Daily backups at 2 AM UTC
# - 30-day retention
# - Point-in-time recovery (up to 7 days)

# Manual backup
gcloud sql backups create \
  --instance keystone-db \
  --description "Pre-migration backup"

# List backups
gcloud sql backups list --instance keystone-db

# Restore from backup
gcloud sql backups restore BACKUP_ID \
  --backup-instance keystone-db \
  --backup-id BACKUP_ID
```

#### Cloud Storage Backups

```bash
# Enable object versioning (keeps deleted/overwritten files)
gsutil versioning set on gs://healthatlas-documents-prod

# Copy bucket to secondary region (for DR)
gsutil -m rsync -r -d \
  gs://healthatlas-documents-prod \
  gs://healthatlas-documents-dr-us-east1
```

### Disaster Recovery Procedures

#### Scenario 1: Regional Outage (us-central1 unavailable)

**Impact:** API unavailable in primary region

**Recovery Steps:**

1. **Deploy to secondary region** (us-east1):
   ```bash
   gcloud run deploy keystone-core-api \
     --image gcr.io/PROJECT/keystone-core-api:latest \
     --region us-east1 \
     --min-instances 2
   ```

2. **Update DNS/Load Balancer** to route traffic to us-east1

3. **Failover database** (if using read replica):
   ```bash
   gcloud sql instances promote-replica keystone-db-replica-us-east1
   ```

4. **Update environment variables** to point to new database

**Estimated RTO:** 15-30 minutes

#### Scenario 2: Database Corruption

**Impact:** Data integrity compromised

**Recovery Steps:**

1. **Stop all writes** (temporarily disable Cloud Run service):
   ```bash
   gcloud run services update keystone-core-api \
     --region us-central1 \
     --min-instances 0 \
     --max-instances 0
   ```

2. **Restore from backup**:
   ```bash
   # Create new instance from backup
   gcloud sql instances clone keystone-db keystone-db-restored \
     --point-in-time YYYY-MM-DDTHH:MM:SS
   ```

3. **Validate data integrity**

4. **Update connection strings**, redeploy

5. **Resume service**

**Estimated RTO:** 1-2 hours  
**Estimated RPO:** Up to 5 minutes (time since last backup)

#### Scenario 3: Accidental Document Deletion

**Impact:** User documents lost

**Recovery Steps:**

1. **Check object versioning**:
   ```bash
   gsutil ls -a gs://healthatlas-documents-prod/raw/USER_ID/DOCUMENT_ID
   ```

2. **Restore previous version**:
   ```bash
   gsutil cp gs://healthatlas-documents-prod/raw/FILE#VERSION \
     gs://healthatlas-documents-prod/raw/FILE
   ```

3. **Update database metadata** (mark as not deleted)

**Estimated RTO:** 5-10 minutes  
**Estimated RPO:** 0 (versioning captures all changes)

### Testing Recovery Procedures

**Quarterly Disaster Recovery Drills:**

1. **Q1:** Test database restore from backup
2. **Q2:** Test regional failover (primary → secondary)
3. **Q3:** Test multi-region deployment
4. **Q4:** Full disaster recovery simulation (all scenarios)

---

## Cost Estimation

### Monthly Cost Breakdown (Production)

#### Scenario 1: Small Scale (1,000 users, 50K req/day)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **Cloud Run** | Min: 1, Max: 10, 2 vCPU, 2 GB | $56 |
| **Cloud SQL** | db-custom-2-8192 (2 vCPU, 8 GB RAM) | $150 |
| **Cloud Storage** | 100 GB storage, 10 GB egress | $5 |
| **Document AI** | 500 pages/month | $15 |
| **Cloud Logging** | 10 GB logs/month | $5 |
| **Load Balancer** | Minimal usage | $18 |
| **Total** | | **$249/month** |

#### Scenario 2: Medium Scale (10,000 users, 500K req/day)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **Cloud Run** | Min: 2, Max: 50, 2 vCPU, 2 GB | $180 |
| **Cloud SQL** | db-custom-4-16384 (4 vCPU, 16 GB RAM) | $300 |
| **Cloud Storage** | 1 TB storage, 100 GB egress | $35 |
| **Document AI** | 5,000 pages/month | $150 |
| **Cloud Logging** | 50 GB logs/month | $25 |
| **Load Balancer** | Moderate usage | $50 |
| **Cloud CDN** | (Optional) | $20 |
| **Total** | | **$760/month** |

#### Scenario 3: Large Scale (100,000 users, 5M req/day)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **Cloud Run** | Min: 10, Max: 100, 4 vCPU, 4 GB | $1,200 |
| **Cloud SQL** | db-custom-16-65536 (16 vCPU, 64 GB RAM) | $1,500 |
| **Cloud Storage** | 10 TB storage, 1 TB egress | $350 |
| **Document AI** | 50,000 pages/month | $1,500 |
| **Cloud Logging** | 200 GB logs/month | $100 |
| **Load Balancer** | High usage | $200 |
| **Cloud CDN** | | $100 |
| **Memorystore (Redis)** | 5 GB, High Availability | $150 |
| **Total** | | **$5,100/month** |

### Cost Optimization Tips

1. **Committed Use Discounts** (Cloud SQL)
   - 1-year commitment: 25% discount
   - 3-year commitment: 52% discount
   - Applies to: Cloud SQL, Compute Engine

2. **Scale to Zero** (Cloud Run)
   - Set `--min-instances 0` during off-peak hours (if acceptable)
   - Saves: ~$30-50/month

3. **Cloud Storage Nearline** (for old documents)
   - Move documents older than 1 year to Nearline storage class
   - Savings: 50% on storage costs

4. **Document AI Batch Processing**
   - Use batch API for non-urgent documents
   - Savings: 40% vs. synchronous processing

5. **Audit Log Retention**
   - Use lifecycle policies to move logs to Coldline after 1 year
   - Savings: 70% on long-term log storage

---

## Pre-Production Checklist

### 1. Legal & Compliance

- [ ] **BAA signed with Google Cloud** ([Request here](https://cloud.google.com/terms/hipaa-baa))
- [ ] **Privacy Policy** published and accessible
- [ ] **Terms of Service** published
- [ ] **HIPAA Security Risk Assessment** completed
- [ ] **Breach Notification Procedures** documented
- [ ] **Staff HIPAA training** completed (all engineers)

### 2. Security & Access Control

- [ ] **TLS 1.3** enforced (HTTPS only)
- [ ] **Security headers** configured (Helmet)
- [ ] **Rate limiting** enabled and tuned
- [ ] **Cloud Armor** configured (WAF, DDoS protection)
- [ ] **IAM roles** configured (least privilege)
- [ ] **Multi-factor authentication** enforced for GCP console access
- [ ] **Secret Manager** configured (all secrets migrated)
- [ ] **Database encryption** verified (at rest and in transit)
- [ ] **Audit logging** enabled (Cloud Logging with 7-year retention)
- [ ] **VPC Service Controls** evaluated (optional, high security)

### 3. Infrastructure

- [ ] **Cloud Run** deployed to production region (us-central1)
- [ ] **Cloud SQL** configured (HA, backups, point-in-time recovery)
- [ ] **Cloud Storage** buckets created (lifecycle policies set)
- [ ] **Document AI** processor created and tested
- [ ] **Load Balancer** configured with SSL certificate
- [ ] **DNS** configured (api.healthatlas.com)
- [ ] **CDN** configured (optional, for static assets)
- [ ] **Redis (Memorystore)** provisioned (optional, for caching)

### 4. Monitoring & Alerting

- [ ] **Cloud Monitoring** dashboards created
- [ ] **Uptime checks** configured (health endpoint)
- [ ] **Alerting policies** created (CPU, errors, latency)
- [ ] **PagerDuty/Slack** integration configured
- [ ] **Log-based alerts** configured (failed logins, unauthorized access)
- [ ] **Cloud Trace** enabled (APM)
- [ ] **Error tracking** configured (Sentry or equivalent)

### 5. Data & Backups

- [ ] **Database backups** automated (daily, 30-day retention)
- [ ] **Point-in-time recovery** enabled (Cloud SQL)
- [ ] **Backup restore** tested (quarterly drill)
- [ ] **Object versioning** enabled (Cloud Storage)
- [ ] **Disaster recovery** plan documented and tested

### 6. Development & Operations

- [ ] **CI/CD pipeline** configured (GitHub Actions)
- [ ] **Database migrations** automated (TypeORM)
- [ ] **Rollback procedures** documented
- [ ] **Canary deployments** configured (traffic splitting)
- [ ] **Smoke tests** automated in CI/CD
- [ ] **Load testing** completed (1000 req/s sustained)
- [ ] **Penetration testing** completed (third-party audit)

### 7. Documentation

- [ ] **API documentation** published (Swagger UI)
- [ ] **Deployment runbook** created
- [ ] **Incident response playbook** documented
- [ ] **On-call rotation** established
- [ ] **Architecture diagrams** updated
- [ ] **Environment variables** documented (this file)

### 8. Testing

- [ ] **Unit tests** passing (> 80% coverage)
- [ ] **Integration tests** passing
- [ ] **E2E tests** passing
- [ ] **Load tests** passing (target: 1000 req/s)
- [ ] **Security scan** completed (OWASP ZAP or equivalent)
- [ ] **Dependency audit** completed (`npm audit fix`)

### 9. Go-Live Preparation

- [ ] **Change management** ticket created
- [ ] **Stakeholder notification** sent (engineering, product, compliance)
- [ ] **Rollback plan** reviewed
- [ ] **Post-deployment verification** steps documented
- [ ] **Maintenance window** scheduled (if needed)

---

## Appendix

### Useful Commands

```bash
# View Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=keystone-core-api" --limit 50 --format json

# Scale Cloud Run
gcloud run services update keystone-core-api \
  --min-instances 5 \
  --max-instances 200 \
  --region us-central1

# View metrics
gcloud monitoring time-series list \
  --filter 'metric.type="run.googleapis.com/request_count"'

# Connect to Cloud SQL
gcloud sql connect keystone-db --user=postgres

# List Cloud Run revisions
gcloud run revisions list \
  --service keystone-core-api \
  --region us-central1

# Traffic splitting (canary deployment)
gcloud run services update-traffic keystone-core-api \
  --to-revisions keystone-core-api-00010=90,keystone-core-api-00011=10 \
  --region us-central1
```

### Additional Resources

- [Google Cloud HIPAA Compliance](https://cloud.google.com/security/compliance/hipaa)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Best Practices](https://cloud.google.com/sql/docs/postgres/best-practices)
- [NestJS Production Practices](https://docs.nestjs.com/faq/serverless)
- [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)

---

**Document Version:** 1.0  
**Last Updated:** November 14, 2025  
**Author:** HealthAtlas Engineering Team  
**Review Cycle:** Quarterly









