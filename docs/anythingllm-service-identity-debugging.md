# AnythingLLM Service Identity Token Verification Debugging Guide

## Issue Summary

Keystone Core API is successfully minting GCP ID tokens and sending them to AnythingLLM, but AnythingLLM is returning `401 Unauthorized` with error `"Invalid service identity token"`.

## Token Being Sent (from Keystone Logs)

**Token Header:**
```json
{
  "alg": "RS256",
  "kid": "496d008e8c7be1cae4209e0d5c21b050a61e960f",
  "typ": "JWT"
}
```

**Token Payload (all claims):**
```json
{
  "aud": "anythingllm-internal",
  "azp": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "email": "keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com",
  "email_verified": true,
  "exp": 1766904756,
  "iat": 1766901156,
  "iss": "https://accounts.google.com",
  "sub": "101020433972434855339"
}
```

**Request Headers:**
```
Authorization: Bearer <token>
X-Request-Id: <uuid>
X-Client-Service: keystone
Content-Type: application/json
```

## Configuration Values (Keystone Side)

- **ANYTHINGLLM_SERVICE_AUDIENCE**: `anythingllm-internal`
- **Service Account Email**: `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`
- **Token Algorithm**: `RS256`
- **Token Issuer**: `https://accounts.google.com`

## Debugging Checklist for AnythingLLM

### 1. Verify Environment Configuration

Check that AnythingLLM has the correct environment variables set:

```bash
# Should match Keystone's ANYTHINGLLM_SERVICE_AUDIENCE
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal

# Should match the service account email from the token
ANYTHINGLLM_SERVICE_ACCOUNT_EMAIL=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
```

**Action Items:**
- [ ] Verify `ANYTHINGLLM_SERVICE_AUDIENCE` is set to exactly `anythingllm-internal` (no extra spaces, case-sensitive)
- [ ] Verify service account email configuration matches the token's `email` claim
- [ ] Check if there are any additional required environment variables

### 2. Verify Token Extraction

Check how AnythingLLM extracts the token from the Authorization header:

**Expected format:**
```
Authorization: Bearer <token>
```

**Look for:**
- Code that extracts token from `Authorization` header
- Should split on `Bearer ` (note the space)
- Should handle case-insensitive "Bearer"
- Should trim whitespace

**Common issues:**
- Not handling `Bearer` prefix correctly
- Not trimming whitespace
- Case sensitivity issues

### 3. Verify Token Structure Validation

Check if AnythingLLM validates the token structure before verification:

**Should check:**
- Token has 3 parts (header.payload.signature)
- Token is valid base64url encoding
- Token can be decoded as JSON

**Look for:**
- JWT parsing/decoding code
- Base64url decoding
- JSON parsing of header and payload

### 4. Verify Audience (aud) Claim

Check if AnythingLLM validates the `aud` claim:

**Token's aud claim:** `anythingllm-internal`

**Should verify:**
```javascript
if (decodedPayload.aud !== process.env.ANYTHINGLLM_SERVICE_AUDIENCE) {
  // Reject token
}
```

**Look for:**
- Code that checks `decodedPayload.aud`
- Comparison with `ANYTHINGLLM_SERVICE_AUDIENCE` environment variable
- Case-sensitive comparison (should be exact match)
- No extra whitespace trimming that might cause mismatch

**Common issues:**
- Environment variable not loaded correctly
- Case mismatch
- Extra whitespace
- Wrong environment variable name

### 5. Verify Service Account Email

Check if AnythingLLM validates the service account email:

**Token's email claim:** `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`

**Should verify:**
```javascript
const expectedEmail = process.env.ANYTHINGLLM_SERVICE_ACCOUNT_EMAIL;
if (decodedPayload.email !== expectedEmail) {
  // Reject token
}
```

**Look for:**
- Code that checks `decodedPayload.email` or `decodedPayload.azp`
- Comparison with configured service account email
- Exact match required (email addresses are case-sensitive in the local part, but GCP service accounts use lowercase)

### 6. Verify Token Signature (RS256)

Check if AnythingLLM verifies the token signature using Google's public keys:

**Token algorithm:** `RS256`
**Token issuer:** `https://accounts.google.com`
**Token kid (Key ID):** `496d008e8c7be1cae4209e0d5c21b050a61e960f`

**Google's JWKS endpoint:** `https://www.googleapis.com/oauth2/v3/certs`

**Should verify:**
1. Extract `kid` from token header
2. Fetch Google's JWKS from `https://www.googleapis.com/oauth2/v3/certs`
3. Find the key with matching `kid`
4. Verify token signature using the public key
5. Verify `iss` claim equals `https://accounts.google.com`

**Look for:**
- JWT verification library usage (e.g., `jsonwebtoken`, `jose`, `node-jose`, `google-auth-library`)
- JWKS fetching code
- Signature verification code
- Issuer verification

