# AnythingLLM S2S Token Delegation Setup Guide

**Project:** Keystone Core API → AnythingLLM Integration  
**Date:** 2025-01-03  
**Focus:** Complete setup requirements for Service-to-Service Token Delegation

---

## Executive Summary

This guide documents all setup requirements for Keystone Core API to correctly use S2S (Service-to-Service) Token Delegation when calling AnythingLLM endpoints. The delegation system allows Keystone to issue tokens that embed user context (roles, userId) while maintaining service-to-service authentication.

---

## Quick Reference Checklist

### ✅ Required Environment Variables

**Keystone Core API (.env):**
```bash
ENABLE_DELEGATED_TOKENS=true
ANYTHINGLLM_DELEGATED_TOKEN_SECRET=<shared-secret>
ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN=300
ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE=anythingllm
ANYTHINGLLM_BASE_URL=http://localhost:3001/api
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
AUTH_JWT_ISSUER=https://keystone.example.com  # Optional
```

**AnythingLLM (.env):**
```bash
KEYSTONE_DELEGATED_TOKEN_SECRET=<same-secret-as-keystone>
KEYSTONE_AUDIENCE=anythingllm
KEYSTONE_ISSUER=https://keystone.example.com  # Optional
```

### ✅ Secret Generation

```bash
# Generate 64-byte base64 secret
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
# Or: openssl rand -base64 64
```

**Critical:** The secret must be **identical** in both Keystone and AnythingLLM.

### ✅ Verification Steps

```bash
# Check environment variables
echo $ENABLE_DELEGATED_TOKENS  # Should be 'true'
echo $ANYTHINGLLM_DELEGATED_TOKEN_SECRET  # Should be set

# Test token issuance
curl -X GET http://localhost:3000/api/anythingllm/v1/system \
  -H "Authorization: Bearer <user-jwt-token>"
```

### ✅ Common Issues

| Issue | Solution |
|-------|----------|
| "Delegated token issuance is disabled" | Set `ENABLE_DELEGATED_TOKENS=true` |
| "Invalid token: not from Keystone service" | Verify secrets match in both services |
| "Token expired" | Check `ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN` |
| "Missing actor claim" | Verify token includes `act` claim |
| "AnythingLLM not reachable" | Check `ANYTHINGLLM_BASE_URL` and network |

---

## 1. Prerequisites

### 1.1 Infrastructure Requirements

- ✅ **Keystone Core API** running and accessible
- ✅ **AnythingLLM** instance running and accessible
- ✅ **Network connectivity** between Keystone and AnythingLLM
- ✅ **GCP Service Account** (for service identity fallback) - Optional for local development
- ✅ **Shared secret** for delegated token signing (must match between Keystone and AnythingLLM)

### 1.2 Service Versions

- Keystone Core API: Latest version with delegated token support
- AnythingLLM: Version that supports delegated token validation (see [Delegated Token Authentication Guide](delegated-tokens.md))

---

## 2. Environment Variables Configuration

### 2.1 Required Environment Variables

Add these to your `.env` file (or GCP Secret Manager in production):

```bash
# ============================================================================
# ANYTHINGLLM SERVICE IDENTITY (Service-to-Service Authentication)
# ============================================================================

# Service Authentication Mode
# Options: 'gcp' (GCP OIDC service account tokens) | 'local_jwt' (for local dev)
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp

# Service Audience (must match AnythingLLM's expected audience)
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal

# AnythingLLM Base URL (must include /api if that's the base path)
# Example: http://localhost:3001/api
# Example: https://anythingllm.internal.example.com/api
ANYTHINGLLM_BASE_URL=http://localhost:3001/api

# ============================================================================
# DELEGATED TOKEN CONFIGURATION
# ============================================================================

# Enable delegated token issuance (set to 'true' to enable)
ENABLE_DELEGATED_TOKENS=true

# Secret for signing delegated tokens (MUST match AnythingLLM's KEYSTONE_DELEGATED_TOKEN_SECRET)
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
ANYTHINGLLM_DELEGATED_TOKEN_SECRET=<your-shared-secret-here>  # <SECRET_MANAGER>

# Token expiration in seconds (default: 300 = 5 minutes)
ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN=300

# Token audience (must match AnythingLLM's KEYSTONE_AUDIENCE)
ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE=anythingllm

# ============================================================================
# JWT ISSUER CONFIGURATION (Optional)
# ============================================================================

# Issuer URL for delegated tokens (optional, but recommended for production)
# Example: https://keystone.example.com
# If not set, tokens will not include 'iss' claim
AUTH_JWT_ISSUER=https://keystone.example.com
```

### 2.2 Optional Environment Variables

```bash
# System visibility configuration
# If true, allows regular users (not just admins/managers) to access system endpoints
SYSTEM_VISIBILITY_ALLOW_USERS=false

# Thread mirroring (for chat synchronization)
ENABLE_THREAD_MIRRORING=false

# Keystone chat storage (for storing chat history in Keystone)
ENABLE_KEYSTONE_CHAT_STORAGE=false
```

