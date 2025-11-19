# Keystone Core API - Token Introspection Endpoint Implementation

**Project:** Token Introspection for External Resource Servers  
**Date:** 2025-01-27  
**Focus:** RFC 7662 Compliant Token Introspection Endpoint  
**Status:** ✅ Implemented

---

## Executive Summary

This document describes the implementation of a token introspection endpoint in Keystone Core API. This endpoint allows external services (like AnythingLLM) to validate JWT tokens issued by Keystone Core API without sharing secrets.

**Key Principle:** Keystone Core API is the Authorization Server (OAuth2), external services are Resource Servers.

**Standards Compliance:**
- ✅ RFC 7662 (OAuth 2.0 Token Introspection)
- ✅ RFC 7519 (JSON Web Token)
- ✅ RFC 9068 (JWT Profile for OAuth 2.0 Access Tokens)
- ✅ HIPAA Compliance (no PHI in tokens/logs)

---

## Implementation Summary

### Files Created

1. **`src/auth/dto/token-introspect.dto.ts`**
   - `TokenIntrospectDto` - Request DTO for introspection
   - `TokenIntrospectResponseDto` - RFC 7662 compliant response DTO

2. **`src/auth/guards/service-api-key.guard.ts`**
   - Service API key authentication guard for introspection endpoint
   - Validates Bearer token from Authorization header

### Files Modified

1. **`env-example-relational`**
   - Added `AUTH_INTROSPECTION_SERVICE_KEY`
   - Added `AUTH_INTROSPECTION_RATE_LIMIT`
   - Added `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_JWT_KEY_ID`, `AUTH_JWT_ALLOWED_ALGORITHMS`

2. **`src/auth/config/auth-config.type.ts`**
   - Added introspection and JWT standards configuration fields

3. **`src/auth/config/auth.config.ts`**
   - Added validation and configuration for new fields

4. **`src/auth/auth.service.ts`**
   - Added `introspectToken()` method
   - Updated `getTokensData()` for RFC 7519/9068 compliance (backward compatible)

5. **`src/auth/auth.controller.ts`**
   - Added `POST /v1/auth/introspect` endpoint

6. **`src/auth/auth.module.ts`**
   - Registered `ServiceApiKeyGuard` as provider

7. **`src/auth/strategies/jwt.strategy.ts`**
   - Updated for backward compatibility (handles both legacy and new token formats)

8. **`src/audit/audit.service.ts`**
   - Added `TOKEN_INTROSPECTION_SUCCESS` and `TOKEN_INTROSPECTION_FAILED` event types

---

## Endpoint Details

### POST /v1/auth/introspect

**Authentication:** Service API key (Bearer token in Authorization header)

**Request Body:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenTypeHint": "access_token",
  "includeUser": true
}
```

**Response (Active Token):**
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

**Response (Inactive Token):**
```json
{
  "active": false,
  "error_code": "expired",
  "exp": 1738000900,
  "iat": 1738000000
}
```

**Rate Limiting:** 100 requests per minute per service

---

## Security Features

### 1. Service API Key Authentication
- All introspection requests require a service API key
- Key must be stored in GCP Secret Manager in production
- Never logged or exposed in error messages

### 2. Algorithm Validation
- Rejects tokens with `alg: "none"`
- Enforces allow-list of algorithms (default: HS256)
- Prevents algorithm confusion attacks

### 3. Session Revocation Check
- Verifies session is still active in database
- Returns `revoked: true` if session has been deleted
- Ensures tokens are immediately invalidated after logout

### 4. HIPAA Compliance
- No PHI in introspection requests/responses
- All introspection events are audit logged
- Never logs raw tokens
- Sanitized error messages

### 5. Rate Limiting
- 100 requests per minute per service
- Prevents DoS attacks
- Returns 429 on limit exceeded

---

## Backward Compatibility

The implementation maintains full backward compatibility with existing tokens:

- **Legacy Format:** `{ id, sessionId, role, iat, exp }`
- **New Format:** `{ sub, sid, role, iss, aud, scope, iat, exp, nbf }`

Both formats are supported in:
- Token generation (`getTokensData()`)
- Token validation (`JwtStrategy`)
- Token introspection (`introspectToken()`)

---

## Configuration

### Environment Variables

```bash
# Service API key for introspection endpoint
AUTH_INTROSPECTION_SERVICE_KEY=<GCP_SECRET_MANAGER:auth-introspection-service-key>

# Rate limiting (requests per minute)
AUTH_INTROSPECTION_RATE_LIMIT=100

# JWT standards configuration
AUTH_JWT_ISSUER=https://keystone-core-api.production.example.com
AUTH_JWT_AUDIENCE=anythingllm
AUTH_JWT_KEY_ID=hmac-2025-01
AUTH_JWT_ALLOWED_ALGORITHMS=HS256
```

### Production Requirements

1. **Service API Key:**
   - Must be stored in GCP Secret Manager
   - Rotate every 90 days
   - Use different key per service (if multiple services)

2. **HTTPS:**
   - All introspection requests must use HTTPS
   - Enforce at load balancer level

3. **Audit Logging:**
   - Forward logs to GCP Cloud Logging
   - Retain for 6+ years for HIPAA compliance

---

## Testing

### Example Request

```bash
curl -X POST https://keystone-core-api.example.com/v1/auth/introspect \
  -H "Authorization: Bearer <SERVICE_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "X-Client-Service: anythingllm" \
  -d '{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "includeUser": true
  }'
```

### Test Cases

1. **Valid Token:** Should return `active: true` with user information
2. **Expired Token:** Should return `active: false` with `error_code: "expired"`
3. **Revoked Session:** Should return `active: false` with `revoked: true`
4. **Invalid Token:** Should return `active: false` with `error_code: "invalid_token"`
5. **Missing API Key:** Should return 401 Unauthorized
6. **Invalid API Key:** Should return 401 Unauthorized

---

## Monitoring & Alerting

### Key Metrics

Track:
- `token_introspection_rate` (requests per minute)
- `token_introspection_success_rate` (percentage)
- `token_introspection_latency` (ms)
- `token_introspection_failures_by_reason` (count by reason)

### Alerts

**Critical:**
- Introspection endpoint error rate > 1%
- Service API key validation failures > 10 in 5 minutes

**Warning:**
- Introspection latency > 200ms (p95)
- Rate limit hits > 50 in 5 minutes

---

## Integration with AnythingLLM

See `docs/anythingllm-external-auth-implementation.md` for the AnythingLLM integration guide.

The introspection endpoint is designed to be called by AnythingLLM's middleware to validate tokens before allowing access to protected resources.

---

## Future Enhancements

1. **Token Caching:**
   - Add Redis caching for introspection results
   - Reduce load on Keystone Core API

2. **Multiple Service Keys:**
   - Support per-service API keys
   - Better audit trail and revocation

3. **RS256 Support:**
   - Add RS256 algorithm support
   - Use asymmetric keys for better security

4. **Token Refresh:**
   - Add endpoint for refreshing tokens
   - Reduce token introspection calls

---

**Document Status:** Implementation Complete  
**Last Updated:** 2025-01-27  
**Standards:** RFC 7662, RFC 7519, RFC 9068, HIPAA
