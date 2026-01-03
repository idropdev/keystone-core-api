# AnythingLLM 401 Unauthorized - Debugging Summary

## Issue
Keystone Core API is successfully minting GCP ID tokens and sending them to AnythingLLM, but AnythingLLM is returning `401 Unauthorized` for all requests.

## Root Cause Analysis

### ✅ What's Working (Keystone Side) - CONFIRMED via Runtime Logs
1. **Token Minting**: GCP ID tokens are being minted correctly
   - Token length: 881 characters (log line 14, 40)
   - Algorithm: RS256 (from token structure)
   - Issuer: `https://accounts.google.com` (log line 14: `iss: "https://accounts.google.com"`)
   - Audience: `anythingllm-internal` (log line 14: `aud: "anythingllm-internal"`)
   - Service Account: `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com` (log line 14: `email: "keystone-doc-processing@..."`)

2. **URL Construction**: URLs are correct
   - Base URL: `http://localhost:3001/api` (log line 16: `baseUrl: "http://localhost:3001/api"`)
   - Final URLs: 
     - `http://localhost:3001/api/v1/admin/users` (log line 17: `finalUrl: "http://localhost:3001/api/v1/admin/users"`)
     - `http://localhost:3001/api/v1/admin/users/new` (log line 28: `finalUrl: "http://localhost:3001/api/v1/admin/users/new"`)

3. **Request Headers**: Headers are being sent correctly
   - `Authorization: Bearer <token>` (log line 18: `authHeaderFormat: "Bearer"`, `hasAuthHeader: true`)
   - `X-Request-Id: <uuid>` (log line 18: `hasXRequestId: true`)
   - `X-Client-Service: keystone` (log line 18: `xClientServiceValue: "keystone"`)
   - `Content-Type: application/json` (log line 18: `hasContentType: true`)

### ❌ What's Failing (AnythingLLM Side) - CONFIRMED via Runtime Logs
AnythingLLM is rejecting all tokens with `401 Unauthorized` and response body `"Unauthorized"`.

**Key Observations from Logs:**
- Response status: `401` (log line 19: `status: 401`, `is401: true`)
- Response body: `"Unauthorized"` (log line 19: `responseBody: "Unauthorized"`)
- Response headers: `www-authenticate: ""` (log line 19: `www-authenticate: ""` - **EMPTY!**)
- All response headers captured: No additional error details provided (log line 19: `allResponseHeaders`)

**Critical Finding:** The empty `www-authenticate` header suggests AnythingLLM is not providing detailed error information, which makes debugging difficult.

## Required AnythingLLM Configuration

Based on the token being sent, AnythingLLM **MUST** have the following environment variables configured:

```bash
# Required: Must match the token's audience claim
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal

# Required: Must match the token's email/azp claim
ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com

# Required: Must be set to 'gcp' for GCP OIDC token verification
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
```

## Verification Steps

### 1. Check AnythingLLM Environment Variables
```bash
# On the AnythingLLM server/container
echo $ANYTHINGLLM_SERVICE_AUDIENCE
# Should output: anythingllm-internal

echo $ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL
# Should output: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com

echo $ANYTHINGLLM_SERVICE_AUTH_MODE
# Should output: gcp
```

### 2. Verify Token Verification Code
The AnythingLLM service identity guard should:
1. Extract token from `Authorization: Bearer <token>` header
2. Decode JWT payload
3. Verify `aud` claim matches `ANYTHINGLLM_SERVICE_AUDIENCE`
4. Verify `email` or `azp` claim matches `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL`
5. Verify token signature using Google's JWKS endpoint
6. Verify token expiration

### 3. Check AnythingLLM Logs
Look for error messages in AnythingLLM logs that indicate:
- Token extraction failures
- Audience mismatch
- Service account email mismatch
- Signature verification failures
- JWKS fetch failures

## Hypotheses (Based on Runtime Evidence)

### Hypothesis 1: Environment Variable Mismatch (MOST LIKELY)
**Evidence**: Token has correct `aud: "anythingllm-internal"` (log line 14), but AnythingLLM rejects it
**Possible Causes**:
- `ANYTHINGLLM_SERVICE_AUDIENCE` has extra whitespace (leading/trailing spaces)
- `ANYTHINGLLM_SERVICE_AUDIENCE` has different case (e.g., `AnythingLLM-Internal`)
- `ANYTHINGLLM_SERVICE_AUDIENCE` is not loaded from environment (config issue)
- `ANYTHINGLLM_SERVICE_AUDIENCE` is set to a different value

**How to Verify**:
```bash
# On AnythingLLM server
echo "|$ANYTHINGLLM_SERVICE_AUDIENCE|"  # Check for whitespace
# Should output: |anythingllm-internal| (exact match, no extra spaces)
```