---

## 3. Secret Management

### 3.1 Secret Generation

**Generate a strong secret for delegated tokens:**

```bash
# Generate 64-byte base64 secret
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

**Or using OpenSSL:**

```bash
openssl rand -base64 64
```

### 3.2 Secret Sharing

**Critical:** The `ANYTHINGLLM_DELEGATED_TOKEN_SECRET` must be **identical** in both:

1. **Keystone Core API** (as `ANYTHINGLLM_DELEGATED_TOKEN_SECRET`)
2. **AnythingLLM** (as `KEYSTONE_DELEGATED_TOKEN_SECRET`)

**Options for sharing:**

- ✅ **GCP Secret Manager** (recommended for production)
- ✅ **Kubernetes Secrets** (if using K8s)
- ✅ **Environment variables** (for local development only)
- ❌ **Never hardcode in source code**
- ❌ **Never commit to version control**

### 3.3 Secret Rotation

**HIPAA Best Practice:** Rotate secrets every 90 days:

1. Generate new secret
2. Update in GCP Secret Manager (or your secret store)
3. Update Keystone environment variable
4. Update AnythingLLM environment variable
5. Restart both services
6. Old tokens will expire naturally (within `ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN` seconds)

---

## 4. AnythingLLM Configuration

### 4.1 Required AnythingLLM Environment Variables

AnythingLLM must be configured with matching values:

```bash
# Keystone Delegated Token Configuration
KEYSTONE_DELEGATED_TOKEN_SECRET=<same-secret-as-keystone>  # MUST MATCH
KEYSTONE_ISSUER=https://keystone.example.com  # Optional, but recommended
KEYSTONE_AUDIENCE=anythingllm  # MUST MATCH ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE
```

### 4.2 AnythingLLM Middleware Setup

AnythingLLM must implement the delegated token validation middleware. See [Delegated Token Authentication Guide](delegated-tokens.md) for implementation details.

**Key requirements:**
- ✅ Validate token signature using shared secret
- ✅ Verify `sub === 'svc-keystone'` (service identity)
- ✅ Extract user context from `act` claim
- ✅ Enforce role-based authorization based on `act.roles`

---

## 5. Service Identity Configuration (Fallback)

### 5.1 GCP Service Account Setup

For production, configure GCP service account for service identity authentication:

```bash
# GCP Service Account Email
# Example: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
ANYTHINGLLM_SERVICE_ACCOUNT_EMAIL=<your-service-account-email>

# Service Account Key (for local development only)
# In production, use Workload Identity or GCP metadata server
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

### 5.2 Service Identity Flow

When `ENABLE_DELEGATED_TOKENS=false` or no user context is available, Keystone will use:

1. **GCP OIDC Token** (if `ANYTHINGLLM_SERVICE_AUTH_MODE=gcp`)
2. **Local JWT** (if `ANYTHINGLLM_SERVICE_AUTH_MODE=local_jwt` - not yet implemented)

---

## 6. Network Configuration

### 6.1 Connectivity Requirements

- ✅ Keystone must be able to reach AnythingLLM at `ANYTHINGLLM_BASE_URL`
- ✅ AnythingLLM must be able to reach Keystone (for token introspection, if used)
- ✅ HTTPS required in production (HIPAA requirement)

### 6.2 Firewall Rules

If using GCP:

```bash
# Allow Keystone → AnythingLLM
gcloud compute firewall-rules create allow-keystone-to-anythingllm \
  --allow tcp:443 \
  --source-tags keystone \
  --target-tags anythingllm \
  --description "Allow Keystone to call AnythingLLM"
```

---

## 7. Verification Steps

### 7.1 Verify Environment Variables

```bash
# Check Keystone configuration
echo $ENABLE_DELEGATED_TOKENS  # Should be 'true'
echo $ANYTHINGLLM_DELEGATED_TOKEN_SECRET  # Should be set
echo $ANYTHINGLLM_BASE_URL  # Should point to AnythingLLM

# Check AnythingLLM configuration (if accessible)
# KEYSTONE_DELEGATED_TOKEN_SECRET should match Keystone's secret
```

### 7.2 Test Token Issuance

**Test that Keystone can issue delegated tokens:**

```bash
# 1. Get a user JWT token from Keystone
curl -X POST http://localhost:3000/api/v1/auth/google/login \
  -H "Content-Type: application/json" \
  -d '{"idToken": "<google-id-token>"}'

# 2. Call a system endpoint that uses delegated tokens
curl -X GET http://localhost:3000/api/anythingllm/v1/system \
  -H "Authorization: Bearer <user-jwt-token>"

# Expected: Should return system info with delegated token in Authorization header to AnythingLLM
```

### 7.3 Test Service Identity Fallback

**Test that service identity works when no user context:**

```bash
# Call system endpoint without user JWT (should use service identity)
curl -X GET http://localhost:3000/api/anythingllm/v1/system

# Expected: Should use GCP service identity token (if configured)
```

### 7.4 Verify Token Structure

