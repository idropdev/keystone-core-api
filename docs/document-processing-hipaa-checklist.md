# Document Processing - HIPAA Compliance Checklist

## ✅ Required Before Production

### Google Cloud Platform Configuration

- [ ] **Sign BAA with Google Cloud**
  - Required for HIPAA compliance
  - Covers Document AI and Cloud Storage
  - [Request here](https://cloud.google.com/terms/hipaa-baa)

- [ ] **Configure Cloud Storage Buckets**
  - [ ] Enable Uniform Bucket-Level Access (UBLA)
  - [ ] Server-side encryption enabled (Google-managed keys)
  - [ ] Audit logging enabled (Data Access logs)
  - [ ] Lifecycle policy: Delete objects after 8 years
  - [ ] Regional location (no multi-region for PHI)
  - [ ] Verify: `gsutil lifecycle get gs://BUCKET_NAME`

- [ ] **Configure Document AI Processor**
  - [ ] Verify processor is HIPAA-eligible
  - [ ] Processor type: Enterprise Document OCR (recommended)
  - [ ] Location: Same region as storage buckets
  - [ ] Audit logging enabled

- [ ] **IAM & Security**
  - [ ] Service account with minimal permissions:
    - `roles/documentai.apiUser`
    - `roles/storage.objectCreator` (specific bucket)
    - `roles/storage.objectViewer` (specific bucket)
  - [ ] Workload Identity configured (GKE) OR
  - [ ] Service account key secured (GCP Secret Manager)
  - [ ] No public access to buckets
  - [ ] VPC Service Controls enabled (optional, high security)

### Application Configuration

- [ ] **Environment Variables**
  - [ ] All DOC_PROCESSING_* variables set
  - [ ] Secrets stored in GCP Secret Manager (not env vars in prod)
  - [ ] No hardcoded credentials in code

- [ ] **Database**
  - [ ] Run migration: `CreateDocumentsTables`
  - [ ] Verify indexes created
  - [ ] PostgreSQL encryption at rest enabled
  - [ ] SSL/TLS connections required

- [ ] **Audit Logging**
  - [ ] All document events logged
  - [ ] Logs forwarded to GCP Cloud Logging
  - [ ] Log retention: 6+ years
  - [ ] No PHI in log messages (verify with sampling)

- [ ] **Rate Limiting**
  - [ ] Upload endpoint: 10 requests/minute
  - [ ] Throttler configured globally
  - [ ] Consider Redis backing for multi-instance

- [ ] **Session Validation**
  - [ ] JWT strategy validates session on every request
  - [ ] Logout immediately invalidates tokens
  - [ ] Session cleanup job running

### Testing & Validation

- [ ] **Security Testing**
  - [ ] Penetration testing completed
  - [ ] Authorization tests: Users cannot access others' documents
  - [ ] File validation tests: Only allowed MIME types
  - [ ] Rate limiting tests: Verify 429 responses

- [ ] **HIPAA Testing**
  - [ ] Verify no PHI in logs (sample 1000 log entries)
  - [ ] Verify no GCS URIs in API responses
  - [ ] Verify no internal errors exposed to clients
  - [ ] Test hard delete: Verify files deleted from GCS + DB

- [ ] **OCR Accuracy**
  - [ ] Test with sample medical documents
  - [ ] Verify entity extraction accuracy
  - [ ] Test both sync and batch modes
  - [ ] Handle OCR failures gracefully

### Monitoring & Alerts

- [ ] **GCP Monitoring**
  - [ ] Alert: Document AI API errors > 5%
  - [ ] Alert: Storage upload failures > 1%
  - [ ] Alert: Processing time > 5 minutes (batch)
  - [ ] Alert: Hard delete job failures

- [ ] **Application Monitoring**
  - [ ] Alert: Document processing stuck (status=PROCESSING > 1 hour)
  - [ ] Dashboard: Upload rate, success rate, avg processing time
  - [ ] Dashboard: Storage usage, cost tracking

### Legal & Compliance

- [ ] **Documentation**
  - [ ] Data flow diagram (showing PHI handling)
  - [ ] Risk assessment completed
  - [ ] Privacy impact assessment
  - [ ] Breach notification procedures

- [ ] **Policies**
  - [ ] Retention policy documented (8 years)
  - [ ] Data deletion procedures
  - [ ] Access control policy
  - [ ] Incident response plan

- [ ] **Training**
  - [ ] Engineering team trained on HIPAA requirements
  - [ ] DevOps trained on secure deployment
  - [ ] On-call trained on incident response

## 🔒 Ongoing Compliance

- [ ] **Regular Reviews**
  - [ ] Quarterly: Review audit logs for suspicious activity
  - [ ] Quarterly: Review IAM permissions
  - [ ] Annually: Re-certify HIPAA compliance
  - [ ] Annually: Review and update BAA with Google

- [ ] **Maintenance**
  - [ ] Weekly: Verify hard delete cron job running
  - [ ] Monthly: Review failed processing jobs
  - [ ] Monthly: Cost analysis (Document AI usage)

## 📋 Audit Evidence

Maintain documentation for compliance audits:

1. **BAA with Google Cloud** (signed copy)
2. **GCS bucket configuration** (lifecycle, encryption, UBLA)
3. **IAM policies** (service account permissions)
4. **Sample audit logs** (anonymized, showing no PHI)
5. **Penetration test results**
6. **Incident response playbook**
7. **Employee training records**

## 🛠️ Configuration Commands

### Create Buckets with HIPAA Settings

```bash
# Create main documents bucket
gsutil mb -l us-central1 -p YOUR_PROJECT_ID gs://healthatlas-documents-prod

# Create Document AI output bucket
gsutil mb -l us-central1 -p YOUR_PROJECT_ID gs://healthatlas-docai-output-prod

# Enable Uniform Bucket-Level Access
gsutil uniformbucketlevelaccess set on gs://healthatlas-documents-prod
gsutil uniformbucketlevelaccess set on gs://healthatlas-docai-output-prod

# Enable versioning (optional, for recovery)
gsutil versioning set on gs://healthatlas-documents-prod
```

### Configure Lifecycle Policy (8-Year Retention)

Create `lifecycle.json`:

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {
          "type": "Delete"
        },
        "condition": {
          "age": 2920,
          "matchesPrefix": ["raw/", "processed/"]
        }
      }
    ]
  }
}
```

Apply:

```bash
gsutil lifecycle set lifecycle.json gs://healthatlas-documents-prod
```

### Enable Audit Logging

```bash
# Enable Data Access logs for buckets
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

