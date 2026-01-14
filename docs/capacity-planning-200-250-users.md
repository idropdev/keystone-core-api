# Capacity Planning: 200-250 Concurrent Users (Corrected)

**Target:** 200-250 concurrent users  
**Region:** us-central1 (Cloud Run + Cloud SQL)  
**Architecture:** Cloud Run (NestJS + TypeORM) → Cloud SQL PostgreSQL (Unix socket)

---

## 1. Executive Summary (Corrected)

### Cloud Run (API Service)
- **Region:** us-central1
- **CPU:** 2 vCPU per instance
- **Memory:** 2 GiB per instance
- **Concurrency:** 50 (start conservative, tune later)
- **Min Instances:** 2
- **Max Instances:** 15 (for spike headroom)
- **DB Pool per Instance:** 15 connections
- **Estimated Monthly Cost:** ~$90-120

### Cloud SQL (PostgreSQL)
- **Tier:** db-custom-2-8192 (2 vCPU, 8 GiB RAM)
- **Availability:** Zonal (baseline) or Regional (HA, recommended for prod)
- **Max Connections (DB flag):** 200-300
- **Estimated Monthly Cost:**
  - **Zonal:** ~$150-170
  - **Regional (HA):** ~$300-330

### Total Infrastructure Cost

- **Non-HA:** ~$280-330/month
- **HA:** ~$420-480/month

---

## 2. Key Corrections Applied

