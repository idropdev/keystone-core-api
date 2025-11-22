# Token Introspection Endpoint Implementation (RFC 7662)

**Project:** Keystone Core API - OAuth 2.0 Token Introspection  
**Date:** 2025-01-27  
**Status:** ✅ Production Ready

---

## Executive Summary

This document describes the implementation of the OAuth 2.0 Token Introspection endpoint (`/v1/auth/introspect`) following RFC 7662. This endpoint allows resource servers (like AnythingLLM) to validate JWT access tokens issued by Keystone Core API and enforce authorization.

**Key Features:**
- ✅ RFC 7662 compliant endpoint
- ✅ Supports both JSON and `application/x-www-form-urlencoded` content types
- ✅ Service-to-service authentication (API key)
- ✅ Rate limiting (100 requests/minute)
- ✅ Token revocation support (session-based)
- ✅ Optional caching with revocation awareness
- ✅ HIPAA-compliant audit logging
- ✅ Comprehensive e2e tests

---

## Endpoint Specification

### URL
```
POST /v1/auth/introspect
```

### Authentication
- **Method:** Bearer token (service API key)
- **Header:** `Authorization: Bearer <AUTH_INTROSPECTION_SERVICE_KEY>`
- **Required:** Yes (endpoint is not public)

### Request Format

#### Option 1: JSON (Convenient)
```http
POST /v1/auth/introspect HTTP/1.1
Host: keystone.example.com
Authorization: Bearer <service-api-key>
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenTypeHint": "access_token",
  "includeUser": true
}
```

#### Option 2: RFC 7662 Form-URLEncoded (Standard)
```http
POST /v1/auth/introspect HTTP/1.1
Host: keystone.example.com
Authorization: Bearer <service-api-key>
Content-Type: application/x-www-form-urlencoded

token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...&token_type_hint=access_token
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | Yes | The access token to introspect |
| `token_type_hint` | string | No | Hint: `access_token` or `refresh_token` |
| `includeUser` | boolean | No | Include user email in response (default: true) |

### Response Format

#### Active Token (200 OK)
```json
{
  "active": true,
  "sub": "123",
  "sid": "456",
  "iss": "https://keystone.example.com",
  "aud": "anythingllm",
  "scope": "anythingllm:read anythingllm:write",
  "exp": 1738000900,
  "iat": 1738000000,
  "nbf": 1737999940,
  "revoked": false,
  "role": { "id": 2, "name": "user" },
  "provider": "google",
  "email": null
}
```

#### Inactive Token (200 OK)
```json
{
  "active": false,
  "error_code": "expired",
  "exp": 1738000900,
  "iat": 1738000000
}
```

#### Revoked Token (200 OK)
```json
{
  "active": false,
  "revoked": true,
  "error_code": "revoked",
  "sub": "123",
  "sid": "456",
  "exp": 1738000900,
  "iat": 1738000000
}
```

#### Unauthorized (401 Unauthorized)
```json
{
  "statusCode": 401,
  "message": "Missing or invalid service API key",
  "error": "Unauthorized"
}
```

---

## Security Features

### 1. Service API Key Authentication
- All introspection requests require a service API key
- Key is validated via `ServiceApiKeyGuard`
- Key must be stored in GCP Secret Manager in production
- Never logged or exposed in error messages

**Configuration:**
```env
AUTH_INTROSPECTION_SERVICE_KEY=<strong-random-key>
```

### 2. Rate Limiting
- **Limit:** 100 requests per minute per service
- **Purpose:** Prevent abuse and token scanning attacks
- **Implementation:** `@nestjs/throttler` with in-memory storage
- **TODO:** Migrate to Redis for distributed rate limiting

### 3. Token Validation
- **Signature Verification:** JWT signature validated using HS256
- **Algorithm Validation:** Rejects `alg: "none"` and unsupported algorithms
- **Expiration Check:** Validates `exp` claim with 60s clock skew
- **Issuer Validation:** Validates `iss` claim (if configured)
- **Audience Validation:** Validates `aud` claim (if configured)
- **Session Revocation:** Checks if session is still active in database

### 4. Caching (Optional)
- **TTL:** 30 seconds (configurable via `AUTH_INTROSPECTION_CACHE_TTL_SECONDS`)
- **Scope:** Only caches active, non-revoked tokens
- **Invalidation:** Automatic on session revocation/logout
- **Storage:** In-memory (per-instance)
- **TODO:** Migrate to Redis for distributed caching

### 5. HIPAA Compliance
- **No PHI in Requests/Responses:** Only user ID (`sub`), role, and session ID
- **Audit Logging:** All introspection events logged with:
  - User ID
  - Session ID
  - Client service identifier
  - IP address
  - Timestamp
  - Success/failure
- **No Raw Tokens in Logs:** Only token hash used for cache keys
- **Secure Storage:** Logs forwarded to GCP Cloud Logging (TODO)

---

## Implementation Details

### Files Created/Modified

1. **`src/auth/auth.controller.ts`**
   - Added `/v1/auth/introspect` endpoint
   - Integrated `ServiceApiKeyGuard` for authentication
   - Added `FormUrlEncodedInterceptor` for RFC 7662 compliance
   - Rate limiting: 100 requests/minute

2. **`src/auth/auth.service.ts`**
   - `introspectToken()` method with full validation
   - Session revocation checking
   - Cache integration
   - Enhanced audit logging with IP address

3. **`src/auth/guards/service-api-key.guard.ts`**
   - Validates service API key from Authorization header
   - Returns 401 if missing or invalid

4. **`src/auth/interceptors/form-urlencoded.interceptor.ts`**
   - Converts `application/x-www-form-urlencoded` to DTO format
   - RFC 7662 compliance

5. **`src/auth/services/token-introspection-cache.service.ts`**
   - In-memory cache for introspection results
   - Automatic expiration and cleanup
   - Revocation-aware invalidation

6. **`src/auth/dto/token-introspect.dto.ts`**
   - Request/response DTOs with validation
   - RFC 7662 compliant fields

7. **`test/auth/token-introspection.e2e-spec.ts`**
   - Comprehensive e2e tests covering all scenarios

---

## Usage Examples

### AnythingLLM Integration

See `docs/anythingllm-external-auth-implementation.md` for complete integration guide.

**Quick Example:**
```javascript
async function validateToken(token) {
  const response = await fetch('https://keystone.example.com/v1/auth/introspect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${process.env.KEYSTONE_SERVICE_KEY}`
    },
    body: new URLSearchParams({
      token: token,
      token_type_hint: 'access_token'
    }).toString()
  });

  const data = await response.json();
  
  if (!data.active) {
    throw new Error('Token is inactive or revoked');
  }

  return {
    userId: data.sub,
    role: data.role,
    scope: data.scope
  };
}
```

---

## Testing

### E2E Tests
```bash
npm run test:e2e -- test/auth/token-introspection.e2e-spec.ts
```

**Test Coverage:**
- ✅ Authentication (valid/invalid API key)
- ✅ Request format (JSON and form-urlencoded)
- ✅ Valid token response
- ✅ Invalid token response
- ✅ Revoked token response
- ✅ Rate limiting
- ✅ HIPAA compliance (no PHI)

---

## Configuration

### Environment Variables

```env
# Service API key for introspection endpoint
AUTH_INTROSPECTION_SERVICE_KEY=<strong-random-key>

