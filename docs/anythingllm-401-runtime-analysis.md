# AnythingLLM 401 Unauthorized - Runtime Evidence Analysis

## Executive Summary

**Status**: Keystone is correctly minting and sending GCP ID tokens, but AnythingLLM is rejecting them with `401 Unauthorized`.

**Key Finding**: The empty `www-authenticate` header in AnythingLLM's response suggests the guard is failing silently without providing detailed error information.

## Runtime Evidence (from `.cursor/debug.log`)

### ✅ Confirmed: Token is Valid
**Log Evidence**: Lines 14, 40, 269
```json
{
  "aud": "anythingllm-internal",
  "iss": "https://accounts.google.com",
  "email": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "azp": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "exp": 1767404346,
  "tokenLength": 881
}
```

### ✅ Confirmed: Request is Formatted Correctly
**Log Evidence**: Lines 18, 29, 53, 74, 95, 117
- URL: `http://localhost:3001/api/v1/admin/users` ✓
- Authorization header: `Bearer <token>` ✓
- X-Request-Id: Present ✓
- X-Client-Service: `keystone` ✓
- Content-Type: `application/json` ✓

### ❌ Confirmed: AnythingLLM Rejects All Requests
**Log Evidence**: Lines 19, 30, 54, 75, 96, 119
- Status: `401 Unauthorized`
- Response body: `"Unauthorized"`
- `www-authenticate` header: **EMPTY** (critical finding)
- All response headers captured: No additional error details

## Hypotheses (Ranked by Likelihood)

### Hypothesis 1: Environment Variable Mismatch (MOST LIKELY - 70%)
**Why**: Token has correct `aud: "anythingllm-internal"`, but AnythingLLM rejects it. This suggests a string comparison mismatch.

**Possible Causes**:
1. `ANYTHINGLLM_SERVICE_AUDIENCE` has leading/trailing whitespace
2. `ANYTHINGLLM_SERVICE_AUDIENCE` has different case
3. `ANYTHINGLLM_SERVICE_AUDIENCE` is not loaded from environment (config module issue)
4. `ANYTHINGLLM_SERVICE_AUDIENCE` is set to a different value entirely

**How to Verify**:
```bash
# On AnythingLLM server/container
# Check for exact match (including whitespace)
echo "|$ANYTHINGLLM_SERVICE_AUDIENCE|"
# Expected: |anythingllm-internal|
# If you see: | anythingllm-internal | or |AnythingLLM-Internal| → MISMATCH

# Check case sensitivity
echo "$ANYTHINGLLM_SERVICE_AUDIENCE" | od -c
# Should show: a n y t h i n g l l m - i n t e r n a l (all lowercase)
```

### Hypothesis 2: Service Account Email Not Whitelisted (HIGH - 60%)
**Why**: Token has correct `email` claim, but AnythingLLM might require explicit whitelisting.

**Possible Causes**:
1. `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL` is not set
2. `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL` doesn't match exactly (whitespace, case)
3. AnythingLLM's guard doesn't check service account email (code bug)

**How to Verify**:
```bash
# On AnythingLLM server/container
echo "|$ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL|"
# Expected: |keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com|
# If empty or different → MISMATCH
```

### Hypothesis 3: Token Verification Code Bug (MEDIUM - 40%)
**Why**: Empty `www-authenticate` header suggests guard might be failing silently.

**Possible Causes**:
1. Token extraction from `Authorization` header fails (parsing issue)
2. JWT decoding fails (base64url issues)
3. Signature verification fails (JWKS fetch issue, wrong algorithm)
4. Guard returns false without logging detailed error

**How to Verify**: Check AnythingLLM application logs for:
- Token extraction errors
- JWT decode errors
- JWKS fetch errors (`https://www.googleapis.com/oauth2/v3/certs`)
- Signature verification errors

### Hypothesis 4: Guard Not Applied to Routes (LOW - 20%)
**Why**: 401 suggests auth is checked, but guard might not be running properly.