### Hypothesis 2: Service Account Email Not Whitelisted
**Evidence**: Token has correct `email: "keystone-doc-processing@..."` (log line 14), but AnythingLLM rejects it
**Possible Causes**:
- `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL` is not set
- `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL` doesn't match exactly (whitespace, case)
- AnythingLLM's guard doesn't check service account email (code bug)

**How to Verify**:
```bash
# On AnythingLLM server
echo "|$ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL|"
# Should output: |keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com|
```

### Hypothesis 3: Token Verification Code Bug
**Evidence**: Empty `www-authenticate` header suggests guard might be failing silently
**Possible Causes**:
- Token extraction from `Authorization` header fails (wrong parsing)
- JWT decoding fails (base64url issues)
- Signature verification fails (JWKS fetch issue, wrong algorithm)
- Guard returns false without logging detailed error

**How to Verify**: Check AnythingLLM logs for:
- Token extraction errors
- JWT decode errors
- JWKS fetch errors
- Signature verification errors

### Hypothesis 4: Guard Not Applied to Routes
**Evidence**: 401 with empty error suggests guard might not be running at all
**Possible Causes**:
- `ServiceIdentityGuard` is not applied to `/v1/admin/users` routes
- Guard is applied but fails early (before detailed validation)
- Route doesn't exist (404 would be expected, but 401 suggests auth is checked)

**How to Verify**: Check AnythingLLM route definitions to ensure `ServiceIdentityGuard` is applied

### Hypothesis 5: URL Path Mismatch
**Evidence**: URL is `http://localhost:3001/api/v1/admin/users` (log line 17)
**Possible Causes**:
- AnythingLLM expects `/v1/admin/users` (without `/api` prefix)
- Route is mounted at different path
- Guard is only applied to certain path patterns

**How to Verify**: Test with direct curl to see if path is correct:
```bash
curl -v http://localhost:3001/api/v1/admin/users \
  -H "Authorization: Bearer <token>"
```

## Common Issues (Prioritized by Likelihood)

### Issue 1: Environment Variable Not Set or Mismatch (HIGH PRIORITY)
**Symptom**: 401 Unauthorized with empty `www-authenticate` header
**Solution**: 
1. Verify `ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal` (exact match, no spaces)
2. Verify `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`
3. Restart AnythingLLM after setting environment variables

### Issue 2: Service Account Email Not Whitelisted (HIGH PRIORITY)
**Symptom**: 401 Unauthorized despite correct audience
**Solution**: Set `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL` to match token's `email` claim exactly

### Issue 3: Token Verification Code Bug (MEDIUM PRIORITY)
**Symptom**: 401 Unauthorized with no error details
**Solution**: Check AnythingLLM logs for token verification errors, ensure JWKS endpoint is reachable

### Issue 4: Guard Not Applied (LOW PRIORITY)
**Symptom**: 401 suggests auth is checked, but guard might not be running
**Solution**: Verify `ServiceIdentityGuard` is applied to admin routes in AnythingLLM

### Issue 5: JWKS Fetch Failure (MEDIUM PRIORITY)
**Symptom**: 401 Unauthorized
**Solution**: Ensure AnythingLLM can reach `https://www.googleapis.com/oauth2/v3/certs` to fetch Google's public keys

### Issue 6: Token Signature Verification Failure (MEDIUM PRIORITY)
**Symptom**: 401 Unauthorized
**Solution**: Check that the JWT library is correctly verifying RS256 signatures using Google's public keys

## Test Behavior

### Current Test Behavior
- Tests **pass** because they gracefully skip AnythingLLM verification when:
  - `serviceIdentityService` is null (module initialization fails)
  - 401 errors are received (treated as "AnythingLLM not configured")

### Expected Test Behavior (After Fix)
- Tests should **verify** AnythingLLM integration when:
  - `serviceIdentityService` is available
  - Tokens can be minted
  - AnythingLLM is properly configured

## Next Steps

1. **Fix Test Initialization**: Ensure `serviceIdentityService` is properly initialized in test context
2. **Verify AnythingLLM Configuration**: Check that all required environment variables are set
3. **Check AnythingLLM Logs**: Look for specific error messages about token verification
4. **Test Token Verification**: Manually verify a token using the AnythingLLM API to see the exact error

## Token Details (for Reference)

**Token Claims:**
```json
{
  "aud": "anythingllm-internal",
  "azp": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "email": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "email_verified": true,
  "exp": 1767402851,
  "iat": 1767399251,
  "iss": "https://accounts.google.com",
  "sub": "101020433972434855339"
}
```

**Request Example:**
```
GET /v1/admin/users HTTP/1.1
Host: localhost:3001
Authorization: Bearer <881-char-token>
X-Request-Id: <uuid>
X-Client-Service: keystone
Content-Type: application/json
```

**Response:**
```
HTTP/1.1 401 Unauthorized
Content-Type: text/plain; charset=utf-8

Unauthorized
```