**Decode a delegated token to verify structure:**

```javascript
const jwt = require('jsonwebtoken');

// Decode token (without verification)
const decoded = jwt.decode(token, { complete: true });

console.log('Header:', decoded.header);
console.log('Payload:', JSON.stringify(decoded.payload, null, 2));

// Verify structure:
// - sub: 'svc-keystone'
// - act: { sub: userId, roles: [...] }
// - aud: 'anythingllm'
// - exp: Unix timestamp
```

---

## 8. Common Issues and Troubleshooting

### 8.1 Issue: "Delegated token issuance is disabled"

**Error:**
```
Error: Delegated token issuance is disabled. Set ENABLE_DELEGATED_TOKENS=true
```

**Solution:**
```bash
# Set in .env file
ENABLE_DELEGATED_TOKENS=true

# Restart Keystone service
```

### 8.2 Issue: "Invalid token: not from Keystone service"

**Error from AnythingLLM:**
```
401: Invalid token: not from Keystone service
```

**Solution:**
- Verify `ANYTHINGLLM_DELEGATED_TOKEN_SECRET` matches in both services
- Check that token has `sub: 'svc-keystone'`
- Verify token signature is valid

### 8.3 Issue: "Token expired"

**Error:**
```
401: Token expired
```

**Solution:**
- Check `ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN` (default: 300 seconds)
- Verify system clocks are synchronized (NTP)
- Increase expiration if needed (but keep it short for security)

### 8.4 Issue: "Missing actor claim"

**Error from AnythingLLM:**
```
401: Invalid token: missing actor claim
```

**Solution:**
- Verify token includes `act` claim with `sub` and `roles`
- Check that user context is being passed correctly
- Review `AnythingLLMAuthDelegationService.issueDelegatedToken()` implementation

### 8.5 Issue: "AnythingLLM not reachable"

**Error:**
```
ECONNREFUSED or timeout
```

**Solution:**
- Verify `ANYTHINGLLM_BASE_URL` is correct
- Check network connectivity
- Verify AnythingLLM is running
- Check firewall rules

---

## 9. Production Checklist

Before deploying to production:

- [ ] **Secrets in GCP Secret Manager** (not environment variables)
- [ ] **HTTPS enabled** for all communications
- [ ] **Secret rotation policy** established (90 days)
- [ ] **Audit logging** configured (HIPAA requirement)
- [ ] **Network security** (firewall rules, VPC)
- [ ] **Service account permissions** configured correctly
- [ ] **Token expiration** set appropriately (short-lived)
- [ ] **Monitoring** set up for token issuance failures
- [ ] **Alerting** configured for authentication errors
- [ ] **Backup secrets** stored securely
- [ ] **Documentation** updated with production URLs

---

## 10. Testing

### 10.1 Run E2E Tests

```bash
# Run system endpoints tests
npm run test:e2e -- system-endpoints.e2e-spec.ts

# Run delegated auth tests
npm run test:e2e -- delegated-auth.e2e-spec.ts

# Skip tests if AnythingLLM not available
SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e
```

### 10.2 Manual Testing

See [Section 7: Verification Steps](#7-verification-steps) for manual testing procedures.

---

## 11. Summary

### Required Configuration

| Component | Variable | Required | Notes |
|-----------|----------|----------|-------|
| **Keystone** | `ENABLE_DELEGATED_TOKENS` | ✅ | Must be `true` |
| **Keystone** | `ANYTHINGLLM_DELEGATED_TOKEN_SECRET` | ✅ | Must match AnythingLLM |
| **Keystone** | `ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE` | ✅ | Must match AnythingLLM |
| **Keystone** | `ANYTHINGLLM_BASE_URL` | ✅ | AnythingLLM API URL |
| **Keystone** | `ANYTHINGLLM_SERVICE_AUTH_MODE` | ✅ | `gcp` or `local_jwt` |
| **AnythingLLM** | `KEYSTONE_DELEGATED_TOKEN_SECRET` | ✅ | Must match Keystone |
| **AnythingLLM** | `KEYSTONE_AUDIENCE` | ✅ | Must match Keystone |
| **AnythingLLM** | `KEYSTONE_ISSUER` | ⚠️ | Optional but recommended |

### Authentication Flow

```
User Request → Keystone (with user JWT)
  ↓
Keystone validates user JWT
  ↓
Keystone issues delegated token (sub: 'svc-keystone', act: {userId, roles})
  ↓
Keystone calls AnythingLLM with delegated token
  ↓
AnythingLLM validates token signature
  ↓
AnythingLLM extracts user context from act claim
  ↓
AnythingLLM enforces role-based authorization
  ↓
Response returned to user
```

---

## 12. Support

For issues or questions:
- Review [Delegated Token Authentication Guide](delegated-tokens.md)
- Check Keystone Core API logs for token issuance errors
- Verify environment variables match this guide
- Test token structure using JWT decode tools

---

**Last Updated:** 2025-01-27  
**Version:** 2.0 (Consolidated)


