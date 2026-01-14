# AnythingLLM Testing Guide

**Project:** Keystone Core API → AnythingLLM Integration  
**Last Updated:** 2025-01-27  
**Focus:** Complete testing documentation for AnythingLLM integration

---

## Executive Summary

This guide provides comprehensive testing documentation for the AnythingLLM integration, covering unit tests, integration tests, E2E tests, and role delegation testing.

---

## Quick Test Commands

### Unit Tests (Mocked - Fast)

```bash
# All AnythingLLM unit tests
npm test -- anythingllm

# Specific service tests
npm test -- anythingllm-service-identity.service.spec.ts
npm test -- anythingllm-client.service.spec.ts
npm test -- anythingllm-registry-client.spec.ts
npm test -- anythingllm-admin.service.spec.ts
```

### Integration Tests (Real GCP Credentials - Slower)

```bash
# Run integration tests with real token minting
# Requires: GOOGLE_APPLICATION_CREDENTIALS or ADC configured
npm run test:integration -- service-identity.integration.spec.ts

# With explicit credentials
GOOGLE_APPLICATION_CREDENTIALS=.secrets/application_default_credentials.json \
npm run test:integration -- service-identity.integration.spec.ts

# Skip if credentials not available
SKIP_GCP_TESTS=true npm run test:integration -- service-identity.integration.spec.ts
```

### E2E Tests (Full End-to-End - Requires AnythingLLM Running)

```bash
# Run E2E tests with real AnythingLLM instance
ANYTHINGLLM_BASE_URL=http://localhost:3001/api \
npm run test:e2e -- service-identity.e2e-spec.ts

# Skip if AnythingLLM not available
SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- service-identity.e2e-spec.ts
```

---

## Test Files

### Unit Tests (src/)

- ✅ `src/anythingllm/services/anythingllm-service-identity.service.spec.ts` - Token minting (mocked)
- ✅ `src/anythingllm/services/anythingllm-client.service.spec.ts` - HTTP client (mocked)
- ✅ `src/anythingllm/registry/anythingllm-registry-client.spec.ts` - Registry client (mocked)
- ✅ `src/anythingllm/admin/anythingllm-admin.service.spec.ts` - Admin service (mocked)

### Integration Tests (test/)

- ⚠️ `test/anythingllm/service-identity.integration.spec.ts` - Real GCP token minting (requires credentials)

### E2E Tests (test/)

- ⚠️ `test/anythingllm/service-identity.e2e-spec.ts` - Full S2S flow (requires AnythingLLM)
- ⚠️ `test/anythingllm/admin-proxy.e2e-spec.ts` - Admin proxy endpoints (requires AnythingLLM)
- ⚠️ `test/anythingllm/endpoints-s2s-delegation.e2e-spec.ts` - S2S token delegation
- ⚠️ `test/anythingllm/system-endpoints.e2e-spec.ts` - System endpoints
- ⚠️ `test/anythingllm/keystone-api-role-delegation.e2e-spec.ts` - Role delegation

---

## Role Delegation Testing

### Overview

Role delegation tests verify that role information is correctly embedded in delegated tokens and enforced by AnythingLLM.

### Test Files

1. **`keystone-api-role-delegation.e2e-spec.ts`**
   - Tests complete bidirectional role delegation flow
   - Token issuance with different roles (admin, manager, user)
   - Token structure validation
   - Complete flow analysis
   - Role extraction and authorization enforcement

2. **`endpoints-s2s-delegation.e2e-spec.ts`**
   - Tests S2S token delegation for AnythingLLM endpoints
   - System endpoints with delegated tokens
   - Service identity fallback
   - Role-based access control

3. **`system-endpoints.e2e-spec.ts`**
   - Tests system endpoints with role-based authorization
   - Admin, manager, and user role access
   - Service identity authentication
   - Endpoint-specific authorization

### Test Scenarios

#### Scenario 1: Admin Role Delegation

**Flow:**
```
1. Admin user authenticates → Gets user JWT
2. Admin calls Keystone endpoint → Sends user JWT
3. Keystone validates JWT → Extracts admin role
4. Keystone issues delegated token → { sub: 'svc-keystone', act: { roles: ['admin'] } }
5. Keystone calls AnythingLLM → Uses delegated token
6. AnythingLLM validates token → Extracts admin role
7. AnythingLLM enforces authorization → Admin has full access
```

