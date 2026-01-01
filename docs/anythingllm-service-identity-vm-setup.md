# Service Identity Setup for AnythingLLM VM (Staging → Production)

This document defines the required steps to configure and verify GCP service identity authentication on the AnythingLLM VM once the staging environment is complete.

The goal is to ensure the VM can verify Google OIDC ID tokens minted by the Keystone service account using Application Default Credentials (ADC) — without using service account key files.

---

## Overview

- **Auth model**: GCP OIDC ID tokens (service-to-service)
- **Token issuer**: Google
- **Audience**: `anythingllm-internal`
- **Caller service account**: `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`
- **Verification**: `google-auth-library` inside AnythingLLM
- **Key principle**:
  - ❌ No service account keys
  - ✅ ADC + impersonation only

---

## Preconditions

Before running these steps, ensure:

1. **The service account exists**: `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`

2. **IAM is correctly configured**:
   - The service account can mint identity tokens
   - Engineers have `roles/iam.serviceAccountTokenCreator` only for local staging/debugging

3. **AnythingLLM VM has environment variables set**:
   ```env
   ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
   ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
   ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
   ```

---

## ❗ Critical Rule (Must Read)

**`GOOGLE_APPLICATION_CREDENTIALS` MUST NOT be set**

ADC impersonation will silently break if this variable exists.

This is the most common cause of invalid service identity tokens.

---

## Step-by-Step Setup (Authoritative)

### Step 1 — Ensure a clean authentication state

Run on the VM (or staging machine):

```bash
unset GOOGLE_APPLICATION_CREDENTIALS
gcloud auth application-default revoke
```

Verify the variable is gone:

```bash
echo $GOOGLE_APPLICATION_CREDENTIALS
# (should print nothing)
```

---

### Step 2 — Log in using ADC with service account impersonation

```bash
gcloud auth application-default login \
  --impersonate-service-account=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
```

- This stores credentials in: `~/.config/gcloud/application_default_credentials.json`
- No key files are created
- No secrets are copied onto the VM

---

### Step 3 — Authoritative verification (ID token mint)

This step proves the identity is correct.

```bash
gcloud auth print-identity-token \
  --audiences=anythingllm-internal \
  --impersonate-service-account=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
```

**Expected result:**
- Command succeeds
- Returns a JWT string

---

### Step 4 — Validate token payload (sanity check)

Decode the token payload:

```bash
TOKEN=$(gcloud auth print-identity-token \
  --audiences=anythingllm-internal \
  --impersonate-service-account=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com)

echo "$TOKEN" | awk -F '.' '{print $2}' | tr '_-' '/+' | base64 --decode | jq
```

**Expected payload:**

```json
{
  "aud": "anythingllm-internal",
  "email": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "iss": "https://accounts.google.com",
  "exp": <timestamp>
}
```

If email or audience do not match, stop — the VM is not correctly authenticated.

---

### Step 5 — Validate AnythingLLM admin endpoint

```bash
curl -X GET http://localhost:3001/api/v1/admin/is-multi-user-mode \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-Request-Id: staging-$(uuidgen)" \
  -H "X-Client-Service: keystone"
```

**Expected response:**

```json
{
  "isMultiUser": true
}
```

This confirms:
- Service identity verification works
- Middleware is correctly enforcing admin access
- No end-user tokens can access admin routes

---

## Production Behavior (Important)

In production, the VM will:
- Use the attached service account automatically
- Mint and verify tokens via the metadata server
- **NOT** require `gcloud auth application-default login`

The above steps are only required for staging validation and debugging.

---

## Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Invalid service identity token | `GOOGLE_APPLICATION_CREDENTIALS` set | `unset GOOGLE_APPLICATION_CREDENTIALS` |
| Token email is user email | Missing `--impersonate-service-account` | Add flag |
| Audience mismatch | Env var mismatch | Align `anythingllm-internal` |
| Token mint fails | Missing TokenCreator | Grant role |
| Works locally, fails on VM | Different auth model | Remove key files |

---

## Security Posture Summary

- ✔ No static credentials
- ✔ No service account keys
- ✔ Short-lived tokens
- ✔ Explicit audience binding
- ✔ Admin plane isolated
- ✔ HIPAA-compatible

---

## Final Notes

This setup is industry-grade service-to-service authentication and matches how:
- Google internal services authenticate
- Zero-trust SaaS platforms isolate admin planes
- HIPAA-aligned systems avoid long-lived secrets

This document should be treated as authoritative for AnythingLLM staging and production environments.

---

## Related Documentation

- [AnythingLLM Service Identity Implementation](anythingllm-service-identity-implementation.md) - How the system works
- [GCP Authentication Setup](gcp-authentication-setup.md) - General GCP auth configuration
- [AnythingLLM Service Identity Debugging](anythingllm-service-identity-debugging.md) - Troubleshooting guide