# Rate limiting (requests per minute)
AUTH_INTROSPECTION_RATE_LIMIT=100

# Cache TTL (seconds, optional)
AUTH_INTROSPECTION_CACHE_TTL_SECONDS=30

# JWT Configuration
AUTH_JWT_SECRET=<secret>
AUTH_JWT_ISSUER=https://keystone.example.com
AUTH_JWT_AUDIENCE=anythingllm
AUTH_JWT_ALLOWED_ALGORITHMS=HS256
```

---

## Production Checklist

- [ ] Service API key stored in GCP Secret Manager
- [ ] Rate limiting configured appropriately
- [ ] Cache TTL tuned for your use case
- [ ] HTTPS enforced at load balancer level
- [ ] Audit logs forwarded to GCP Cloud Logging
- [ ] Monitoring and alerting configured
- [ ] E2E tests passing
- [ ] Documentation updated for resource servers

---

## Security Considerations

1. **Token Scanning Prevention:**
   - Rate limiting prevents brute-force token scanning
   - Service API key authentication restricts access
   - Short cache TTL ensures revocation is reflected quickly

2. **Information Leakage:**
   - Inactive tokens return minimal information (`active: false`)
   - Error messages are sanitized (no token details)
   - Unauthorized introspection calls return 401 (not detailed errors)

3. **Revocation Enforcement:**
   - Session-based revocation (immediate)
   - Cache invalidation on logout
   - Database check on every introspection (if not cached)

4. **Audit Trail:**
   - All introspection events logged
   - IP address and client service identifier tracked
   - No raw tokens in logs (only hashes)

---

## Performance Considerations

1. **Caching:**
   - 30-second cache TTL balances performance and revocation
   - Only active tokens cached (inactive tokens are fast to verify)
   - Cache automatically invalidated on revocation

2. **Database Queries:**
   - Session lookup only if token passes signature validation
   - Indexed session table for fast lookups

3. **Rate Limiting:**
   - In-memory storage (fast, but not distributed)
   - TODO: Migrate to Redis for multi-instance deployments

---

## Future Enhancements

1. **Distributed Caching:**
   - Migrate to Redis for multi-instance deployments
   - Shared cache across all API instances

2. **Distributed Rate Limiting:**
   - Redis-based rate limiting
   - Consistent limits across instances

3. **Token Blacklist:**
   - Optional blacklist for revoked tokens
   - Faster revocation checks (no DB query)

4. **Metrics and Monitoring:**
   - Introspection latency metrics
   - Cache hit/miss rates
   - Rate limit violations

---

## References

- [RFC 7662: OAuth 2.0 Token Introspection](https://tools.ietf.org/html/rfc7662)
- [RFC 7519: JSON Web Token (JWT)](https://tools.ietf.org/html/rfc7519)
- [RFC 6750: OAuth 2.0 Bearer Token Usage](https://tools.ietf.org/html/rfc6750)
- [AnythingLLM Integration Guide](./anythingllm-external-auth-implementation.md)

---

## Support

For questions or issues, contact the Keystone Core API team or refer to the main documentation in `docs/`.