**Test Verification:**
- ✅ Token issued with `act.roles: ['admin']`
- ✅ Token structure: `sub: 'svc-keystone'`
- ✅ Role extraction successful
- ✅ Authorization check passed (admin has access)

#### Scenario 2: Manager Role Delegation

**Flow:**
```
1. Manager user authenticates → Gets user JWT
2. Manager calls Keystone endpoint → Sends user JWT
3. Keystone validates JWT → Extracts manager role
4. Keystone issues delegated token → { sub: 'svc-keystone', act: { roles: ['manager'] } }
5. Keystone calls AnythingLLM → Uses delegated token
6. AnythingLLM validates token → Extracts manager role
7. AnythingLLM enforces authorization → Manager has limited admin access
```

**Test Verification:**
- ✅ Token issued with `act.roles: ['manager']`
- ✅ Manager has access to read operations
- ✅ Manager does NOT have access to write operations
- ✅ Authorization check passed (manager has limited access)

#### Scenario 3: User Role Delegation

**Flow:**
```
1. Regular user authenticates → Gets user JWT
2. User calls Keystone endpoint → Sends user JWT
3. Keystone validates JWT → Extracts user role
4. Keystone issues delegated token → { sub: 'svc-keystone', act: { roles: ['user'] } }
5. Keystone calls AnythingLLM → Uses delegated token
6. AnythingLLM validates token → Extracts user role
7. AnythingLLM enforces authorization → User has basic access only
```

**Test Verification:**
- ✅ Token issued with `act.roles: ['user']`
- ✅ User has access to system read operations
- ✅ User does NOT have access to admin operations
- ✅ Authorization check passed (user has basic access)

### Token Structure Analysis

#### Delegated Token Payload

```json
{
  "sub": "svc-keystone",           // Service identity (S2S medium)
  "act": {                          // Actor claim (RFC 8693)
    "sub": "user-123",              // Original user ID
    "roles": ["admin"],              // User roles
    "sessionId": "session-456",     // Session ID for audit
    "provider": "google"             // Auth provider (optional)
  },
  "scope": ["anythingllm:admin:read", "anythingllm:admin:write"],
  "aud": "anythingllm",             // Audience
  "iat": 1738000000,                // Issued at
  "exp": 1738000300,                // Expiration
  "nbf": 1737999940                 // Not before
}
```

#### Key Claims Verification

| Claim | Expected Value | Test Verification |
|-------|---------------|-------------------|
| `sub` | `"svc-keystone"` | ✅ Verified in all tests |
| `act.sub` | User ID (string) | ✅ Verified for admin, manager, user |
| `act.roles` | Array of roles | ✅ Verified: `['admin']`, `['manager']`, `['user']` |
| `act.sessionId` | Session ID (optional) | ✅ Verified when provided |
| `aud` | `"anythingllm"` | ✅ Verified matches configuration |
| `scope` | OAuth2 scopes | ✅ Verified based on role permissions |
| `exp` | Unix timestamp | ✅ Verified expiration is set correctly |

### Role-Based Authorization Matrix

#### Admin Role

| Operation | Access | Scopes |
|-----------|--------|--------|
| `SYSTEM_READ` | ✅ Full | `anythingllm:system:read` |
| `SYSTEM_AUTH_CHECK` | ✅ Full | `anythingllm:system:read` |
| `ADMIN_USER_CREATE` | ✅ Full | `anythingllm:admin:read`, `anythingllm:admin:write` |
| `ADMIN_USER_DELETE` | ✅ Full | `anythingllm:admin:write` |
| `ADMIN_WORKSPACE_CREATE` | ✅ Full | `anythingllm:admin:write` |
| `WORKSPACE_READ` | ✅ Full | `anythingllm:system:read` |
| `WORKSPACE_DELETE` | ✅ Full | `anythingllm:admin:write` |

#### Manager Role

| Operation | Access | Scopes |
|-----------|--------|--------|
| `SYSTEM_READ` | ✅ Full | `anythingllm:system:read` |
| `SYSTEM_AUTH_CHECK` | ✅ Full | `anythingllm:system:read` |
| `ADMIN_USER_CREATE` | ✅ Limited | `anythingllm:admin:read` |
| `ADMIN_USER_DELETE` | ❌ Denied | - |
| `ADMIN_WORKSPACE_CREATE` | ✅ Limited | `anythingllm:admin:read` |
| `WORKSPACE_READ` | ✅ Full | `anythingllm:system:read` |
| `WORKSPACE_DELETE` | ✅ Own only | `anythingllm:system:read` |