**Common issues:**
- JWKS endpoint not accessible (network/firewall)
- Key ID (kid) not found in JWKS
- Wrong JWKS endpoint URL
- Incorrect signature verification algorithm
- Not verifying issuer claim
- Token verification library misconfiguration

### 7. Verify Token Expiration

Check if AnythingLLM validates token expiration:

**Token exp:** `1766904756` (Unix timestamp)
**Token iat:** `1766901156` (Unix timestamp)

**Should verify:**
```javascript
const now = Math.floor(Date.now() / 1000);
if (decodedPayload.exp < now) {
  // Token expired
}
```

**Look for:**
- Code that checks `decodedPayload.exp`
- Clock skew tolerance (typically 60 seconds)
- Comparison with current time

### 8. Check Error Logging

Look for error logs in AnythingLLM that might provide more detail:

**Look for:**
- Logs that show why token verification failed
- JWT verification error messages
- JWKS fetch errors
- Configuration errors

**Common error messages:**
- "Invalid signature"
- "Token expired"
- "Invalid audience"
- "JWKS fetch failed"
- "Key not found"
- "Invalid issuer"

### 9. Verify Middleware/Guard Placement

Check if the service identity verification middleware is:
- Applied to the correct routes (`/v1/admin/*`)
- Executed before route handlers
- Properly handling errors

**Look for:**
- Middleware or guard that validates service identity tokens
- Route configuration that applies the middleware
- Error handling that returns proper 401 responses

### 10. Test Token Verification Manually

Use the token from Keystone logs to test verification manually:

**Example Node.js verification code:**
```javascript
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const token = '<token-from-keystone-logs>';

// Decode without verification first
const decoded = jwt.decode(token, { complete: true });
console.log('Token header:', decoded.header);
console.log('Token payload:', decoded.payload);

// Verify signature
const client = jwksClient({
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs'
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

jwt.verify(token, getKey, {
  audience: 'anythingllm-internal',
  issuer: 'https://accounts.google.com',
}, (err, decoded) => {
  if (err) {
    console.error('Verification failed:', err.message);
  } else {
    console.log('Token verified successfully:', decoded);
  }
});
```

## Expected Token Verification Flow

1. Extract token from `Authorization: Bearer <token>` header
2. Decode token (split into header.payload.signature)
3. Decode header and payload (base64url)
4. Validate token structure (3 parts, valid JSON)
5. Verify `iss` claim equals `https://accounts.google.com`
6. Verify `aud` claim equals `ANYTHINGLLM_SERVICE_AUDIENCE` (exact match)
7. Verify `email` claim equals configured service account email (exact match)
8. Verify `exp` claim (token not expired, with clock skew tolerance)
9. Fetch JWKS from `https://www.googleapis.com/oauth2/v3/certs`
10. Find key with matching `kid` from token header
11. Verify signature using public key from JWKS
12. If all checks pass, accept token

## Common Failure Points

1. **Audience Mismatch** - Most common issue
   - Check `ANYTHINGLLM_SERVICE_AUDIENCE` environment variable
   - Ensure exact match (case-sensitive, no whitespace)

2. **Service Account Email Mismatch**
   - Check service account email configuration
   - Verify exact match with token's `email` claim

3. **JWKS Fetch Failure**
   - Network connectivity to `https://www.googleapis.com/oauth2/v3/certs`
   - Firewall/proxy blocking HTTPS requests
   - DNS resolution issues

4. **Signature Verification Failure**
   - Wrong algorithm (should be RS256)
   - Key ID (kid) not found in JWKS
   - Incorrect public key extraction

5. **Token Expiration**
   - Clock skew between Keystone and AnythingLLM
   - Token expired before reaching AnythingLLM (unlikely with 1-hour expiration)

6. **Issuer Verification Failure**
   - Wrong issuer expected
   - Case sensitivity issues

## Questions to Answer

1. What is the value of `ANYTHINGLLM_SERVICE_AUDIENCE` environment variable in AnythingLLM?
2. What service account email is configured in AnythingLLM?
3. What JWT verification library is being used?
4. Can AnythingLLM fetch JWKS from `https://www.googleapis.com/oauth2/v3/certs`?
5. What is the exact error message when token verification fails? (Check logs)
6. Is there any token caching that might be using an old/invalid token?
7. Are there any middleware or guards that might be interfering?

## Next Steps

1. Add detailed logging to AnythingLLM's token verification code:
   - Log the received token (header and payload after decoding)
   - Log configuration values being used (audience, service account email)
   - Log each verification step (audience check, email check, signature verification)
   - Log any errors from JWT verification library

2. Compare logged values with expected values from this document

3. Test token verification manually using the code example above

4. Check AnythingLLM's error logs for more detailed error messages