**Possible Causes**:
1. `ServiceIdentityGuard` is not applied to `/v1/admin/users` routes
2. Guard is applied but fails early (before detailed validation)
3. Route doesn't exist (but 401 suggests auth is checked, so this is unlikely)

**How to Verify**: Check AnythingLLM route definitions to ensure `ServiceIdentityGuard` is applied to admin routes.

### Hypothesis 5: URL Path Mismatch (LOW - 10%)
**Why**: URL is `http://localhost:3001/api/v1/admin/users`, but AnythingLLM might expect different path.

**Possible Causes**:
1. AnythingLLM expects `/v1/admin/users` (without `/api` prefix)
2. Route is mounted at different path
3. Guard is only applied to certain path patterns

**How to Verify**: Test with direct curl:
```bash
curl -v http://localhost:3001/api/v1/admin/users \
  -H "Authorization: Bearer <token-from-keystone-logs>"
```

## Action Items (Prioritized)

### Immediate Actions (Do First)

1. **Verify Environment Variables on AnythingLLM**
   ```bash
   # SSH into AnythingLLM server/container
   env | grep ANYTHINGLLM
   
   # Check exact values (including whitespace)
   echo "AUDIENCE: |$ANYTHINGLLM_SERVICE_AUDIENCE|"
   echo "EMAIL: |$ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL|"
   echo "MODE: |$ANYTHINGLLM_SERVICE_AUTH_MODE|"
   ```

2. **Check AnythingLLM Application Logs**
   ```bash
   # Look for token verification errors
   grep -i "token\|audience\|service.*identity\|401" /path/to/anythingllm/logs
   ```

3. **Test Token Manually**
   ```bash
   # Extract token from Keystone logs (line 18, tokenClaims)
   # Or mint a new token using Keystone's service
   
   # Test with curl
   curl -v http://localhost:3001/api/v1/admin/users \
     -H "Authorization: Bearer <token>" \
     -H "X-Request-Id: test-request" \
     -H "X-Client-Service: keystone"
   ```

### Secondary Actions (If Immediate Actions Don't Reveal Issue)

4. **Verify JWKS Endpoint Accessibility**
   ```bash
   # From AnythingLLM server
   curl https://www.googleapis.com/oauth2/v3/certs
   # Should return JSON with public keys
   ```

5. **Check AnythingLLM Route Configuration**
   - Verify `ServiceIdentityGuard` is applied to `/v1/admin/users` routes
   - Check route mounting (is `/api` prefix correct?)

6. **Enable Debug Logging in AnythingLLM**
   - Enable verbose logging for token verification
   - Look for specific error messages about token validation failures

## Expected Token Claims (for Reference)

Based on runtime logs, the token being sent has these exact claims:

```json
{
  "aud": "anythingllm-internal",
  "azp": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "email": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "email_verified": true,
  "exp": 1767404346,
  "iat": 1767400746,
  "iss": "https://accounts.google.com",
  "sub": "101020433972434855339"
}
```

## Required AnythingLLM Configuration

AnythingLLM **MUST** have these environment variables set to **exact** values:

```bash
# Must match token's 'aud' claim exactly (case-sensitive, no spaces)
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal

# Must match token's 'email' or 'azp' claim exactly
ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com

# Must be 'gcp' for GCP OIDC token verification
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
```

## Next Steps

1. **User Action**: Verify environment variables on AnythingLLM server (see Immediate Actions #1)
2. **User Action**: Check AnythingLLM application logs for token verification errors (see Immediate Actions #2)
3. **User Action**: Test token manually with curl (see Immediate Actions #3)
4. **If still failing**: Share AnythingLLM logs and environment variable output for further analysis

## Questions to Answer

1. What is the exact value of `ANYTHINGLLM_SERVICE_AUDIENCE` on AnythingLLM? (including any whitespace)
2. What is the exact value of `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL` on AnythingLLM?
3. What do AnythingLLM application logs show when a request is rejected?
4. Can AnythingLLM reach `https://www.googleapis.com/oauth2/v3/certs`?
5. Is `ServiceIdentityGuard` applied to `/v1/admin/users` routes in AnythingLLM?