#### User Role

| Operation | Access | Scopes |
|-----------|--------|--------|
| `SYSTEM_READ` | ✅ Full | `anythingllm:system:read` |
| `SYSTEM_AUTH_CHECK` | ✅ Full | `anythingllm:system:read` |
| `ADMIN_USER_CREATE` | ❌ Denied | - |
| `ADMIN_USER_DELETE` | ❌ Denied | - |
| `ADMIN_WORKSPACE_CREATE` | ❌ Denied | - |
| `WORKSPACE_READ` | ✅ Own only | `anythingllm:system:read` |
| `WORKSPACE_DELETE` | ✅ Own only | `anythingllm:system:read` |

### Running Role Delegation Tests

```bash
# Run complete role delegation tests
npm run test:e2e -- keystone-api-role-delegation.e2e-spec.ts

# Run S2S delegation tests
npm run test:e2e -- endpoints-s2s-delegation.e2e-spec.ts

# Run system endpoints tests
npm run test:e2e -- system-endpoints.e2e-spec.ts

# Skip if AnythingLLM not available
SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- keystone-api-role-delegation.e2e-spec.ts
```

### Test Output Analysis

#### Successful Test Output

```
✓ should issue delegated token with admin role for admin user
  - Token issued successfully
  - Token structure verified: sub=svc-keystone, act.roles=['admin']
  - Role extraction successful
  - Authorization check passed

✓ should analyze complete role delegation flow for admin
  - User JWT authenticated
  - Delegated token issued with admin role
  - Token structure: sub=svc-keystone, act.roles=[admin]
  - Role extraction successful
  - Authorization check passed (admin role)
```

---

## Troubleshooting

### Error: "Failed to fetch ID token"

This error occurs when:

1. **Integration tests are running but credentials are invalid/missing**
   - Solution: Check `GOOGLE_APPLICATION_CREDENTIALS` points to valid key file
   - Or: Run `gcloud auth application-default login` for ADC

2. **Integration tests are skipped but service is being called elsewhere**
   - Solution: Integration tests use `.skip()` by default - they won't run unless you remove `.skip()`

3. **Service is being initialized during module setup**
   - Solution: This is expected - the service tries to mint tokens when called, but integration tests are skipped

### To Enable Integration Tests

Remove `.skip()` from test cases in `test/anythingllm/service-identity.integration.spec.ts`:

```typescript
// Change from:
it.skip('should mint a valid GCP ID token...', async () => {

// To:
it('should mint a valid GCP ID token...', async () => {
```

---

## Recommended Test Flow

1. **Start with unit tests** (fast, no dependencies):
   ```bash
   npm test -- anythingllm
   ```

2. **Then integration tests** (requires GCP credentials):
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=.secrets/application_default_credentials.json \
   npm run test:integration -- service-identity.integration.spec.ts
   ```

3. **Finally E2E tests** (requires AnythingLLM running):
   ```bash
   ANYTHINGLLM_BASE_URL=http://localhost:3001/api \
   npm run test:e2e -- service-identity.e2e-spec.ts
   ```

---

## Test Coverage Summary

### What the Tests Verify

1. ✅ **Token Issuance**: Keystone correctly issues delegated tokens with role information
2. ✅ **Token Structure**: Tokens have correct structure (sub: 'svc-keystone', act: {userId, roles})
3. ✅ **Role Extraction**: Roles are correctly extracted from act claim
4. ✅ **Authorization**: Role-based authorization is enforced correctly
5. ✅ **Complete Flow**: End-to-end flow works for all roles (admin, manager, user)
6. ✅ **Error Handling**: Invalid tokens are rejected correctly
7. ✅ **Bidirectional**: Tests cover both Keystone → AnythingLLM and AnythingLLM → Keystone flows

### Test Coverage

- **Token Issuance**: 3 tests (admin, manager, user)
- **Complete Flow Analysis**: 3 tests (admin, manager, user)
- **Token Validation**: 4 tests (structure, expiration, audience, errors)
- **Authorization Matrix**: 3 tests (admin, manager, user)
- **Total**: 13+ comprehensive test cases

---

## Related Documentation

- [Debugging Guide](debugging.md) - Troubleshooting guide
- [Authentication Setup](../authentication/setup.md) - Setup requirements
- [Delegated Token Authentication](../authentication/delegated-tokens.md) - Token structure details

---

**Last Updated:** 2025-01-27  
**Version:** 2.0 (Consolidated)