### Configure IAM

```bash
# Grant Document AI permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/documentai.apiUser"

# Grant Storage permissions (bucket-specific)
gsutil iam ch serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT.iam.gserviceaccount.com:objectCreator \
  gs://healthatlas-documents-prod

gsutil iam ch serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT.iam.gserviceaccount.com:objectViewer \
  gs://healthatlas-documents-prod
```

## 🚨 Security Incident Response

If a security incident occurs:

1. **Immediate Actions** (< 1 hour)
   - Isolate affected systems
   - Revoke compromised credentials
   - Document timeline of events

2. **Investigation** (< 24 hours)
   - Review audit logs for unauthorized access
   - Identify scope of breach (which documents/users)
   - Preserve evidence for forensics

3. **Notification** (< 60 days per HIPAA Breach Notification Rule)
   - Notify affected individuals if > 500 people affected
   - Notify HHS Office for Civil Rights
   - Media notification if > 500 people in same jurisdiction

4. **Remediation**
   - Fix security vulnerability
   - Update access controls
   - Rotate all secrets
   - Conduct post-mortem

5. **Documentation**
   - Incident report with timeline
   - Root cause analysis
   - Corrective action plan
   - Lessons learned

## 📞 Support Contacts

- **HIPAA Compliance Officer**: [Email/Phone]
- **Security Team**: [Email/Phone]
- **GCP Support**: [Support Case Link]
- **Legal/Privacy Team**: [Email/Phone]

---

**Last Updated**: [Date]  
**Next Review**: [Date + 90 days]  
**Reviewed By**: [Name/Role]