### ❌ Previous Issues
- Treated us-central1-a (zone) as deployable region
- Assumed DB pool size was global (it's per instance)
- Equated Cloud Run concurrency with RPS
- Oversized DB pools per instance (100 connections × autoscaling = disaster)
- Didn't explicitly cap Cloud SQL max_connections

### ✅ Corrections
- Use region **us-central1** (correct region, not zone)
- Size DB pool **per instance**, not globally
- Use measured RPS under p95 latency, not theoretical throughput
- Explicitly control Cloud SQL connection budget
- Scale via instances, not giant pools

---

## 3. Understanding "200-250 Concurrent Users" (Clarified)

**Concurrent users ≠ RPS**

**Assumptions:**
- Active session: 5-30 minutes
- Bursty interaction (scroll, save, upload, OCR trigger)
- Many users idle at any moment

### Revised Peak Load Estimate

| Segment | Users | Req/sec per user | Total Req/sec |
|---------|-------|------------------|---------------|
| Passive browsing (60%) | 150 | 0.01 | 1.5 |
| Active CRUD (30%) | 75 | 0.15 | 11.25 |
| Heavy ops (10%) | 25 | 0.4 | 10 |
| **Total** | | | **~23 req/sec** |

**Apply 2× safety factor:**

**Target peak capacity: 45-50 req/sec**

**Round up for retries/background sync:**

**Design target: ~60 req/sec**

---

## 4. Cloud Run Capacity (Corrected Model)

### Concurrency ≠ RPS

- **Concurrency** = in-flight requests (requests being processed simultaneously)
- **RPS** depends on latency distribution

### Conservative Starting Point

- **Concurrency:** 50
- **p95 target latency:** ≤ 500 ms

**At p95 = 500 ms:**

1 request ≈ 0.5 seconds  
50 concurrent → ~100 req/sec theoretical ceiling

**Realistically (DB + external calls):**
- Safe sustained capacity: **~30-50 req/sec per instance**

### Instances Required

**Target peak:** 60 req/sec  
**Measured per instance:** ~35 req/sec  
**Instances needed:** ~2

**Add redundancy + headroom:**
- **Min:** 2
- **Typical:** 3
- **Spike:** 15 (max instances)

---

## 5. Cloud Run Resource Sizing

### CPU: 2 vCPU

- Node.js async I/O + GC benefit from extra core
- Prevents GC pauses under load
- Enough for moderate JSON serialization + crypto

### Memory: 2 GiB

**Breakdown:**
- Base NestJS runtime: ~200 MB
- TypeORM + entities: ~100 MB
- DB pool (15 conns): ~30 MB
- Buffers / JSON payloads: ~300-500 MB
- Headroom + GC: ~800 MB+

**Result:** ~1.2 GB typical usage → 2 GB safe

---

## 6. Database Capacity (Corrected)

### 🔴 Critical Fix: Pool Multiplication

**Before (wrong):**
```
100 connections × 10 instances = 1000 connections ❌
```

**After (correct):**
```
15 connections × 15 instances (max) = 225 connections ✅
```

### DB Connection Budget

**Peak DB activity:**
- 60 req/sec peak
- ~70% touch DB → 42 queries/sec
- Avg query time: 100 ms

**Concurrent DB usage:**
```
42 × 0.1 = ~4-5 active connections
```

**Add safety:**
- Background jobs: +5
- Admin access: +5
- Spikes: +20
- Idle pool overhead: +10

**Real need:** ~45-60 active connections

**Provisioned headroom:** 225 connections (15 instances × 15 connections) with additional safety margin up to 250

### Cloud SQL Spec Justification

**Tier:** db-custom-2-8192

- **CPU:** Handles ~30-60 concurrent queries comfortably
- **RAM:**
  - shared_buffers (~25%): ~2 GB
  - work_mem (4 MB × 250 max_connections): ~1 GB (worst case: all connections active with sorting/joins)
  - OS + Postgres: ~1 GB
  - Cache + temp: ~1-2 GB
  - **Total:** ~5-6 GB used → 8 GB safe
  - **Note:** max_connections=250 is validated against available memory (work_mem × max_connections should not exceed available RAM)

---

## 7. Scaling Configuration (Final)

### Cloud Run

```bash
--region us-central1
--cpu 2
--memory 2Gi
--concurrency 50
--min-instances 2
--max-instances 15
```

### App Environment Variables

```env
DATABASE_MAX_CONNECTIONS=15
DATABASE_SYNCHRONIZE=false
DATABASE_SSL_ENABLED=true
DATABASE_REJECT_UNAUTHORIZED=true
```

**⚠️ Important: SSL Configuration for Unix Socket Connections**

For Cloud Run → Cloud SQL via Cloud SQL connector (Unix socket path `/cloudsql/PROJECT:REGION:INSTANCE`), transport security is provided by the platform connector. The `DATABASE_SSL_ENABLED=true` and `DATABASE_REJECT_UNAUTHORIZED=true` settings may be:
- Unnecessary (security handled by Cloud SQL connector)
- Sometimes cause confusion if your driver interprets the local socket as needing TLS cert verification

**Recommendation:**
- Keep the SSL flags for consistency and explicit configuration
- **Test in staging** to verify driver behavior
- For TCP/IP direct connections (not using Unix socket), app-level TLS settings and cert validation are **mandatory** (required for HIPAA compliance)

**Verification:** Check that your TypeORM/PostgreSQL driver connects successfully without SSL certificate errors when using Unix socket. If you see certificate validation errors, you may need to adjust the SSL configuration object passed to TypeORM.

**TypeORM Pool Behavior:**
- **Critical:** Ensure TypeORM is configured to reuse a **single global DataSource** per container, not re-initialize pools per request
- TypeORM uses `pg` (node-postgres) under the hood, which creates a connection pool
- Each container should have **one DataSource instance** that is shared across all requests
- Re-initializing DataSource per request creates multiple pools per instance, defeating connection pooling and exhausting DB connections
- In NestJS, the DataSource should be provided as a singleton via dependency injection (this is the default behavior)

### Cloud SQL Database Flags

```bash
max_connections=250   # handles 15 instances × 15 connections = 225 + headroom
# Start at 200 if max instances is 10, increase to 250-300 if scaling to 15+
# Note: Validate max_connections against available memory (work_mem × connections)
#       to avoid overcommit under worst-case workloads
```

### Full Deployment Command

```bash
# Cloud Run Deployment
gcloud run deploy keystone-core-api \
  --image gcr.io/PROJECT_ID/keystone-core-api:latest \
  --region us-central1 \
  --platform managed \
  --min-instances 2 \
  --max-instances 15 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 50 \
  --service-account keystone-api@PROJECT_ID.iam.gserviceaccount.com \
  --add-cloudsql-instances PROJECT_ID:us-central1:keystone-db \
  --set-env-vars \
    NODE_ENV=production,\
    DATABASE_MAX_CONNECTIONS=15,\
    DATABASE_SYNCHRONIZE=false,\
    DATABASE_SSL_ENABLED=true,\
    DATABASE_REJECT_UNAUTHORIZED=true
```

```bash
# Cloud SQL Instance (Zonal - Baseline)
# Note: --zone flag is optional; Cloud SQL will auto-place if omitted
gcloud sql instances create keystone-db \
  --database-version POSTGRES_15 \
  --tier db-custom-2-8192 \
  --region us-central1 \
  --network default \
  --no-assign-ip \
  --backup \
  --enable-point-in-time-recovery \
  --retained-backups-count 30 \
  --database-flags max_connections=250
```

```bash
# Cloud SQL Instance (Regional - HA, Recommended for Production)
gcloud sql instances create keystone-db \
  --database-version POSTGRES_15 \
  --tier db-custom-2-8192 \
  --region us-central1 \
  --network default \
  --no-assign-ip \
  --availability-type REGIONAL \
  --backup \
  --enable-point-in-time-recovery \
  --retained-backups-count 30 \
  --database-flags max_connections=250
```

---

## 8. Cost Re-Estimate (Corrected)

### Cloud Run (Monthly)

**Assumptions:**
- 2 min instances × 730 hours = 1,460 instance-hours
- Average extra load (1 instance) = 730 instance-hours
- Spikes (10% of time, 8 extra instances) = 73 hours × 8 = 584 instance-hours
- Total: ~2,774 instance-hours at 2 vCPU, 2 GB

**CPU Cost:**
```
Base: 2 instances × 2 vCPU × 730 hours × $0.00002400/vCPU-second = $49
Load: 1 instance × 2 vCPU × 730 hours × $0.00002400 = $25
Spikes: 8 instances × 2 vCPU × 73 hours × $0.00002400 = $10
Total CPU: ~$84/month
```

**Memory Cost:**
```
Base: 2 instances × 2 GB × 730 hours × $0.00000250/GB-second = $5
Load: 1 instance × 2 GB × 730 hours × $0.00000250 = $2.50
Spikes: 8 instances × 2 GB × 73 hours × $0.00000250 = $1
Total Memory: ~$8.50/month
```

**Request Cost:**
```
Estimated: 750K requests/month × $0.40/million = $0.30/month
```

**Networking (Egress):**
```
Estimated: 50 GB/month × $0.12/GB = $6/month
```

**Cloud Run total: ~$95-110/month**

**⚠️ Pricing Notes:**
- Costs are estimates; validate with [GCP Pricing Calculator](https://cloud.google.com/products/calculator)
- Cloud Run has a free tier (including vCPU/GiB seconds and 2M requests/month)
- Pricing varies by region/tier
- Min-instances create baseline billed time (always-on costs)
- Actual costs depend on real usage patterns, request duration, and traffic spikes
- **CPU Allocation:** CPU is allocated per request by default. If background work (queues, schedulers) is ever added, evaluate "CPU always allocated" vs request-based CPU allocation to avoid throttling surprises during concurrent request handling

### Cloud SQL

| Mode | Monthly Base | Storage (100 GB) | Total |
|------|--------------|------------------|-------|
| **Zonal** | ~$150 | ~$17 | **~$167** |
| **Regional (HA)** | ~$300 | ~$20 | **~$320** |

**⚠️ Cloud SQL Pricing Notes:**
- Costs depend on **Cloud SQL edition** (Enterprise vs Enterprise Plus) and HA setting
- Edition affects SLA, availability guarantees, and cost structure
- Enterprise Plus provides additional features (automated backups, point-in-time recovery, etc.)
- Regional (HA) instances cost approximately 2× zonal instances
- Pricing varies by region; validate with GCP Pricing Calculator

### Total Infrastructure Cost

**Non-HA (Zonal DB):**
```
Cloud Run:     $95-110/month
Cloud SQL:     $167/month
Cloud Storage: $10/month
Secret Manager: $3/month
Cloud Logging:  $15/month
─────────────────────────
Total:         ~$280-305/month
```

**HA (Regional DB):**
```
Cloud Run:     $95-110/month
Cloud SQL:     $320/month
Cloud Storage: $10/month
Secret Manager: $3/month
Cloud Logging:  $15/month
─────────────────────────
Total:         ~$440-460/month
```

**Plus variable costs:**
- Document AI (OCR): ~$15-50/month (depends on document volume)
- **Non-HA Total: ~$300-350/month**
- **HA Total: ~$460-510/month**

---

## 9. Monitoring Thresholds (Revised)

### Cloud Run

- **p95 latency > 500 ms** → investigate
- **Error rate > 1%** → alert
- **Instance count pinned at max (15) > 10 min** → consider increasing max instances or concurrency
- **CPU utilization > 80%** → consider increasing CPU or instances
- **Memory utilization > 85%** → consider increasing memory

### Cloud SQL

- **Active connections > 180** (72% of 250 limit) → alert
- **CPU > 75% sustained** → consider upgrading tier
- **p95 query time > 300 ms** → optimize queries
- **Memory utilization > 90%** → consider increasing RAM

### Connection Pool Monitoring

**Per Cloud Run Instance:**
- Monitor `pg_stat_activity` to track active connections per instance
- Alert if any instance uses > 80% of its pool (12/15 connections)

**Aggregate:**
- Monitor total active connections across all instances
- Alert if total > 180 connections (72% of 250 limit)

---

## 10. Performance Targets

### API Response Times (SLA)

| Endpoint Type | Target p50 | Target p95 | Target p99 |
|---------------|------------|------------|------------|
| **Authentication** | < 200ms | < 500ms | < 1s |
| **Data CRUD** | < 150ms | < 400ms | < 800ms |
| **Document Status** | < 100ms | < 300ms | < 600ms |
| **Document Upload** | < 500ms | < 2s | < 5s |
| **OCR Trigger** | < 200ms | < 500ms | < 1s |

### Database Performance

- **Query time (p95):** < 200ms
- **Connection pool utilization:** < 80% (per instance: < 12/15)
- **CPU utilization:** < 70%
- **Memory utilization:** < 85%

---

## 11. Testing & Validation

### Load Testing Recommendations

**Tools:**
- Apache JMeter
- k6
- Artillery.io

**Test Scenarios:**
1. **Steady State:** 200 users × 30 minutes (baseline)
2. **Spike Test:** 0 → 250 users in 1 minute (cold start + scale-up)
3. **Sustained Load:** 250 users × 1 hour (memory leaks, connection pool)
4. **Stress Test:** 250 → 350 users (beyond capacity, verify graceful degradation)
5. **Connection Pool Test:** Verify no instance exceeds 15 connections

**Success Criteria:**
- ✅ p95 latency < 500ms
- ✅ Error rate < 1%
- ✅ No memory leaks after 1 hour
- ✅ Connection pool stays < 80% utilized per instance (max 12/15)
- ✅ Total DB connections stay < 180 (72% of 250 limit)
- ✅ Autoscaling works correctly (scales up/down)

---

## 12. Optimization Recommendations

### Immediate Optimizations

1. **Connection Pooling:** Configure `DATABASE_MAX_CONNECTIONS=15` per instance ✅
   - **TypeORM Configuration:** Ensure TypeORM uses a single global DataSource per container (NestJS default is singleton, but verify)
   - **Pool Validation:** Validate `max_connections` against available memory (work_mem × max_connections) to avoid overcommit
2. **Database Indexing:** Ensure all frequently queried columns are indexed
3. **Query Optimization:** Use `EXPLAIN ANALYZE` to identify slow queries
4. **Cloud SQL max_connections:** Set to 250 (provides headroom for 15 instances × 15 connections = 225 total; can increase to 300 if needed)
   - **Memory Validation:** work_mem (4 MB) × max_connections (250) = ~1 GB worst case, fits within 8 GB RAM
5. **Response Compression:** Enable gzip compression for API responses

### Future Optimizations (when scaling beyond 250 users)

1. **Redis/Memorystore:** Add caching layer before touching DB size
2. **Read Replicas:** Add Cloud SQL read replicas when read:write ratio > 3:1
3. **CDN:** Use Cloud CDN for static assets
4. **Connection Pool Tuning:** Increase per-instance pool only if monitoring shows saturation
5. **Database Sharding:** Partition data by user_id or region (only if > 10K users)
6. **Microservices:** Split into separate services if single service becomes bottleneck

### Scaling Strategy

**When to increase Cloud Run concurrency:**
- Monitor shows instances consistently handling < 40 req/sec
- p95 latency stays < 300ms
- Can safely increase from 50 → 60 → 80

**Note on Background Work:**
- If background work (queues, schedulers) is ever added, evaluate "CPU always allocated" vs request-based CPU allocation
- Request-based CPU (default) may throttle background tasks during request spikes
- Consider dedicated background worker instances or CPU allocation adjustments

**When to increase DB pool per instance:**
- Monitoring shows instances hitting 15/15 connections regularly
- Total DB connections consistently < 120 (have headroom)
- Can increase from 15 → 20 → 25

**When to increase Cloud SQL max_connections:**
- Total connections approaching limit (200+ of 250)
- All instances are using their pools efficiently
- Scaling beyond 15 instances
- Increase to 300

**When to upgrade DB tier:**
- CPU > 75% sustained for 1+ hour
- Memory > 90% sustained
- p95 query time > 500ms despite query optimization
- Upgrade to db-custom-4-16384 (4 vCPU, 16 GB RAM)

---

## 13. Final Verdict

This setup is:

✅ **Correctly scoped** for 200-250 concurrent users  
✅ **Safe** against Cloud Run autoscaling DB overload  
✅ **Cost-efficient** without premature overprovisioning  
✅ **HIPAA-aligned** (TLS, no public IP, Secret Manager)  
✅ **Easy to scale** beyond 250 users

### Scaling Past This Point

1. **Increase Cloud Run max instances** (from 15 → 20 → 25+)
2. **Increase DB connections cautiously** (monitor first, then adjust)
3. **Add Redis/Memorystore** before touching DB size
4. **Only resize DB tier** when CPU or memory is consistently saturated

### Key Takeaways

- **DB pool is per-instance:** 15 connections × 15 instances (max) = 225 total potential (not 15 total)
- **Concurrency ≠ RPS:** 50 concurrency handles ~30-50 req/sec realistically
- **Region vs Zone:** Use `us-central1` (region), not `us-central1-a` (zone)
- **Conservative start:** Start with 50 concurrency, 15 DB pool, 250 max_connections; tune based on real metrics
- **Monitor before scaling:** Don't overprovision; scale based on actual usage patterns

---

## Summary Table

| Component | Specification | Cost/Month (Non-HA) | Cost/Month (HA) |
|-----------|---------------|---------------------|-----------------|
| **Cloud Run** | 2-15 instances, 2 vCPU, 2 GB each, concurrency 50 | ~$95-110 | ~$95-110 |
| **Cloud SQL** | db-custom-2-8192 (2 vCPU, 8 GB), 250 max_connections | ~$167 | ~$320 |
| **Cloud Storage** | 100 GB standard | ~$10 | ~$10 |
| **Secret Manager** | 5 secrets | ~$3 | ~$3 |
| **Cloud Logging** | 50 GB/month | ~$15 | ~$15 |
| **Document AI** | Variable (estimate) | ~$15-50 | ~$15-50 |
| **Total** | | **~$300-350** | **~$460-510** |

---

## 14. Important Notes & Caveats

### Pricing Disclaimers

- **All costs are estimates:** Actual costs depend on real usage patterns, request duration, traffic spikes, and region-specific pricing
- **Use GCP Pricing Calculator:** Validate all cost estimates with the [official GCP Pricing Calculator](https://cloud.google.com/products/calculator)
- **Free tier applies:** Cloud Run includes a free tier (vCPU/GiB seconds and 2M requests/month)
- **Min-instances create baseline costs:** Always-on instances (min-instances > 0) create baseline billed time

### SSL/TLS Configuration Notes

**For Cloud Run → Cloud SQL via Unix Socket:**
- Transport security is **provided by the Cloud SQL connector** (platform-managed)
- `DATABASE_SSL_ENABLED=true` may be unnecessary but is kept for explicit configuration
- **Test in staging** to verify your driver (TypeORM/PostgreSQL) handles Unix socket connections correctly
- Some drivers may interpret local socket paths as needing TLS cert verification (causing errors)

**For TCP/IP Direct Connections:**
- App-level TLS settings (`DATABASE_SSL_ENABLED=true`, `DATABASE_REJECT_UNAUTHORIZED=true`) are **mandatory**
- Required for HIPAA compliance (encryption in transit)
- Certificate files (`DATABASE_CA`, `DATABASE_KEY`, `DATABASE_CERT`) must be provided

### Cloud SQL Edition & Zone Selection

- **Edition affects cost/SLA:** Cloud SQL has editions (Enterprise vs Enterprise Plus) that affect pricing, availability guarantees, and features
- **Zone selection:** `--zone` flag is optional for zonal instances; Cloud SQL will auto-place if omitted
- **Most important:** Use `--region us-central1` and `--no-assign-ip` (no public IP for security)
- **CLI differences:** Some older CLI versions used `--gce-zone` (deprecated); modern CLI uses `--zone` or omits it

### TypeORM SSL Configuration

If you encounter SSL certificate errors when connecting via Unix socket, you may need to adjust the SSL configuration object passed to TypeORM. Share your TypeORM SSL config snippet for review if you need assistance with the safest settings combination for Unix socket vs TCP/IP connections.

---

## Next Steps

1. **Deploy** with these corrected specifications
2. **Configure monitoring** for connection pool usage (per instance + aggregate)
3. **Test SSL/Unix socket connection** in staging to verify driver behavior
4. **Run load tests** to validate assumptions
5. **Monitor metrics** for 1-2 weeks
6. **Tune based on real data:**
   - Adjust `--concurrency` if needed (50 → 60 → 80)
   - Adjust `DATABASE_MAX_CONNECTIONS` per instance if needed (15 → 20)
   - Adjust Cloud SQL `max_connections` if needed (250 → 300)
   - Adjust `--max-instances` if traffic consistently hits the limit (15 → 20+)
7. **Optimize database queries** based on slow query logs
8. **Validate actual costs** using GCP Pricing Calculator based on real usage
