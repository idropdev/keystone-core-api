# AnythingLLM Multi-User External API Authentication Integration Plan

**Project:** AnythingLLM + Keystone Core API Integration  

**Date:** 2025-01-27  

**Focus:** HIPAA-Compliant Authentication Flow  

**Status:** Action Plan for Review (Updated to reflect Keystone Core API implementation)

---

## Executive Summary

This document outlines the action plan for integrating AnythingLLM's multi-user authentication with the Keystone Core API that handles Google, Apple, Facebook, and email authentication with JWT token issuance. The integration must maintain HIPAA compliance throughout the authentication and authorization flow.

**Key Requirement:** AnythingLLM will accept and validate JWT tokens issued by the Keystone Core API instead of generating its own tokens.

**Current Keystone Core API State:**
- ✅ Mobile-first OAuth flow (Google, Apple, Facebook, Email)
- ✅ JWT tokens with HS256 (HMAC) algorithm
- ✅ Session-based authentication with revocation support
- ✅ HIPAA-compliant audit logging
- ✅ No PHI in JWT payloads
- ⚠️ **Token introspection endpoint needs to be built** (this plan)
- ⚠️ **JWKS endpoint not available** (would require RS256 migration)

---

## 1. Authentication Architecture Overview

### 1.1 Current State (AnythingLLM)

**AnythingLLM Authentication:**
- Multi-user mode with username/password
- JWT tokens signed with `JWT_SECRET` (local secret)
- Tokens contain: `{ id: userId, username?, iat, exp }`
- Middleware: `validatedRequest.js` → `validateMultiUserRequest()`
- Validation: Decodes JWT → Verifies signature → Loads user from database

**Current Flow:**
```
User Login → AnythingLLM validates password → 
AnythingLLM issues JWT → Client stores JWT → 
Client sends JWT on each request → AnythingLLM validates JWT
```

### 1.2 Target State (Integrated with Keystone Core API)

**Keystone Core API Authentication (Current Implementation):**
- Mobile-first OAuth: Google Sign-In, Apple Sign-In, Facebook Sign-In, Email/Password
- POST `/v1/auth/google/login` with `{ idToken }`
- POST `/v1/auth/apple/login` with `{ idToken, firstName?, lastName? }`
- POST `/v1/auth/facebook/login` with `{ accessToken }`
- POST `/v1/auth/email/login` with `{ email, password }`
- Issues JWT tokens with: `{ id, role: { id, name }, sessionId, iat, exp }` (NO PHI)
- Short-lived access tokens (~15 min) + long-lived refresh tokens
- Session-based authentication with session table
- HS256 (HMAC) algorithm with shared secret

**JWT Payload Structure (Keystone Core API - Standards-Aligned):**

**Current Implementation (Legacy):**
```typescript
{
  id: number | string,           // User ID (legacy - will migrate to 'sub')
  role: {                        // Role object (not string)
    id: number | string,         // Role ID (1 = admin, 2 = user)
    name?: string                // Role name ('admin' or 'user')
  },
  sessionId: number | string,    // Session ID (legacy - will migrate to 'sid')
  iat: number,                   // Issued at timestamp
  exp: number                   // Expiration timestamp
}
```

**Target Implementation (RFC 7519 + RFC 9068 Aligned):**
```typescript
{
  // Standard Claims (RFC 7519)
  sub: string,                   // Subject (user ID) - RFC 7519 standard claim
  iss: string,                   // Issuer URL (e.g., "https://keystone.example.com")
  aud: string | string[],        // Audience (e.g., "anythingllm")
  iat: number,                   // Issued at timestamp
  exp: number,                   // Expiration timestamp
  nbf?: number,                  // Not before (optional)
  
  // Custom Claims (App-specific, non-PHI)
  sid: string,                   // Session ID for revocation (custom claim)
  role: {                        // Role object
    id: number | string,
    name?: string
  },
  scope?: string,                // OAuth2 scope (e.g., "anythingllm:read anythingllm:write")
}
```

**JWT Header (RFC 9068 Aligned):**
```typescript
{
  alg: "HS256",                  // Algorithm (HS256 now, RS256 later)
  typ: "at+jwt",                 // RFC 9068: JWT Profile for OAuth 2.0 Access Tokens
  kid: "hmac-2025-01"            // Key ID for rotation support
}
```

**Migration Note:** Existing tokens use `id` and `sessionId`. For backward compatibility during migration, the introspection endpoint should accept both formats. New tokens will use `sub` and `sid`.

**User Model (Keystone Core API):**
```typescript
{
  id: number | string,
  email: string | null,          // May be null (Apple private relay)
  provider: 'email' | 'google' | 'apple' | 'facebook',
  socialId: string | null,       // Provider user ID (Google sub, Apple sub)
  firstName: string | null,
  lastName: string | null,
  role: { id: number | string, name?: string } | null,
  status: { id: number | string } | null,
  createdAt: Date,
  updatedAt: Date
}
```

**New Integrated Flow:**
```
User authenticates with Keystone Core API → 
Keystone Core API validates (Google/Apple/Facebook/Email) → 
Keystone Core API issues JWT → Client stores JWT → 
Client sends JWT to AnythingLLM → 
AnythingLLM validates JWT (via introspection endpoint) → 
AnythingLLM loads/finds user → Request proceeds
```

---

## 2. Integration Patterns (HIPAA-Compliant Options)

### 2.1 Option A: Token Introspection (Recommended for HIPAA) ⭐

**How It Works:**
- AnythingLLM receives JWT from client
- AnythingLLM calls Keystone Core API's token introspection endpoint
- Keystone Core API validates token and returns user info
- AnythingLLM uses returned user info to proceed

**Pros:**
- ✅ No shared secrets (better security isolation)
- ✅ Token revocation handled centrally (session-based)
- ✅ Keystone Core API maintains full control over auth state
- ✅ Supports real-time token validation
- ✅ HIPAA-compliant (no secrets exposed)
- ✅ Works with current HS256 implementation (no migration needed)

**Cons:**
- ⚠️ Requires network call on every request (performance overhead)
- ⚠️ Dependency on Keystone Core API availability
- ⚠️ Requires caching strategy

**Keystone Core API Endpoint to Build (RFC 7662 Aligned):**

**Endpoint Contract:**
```typescript
// POST /v1/auth/introspect
// Service-to-service endpoint (RFC 7662: OAuth 2.0 Token Introspection)
// Requires service API key authentication (RFC 7662 requirement)

// Headers:
//   Authorization: Bearer <SERVICE_API_KEY>
//   Content-Type: application/json

// Request (JSON variant - RFC 7662 allows form-encoded or JSON):
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenTypeHint": "access_token",  // Optional, RFC 7662
  "includeUser": true               // Optional, app-specific
}

// Response (RFC 7662 compliant):
{
  // RFC 7662 Required Field
  "active": true,                   // Required boolean per RFC 7662
  
  // RFC 7662 Standard Claims (when active=true)
  "sub": "123",                     // Subject (user ID)
  "sid": "456",                     // Session ID (custom claim)
  "iss": "https://keystone.example.com",  // Issuer
  "aud": "anythingllm",             // Audience
  "scope": "anythingllm:read anythingllm:write",  // OAuth2 scope
  "exp": 1738000900,                // Expiration timestamp
  "iat": 1738000000,                // Issued at timestamp
  "nbf": 1737999940,                // Not before (if present)
  
  // App-Specific Fields (non-PHI)
  "revoked": false,                 // Helper flag (non-standard, optional)
  "role": { "id": 2, "name": "user" },
  "provider": "google",
  
  // Optional User Info (only if includeUser=true)
  "email": null                     // May be null (Apple private relay)
}

// Response (when active=false):
{
  "active": false,
  "error_code": "expired" | "invalid_token" | "revoked"  // Optional, non-sensitive
}
```

**RFC 7662 Compliance Notes:**
- ✅ `active` field is required (boolean)
- ✅ Standard claims (`sub`, `iss`, `aud`, `exp`, `iat`) when `active=true`
- ✅ Service-to-service authentication required (Authorization header)
- ✅ Caching recommended (with revocation lag awareness)
- ✅ Rate limiting required (DoS protection)

**HIPAA Compliance Considerations:**
- ✅ No PHI in token introspection request/response
- ✅ Service-to-service authentication prevents unauthorized introspection
- ✅ All introspection calls logged for audit trail
- ✅ Token contains minimal info (id, role, sessionId only)
- ✅ Email only included if explicitly requested and user has permission

**Implementation on Keystone Core API Side (RFC 7662 Aligned):**

1. **Create `POST /v1/auth/introspect` endpoint**
   - Accept JSON body (RFC 7662 allows form-encoded or JSON)
   - Return RFC 7662 compliant response with `active` field

2. **Add Service API Key Authentication Guard**
   - Read `Authorization: Bearer <SERVICE_API_KEY>` header
   - Compare with `AUTH_INTROSPECTION_SERVICE_KEY` from Secret Manager
   - Reject with 401 if invalid (RFC 7662 requires authenticated caller)

3. **Token Validation Logic**
   ```typescript
   verify(token, AUTH_JWT_SECRET, {
     algorithms: ['HS256'],  // Enforce algorithm allow-list
     issuer: 'https://keystone.example.com',  // Validate iss
     audience: 'anythingllm'  // Validate aud
   });
   
   // Additional checks:
   // - exp / iat / nbf validation
   // - Session lookup by sid
   // - If session missing/revoked → active = false
   ```

4. **Response Rules**
   - If valid + session active: `active = true`, return standard claims
   - If invalid/expired/revoked: `active = false`, optional `error_code`

5. **HIPAA-Safe Audit Logging**
   - Log `TOKEN_INTROSPECTION_SUCCESS` / `TOKEN_INTROSPECTION_FAILED`
   - Include: `userId` (sub), `sid`, `clientService`, `reason` (if failed)
   - Never log: raw token, PHI

6. **Rate Limiting & DoS Protection**
   - Throttle: 100 req/min per service
   - On limit exceeded: 429 with `{ "error": "too_many_requests" }`

### 2.2 Option B: Shared JWT Secret (Simpler but Less Secure)

**How It Works:**
- Keystone Core API and AnythingLLM share the same JWT signing secret (`AUTH_JWT_SECRET`)
- AnythingLLM validates JWT locally using shared secret
- No network call required

**Pros:**
- ✅ Fast validation (no network overhead)
- ✅ Works offline (no Keystone Core API dependency)
- ✅ Simple implementation
- ✅ Works with current HS256 implementation

**Cons:**
- ⚠️ Shared secret management complexity
- ⚠️ Secret rotation requires coordination
- ⚠️ Less secure (broader attack surface)
- ⚠️ Token revocation requires additional mechanism (session verification)

**HIPAA Compliance Considerations:**
- ⚠️ Secret must be stored securely (GCP Secret Manager)
- ⚠️ Secret rotation must be coordinated
- ⚠️ Requires additional session verification for revocation
- ✅ Still no PHI in JWT payload

**Implementation (Standards-Aligned):**
```javascript
// AnythingLLM middleware: server/utils/middleware/validateExternalToken.js
// RFC 6750: Bearer Token Usage, RFC 7662: Token Introspection

async function validateExternalToken(req, res, next) {
  if (!ExternalAuthConfig.enabled) {
    return next(); // Fall back to internal auth if feature is off
  }

  // RFC 6750: Extract Bearer token
  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Optional: Light structural check (no cryptographic validation here)
  const decodedPayload = safeDecodePayload(token); // Base64URL decode JSON
  if (
    !decodedPayload ||
    typeof decodedPayload.sub !== "string" ||  // RFC 7519: sub claim
    typeof decodedPayload.exp !== "number"
  ) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Quick local exp check to avoid unnecessary network calls
  const now = Math.floor(Date.now() / 1000);
  const exp = decodedPayload.exp;
  const skew = 60; // 60s skew for clock differences
  if (exp + skew < now) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // RFC 7662: Token Introspection with caching (RFC 7662 recommends caching)
  const cacheKey = `introspect:${token}`;
  let introspection = await cache.get(cacheKey);

  if (!introspection) {
    introspection = await callKeystoneIntrospect(token);
    if (introspection.active) {
      await cache.set(cacheKey, introspection, TTL_IN_SECONDS);
    }
  }

  // RFC 7662: Check active field
  if (!introspection || !introspection.active) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Defense in depth: Re-check iss/aud from introspection response
  if (
    introspection.iss !== "https://keystone.example.com" ||
    introspection.aud !== "anythingllm"
  ) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Upsert local user
  const externalUser = {
    id: introspection.sub,  // RFC 7519: sub claim
    role: introspection.role,
    provider: introspection.provider,
    email: introspection.email ?? null,
    scope: introspection.scope ?? "",
    sid: introspection.sid  // Session ID
  };

  const localUser = await syncExternalUser(externalUser);

  res.locals.user = localUser;
  res.locals.externalUser = externalUser;
  res.locals.scope = externalUser.scope.split(" ").filter(Boolean);  // OAuth2 scopes

  return next();
}
```

### 2.3 Option C: Public Key Verification (RS256 - Best Security, Requires Migration)

**How It Works:**
- Keystone Core API signs JWTs with private key (RS256 algorithm)
- AnythingLLM validates using Keystone Core API's public key
- Public key fetched from Keystone Core API's JWKS endpoint

**Pros:**
- ✅ Strongest security (no shared secrets)
- ✅ Public key rotation supported via JWKS
- ✅ Industry standard (OAuth2/OIDC pattern)
- ✅ HIPAA-compliant

**Cons:**
- ⚠️ Requires migration from HS256 to RS256 in Keystone Core API
- ⚠️ Requires JWKS endpoint implementation
- ⚠️ Slightly more complex implementation
- ⚠️ Public key caching required

**Keystone Core API Requirements (Not Currently Implemented):**
- JWKS endpoint: `GET /.well-known/jwks.json`
- RS256 signing algorithm (currently HS256)
- Proper `iss` (issuer) and `aud` (audience) claims in JWT
- Key rotation mechanism

**HIPAA Compliance Considerations:**
- ✅ No secrets shared
- ✅ Public key rotation supported
- ✅ Strong cryptographic validation
- ✅ Industry-standard OAuth2 pattern

**Note:** This option requires significant changes to Keystone Core API (algorithm migration, JWKS endpoint). Not recommended for initial implementation.

---

## 3. User Synchronization Strategy

### 3.1 User Mapping Approach

**Challenge:** Keystone Core API has its own user IDs. AnythingLLM needs to map external users to local users.

**Solution:** Add `externalId` and `externalProvider` fields to AnythingLLM users table.

**Database Schema Changes:**
```prisma
model users {
  id                Int       @id @default(autoincrement())
  username          String?   @unique
  password          String?   // Null for external-only users
  externalId        String?   @unique // Keystone Core API user ID (number or string)
  externalProvider  String?   // "keystone-core-api"
  pfpFilename       String?
  role              String    @default("default")
  suspended         Int       @default(0)
  dailyMessageLimit Int?
  bio               String?
  createdAt         DateTime  @default(now())
  lastUpdatedAt     DateTime  @default(now())
  
  @@index([externalId, externalProvider])
}
```

### 3.2 User Sync Function

```javascript
// server/utils/auth/syncExternalUser.js
const { User } = require("../../models/user");

async function syncExternalUser(externalUser, existingUser = null) {
  const {
    id: externalId,
    email,
    role,  // { id, name } object from Keystone Core API
    provider,  // "google", "apple", "facebook", "email"
    firstName,
    lastName
  } = externalUser;

  // Generate username from email if not provided
  const username = email 
    ? email.split("@")[0].toLowerCase().replace(/[^a-z0-9_\-.]/g, "")
    : `user_${externalId}`;

  if (existingUser) {
    // Update existing user
    await User.update(existingUser.id, {
      role: mapExternalRoleToAnythingLLMRole(role),
      // Update other fields as needed
    });
    return existingUser;
  }

  // Create new user
  const { user, error } = await User.create({
    username,
    password: null,  // External auth only
    role: mapExternalRoleToAnythingLLMRole(role),
    dailyMessageLimit: null,
    bio: ""
  });

  if (error || !user) {
    throw new Error(`Failed to create user: ${error}`);
  }

  // Set external ID (requires direct DB update since not in writable fields)
  await prisma.users.update({
    where: { id: user.id },
    data: {
      externalId: String(externalId),  // Convert to string for consistency
      externalProvider: "keystone-core-api"
    }
  });

  return { ...user, externalId, externalProvider: "keystone-core-api" };
}

function mapExternalRoleToAnythingLLMRole(externalRole) {
  // Map Keystone Core API roles to AnythingLLM roles
  // Keystone Core API roles: { id: 1, name: 'admin' } or { id: 2, name: 'user' }
  const roleMap = {
    "admin": "admin",      // Keystone admin → AnythingLLM admin
    "user": "default",     // Keystone user → AnythingLLM default
    // Future roles can be added here
  };
  
  // Handle role object or string
  const roleName = externalRole?.name || externalRole;
  return roleMap[roleName] || "default";
}
```

### 3.3 First-Time User Flow

1. User authenticates with Keystone Core API (Google/Apple/Facebook/Email)
2. Keystone Core API issues JWT
3. Client sends JWT to AnythingLLM
4. AnythingLLM validates JWT via introspection endpoint
5. AnythingLLM checks if user exists (`externalId` lookup)
6. If not found, AnythingLLM creates user with `externalId` and `externalProvider`
7. User is now active in AnythingLLM

**Important:** Keystone Core API introspection endpoint must provide enough user info (email, role, provider) for user creation. Email may be null for Apple users (private relay).

---

## 4. HIPAA Compliance Requirements

### 4.1 Authentication Security

**Requirements:**
- ✅ Unique user identification (via `externalId`)
- ✅ Strong authentication (handled by Keystone Core API - Google/Apple OAuth)
- ✅ Session management (handled by Keystone Core API)
- ✅ Token expiration (short-lived access tokens ~15 min)
- ✅ Token revocation (via Keystone Core API session management)

**Implementation Checklist:**
- [x] JWT tokens contain only: `{ id, role: { id, name }, sessionId, iat, exp }` (NO PHI) ✅ Already implemented
- [ ] No PHI in token introspection requests/responses
- [x] All authentication events logged (user ID, timestamp, IP, success/failure) ✅ Already implemented
- [x] Failed authentication attempts logged and rate-limited ✅ Already implemented
- [x] Session inactivity timeout enforced by Keystone Core API ✅ Already implemented

### 4.2 Audit Logging

**Required Log Events (Keystone Core API Side):**

```javascript
// Token introspection events
{
  timestamp: "2025-01-27T10:30:00Z",
  service: "keystone-core-api",
  component: "auth",
  event: "TOKEN_INTROSPECTION_SUCCESS",
  userId: 123,
  sessionId: 456,
  success: true,
  clientService: "anythingllm",  // Service that requested introspection
  ipAddress: "10.0.1.50"
}

{
  timestamp: "2025-01-27T10:30:00Z",
  service: "keystone-core-api",
  component: "auth",
  event: "TOKEN_INTROSPECTION_FAILED",
  reason: "expired_token",
  success: false,
  clientService: "anythingllm",
  ipAddress: "10.0.1.50"
}
```

**Logging Implementation (Keystone Core API):**
- Add `TOKEN_INTROSPECTION_SUCCESS` and `TOKEN_INTROSPECTION_FAILED` to `AuthEventType` enum
- Log in `AuthService.introspectToken()` method
- Include `clientService` metadata to identify calling service

**Required Log Events (AnythingLLM Side):**

```javascript
// Authentication events
{
  event: "external_auth_token_validated",
  userId: 123,
  externalUserId: "456",
  ipAddress: "10.0.1.50",
  userAgent: "Mozilla/5.0...",
  timestamp: "2025-01-27T10:30:00Z",
  success: true
}

{
  event: "external_auth_token_validation_failed",
  reason: "expired_token",
  ipAddress: "10.0.1.50",
  timestamp: "2025-01-27T10:30:00Z",
  success: false
}

{
  event: "external_user_synced",
  userId: 123,
  externalUserId: "456",
  action: "created",  // or "updated"
  timestamp: "2025-01-27T10:30:00Z"
}
```

### 4.3 No PHI in Authentication Flow

**Critical Rules:**
- ❌ Never log raw tokens (only user IDs)
- ❌ Never include PHI in JWT payload (✅ Already enforced)
- ❌ Never expose PHI in error messages
- ❌ Never store PHI in authentication tables
- ✅ Log only: userId, timestamp, IP, event type, success/failure

**Token Payload Validation:**
```javascript
// Validate JWT payload contains NO PHI
const ALLOWED_JWT_CLAIMS = ['id', 'role', 'sessionId', 'iat', 'exp', 'iss', 'aud'];
const FORBIDDEN_PHI_FIELDS = ['email', 'name', 'ssn', 'dob', 'address', 'phone', 'mrn'];

function validateJWTPayload(decoded) {
  const keys = Object.keys(decoded);
  const containsPHI = keys.some(key => 
    FORBIDDEN_PHI_FIELDS.includes(key.toLowerCase())
  );
  
  if (containsPHI) {
    throw new Error("JWT contains forbidden PHI fields");
  }
  
  return true;
}
```

**Note:** Keystone Core API already enforces this - JWT payload only contains `{ id, role, sessionId, iat, exp }`.

### 4.4 Encryption in Transit

**Requirements:**
- ✅ All communication with Keystone Core API over HTTPS/TLS 1.2+
- ✅ Token introspection calls use TLS
- ✅ Enforce HTTPS in production

**Implementation:**
```javascript
// Validate Keystone Core API URL uses HTTPS in production
if (process.env.NODE_ENV === "production") {
  const url = new URL(process.env.EXTERNAL_AUTH_API_URL);
  if (url.protocol !== "https:") {
    throw new Error("EXTERNAL_AUTH_API_URL must use HTTPS in production");
  }
}
```

### 4.5 Secret Management

**Requirements:**
- ✅ No hardcoded secrets
- ✅ Secrets stored in GCP Secret Manager (TODO in Keystone Core API)
- ✅ Service-to-service authentication key stored securely
- ✅ JWT secrets (if shared) rotated every 90 days

**Environment Variables (Keystone Core API):**
```bash
# Service-to-service authentication for introspection endpoint
AUTH_INTROSPECTION_SERVICE_KEY=<GCP_SECRET_MANAGER:auth-introspection-service-key>

# JWT Secret (if using shared secret mode)
AUTH_JWT_SECRET=<GCP_SECRET_MANAGER:auth-jwt-secret>
```

**Environment Variables (AnythingLLM):**
```bash
# Keystone Core API Configuration
EXTERNAL_AUTH_API_URL=https://keystone-core-api.production.example.com
EXTERNAL_AUTH_MODE=introspect  # Options: "introspect", "shared-secret"

# Token Introspection Mode
EXTERNAL_API_SERVICE_KEY=<GCP_SECRET_MANAGER:external-api-service-key>
EXTERNAL_AUTH_INTROSPECTION_CACHE_TTL=300  # 5 minutes

# Shared Secret Mode (if used)
EXTERNAL_AUTH_JWT_SECRET=<GCP_SECRET_MANAGER:external-auth-jwt-secret>
EXTERNAL_AUTH_VERIFY_SESSION=true  # Call Keystone Core API to verify session
```

---

## 5. Implementation Roadmap

### Phase 1: Keystone Core API - Token Introspection Endpoint (Week 1)

**Tasks:**
1. [ ] **JWT Standards Migration (Optional but Recommended)**
   - [ ] Update JWT payload to use `sub` instead of `id` (RFC 7519)
   - [ ] Update JWT payload to use `sid` instead of `sessionId`
   - [ ] Add `iss`, `aud`, `scope`, `nbf` claims to tokens
   - [ ] Add `typ: "at+jwt"` and `kid` to JWT header (RFC 9068)
   - [ ] Maintain backward compatibility for existing tokens during migration

2. [ ] **Introspection Endpoint (RFC 7662)**
   - [ ] Create `TokenIntrospectDto` (request/response DTOs)
   - [ ] Create `ServiceApiKeyGuard` for caller authentication
   - [ ] Add `introspectToken()` method to `AuthService`
   - [ ] Add `POST /v1/auth/introspect` endpoint to `AuthController`
   - [ ] Implement RFC 7662 compliant response with `active` field
   - [ ] Add algorithm allow-list enforcement (reject `alg: "none"`)

3. [ ] **Security & Compliance**
   - [ ] Add rate limiting for introspection endpoint (100 req/min)
   - [ ] Add audit logging for introspection events
   - [ ] Add configuration for service API key
   - [ ] Update environment variable examples

**Files to Create/Modify (Keystone Core API):**
- `src/auth/dto/token-introspect.dto.ts` (new)
- `src/auth/guards/service-api-key.guard.ts` (new)
- `src/auth/auth.service.ts` (modify - add `introspectToken()`)
- `src/auth/auth.controller.ts` (modify - add introspection endpoint)
- `src/auth/config/auth-config.type.ts` (modify - add service key config)
- `src/auth/config/auth.config.ts` (modify - add service key validation)
- `src/audit/audit.service.ts` (modify - add introspection event types)
- `env-example-relational` (modify - add `AUTH_INTROSPECTION_SERVICE_KEY`)

**Keystone Core API Endpoint Specification (RFC 7662):**
```typescript
// POST /v1/auth/introspect
// Headers: 
//   Authorization: Bearer <SERVICE_API_KEY>  (RFC 7662: authenticated caller)
//   Content-Type: application/json
// Body: { 
//   token: string,
//   tokenTypeHint?: "access_token",  // RFC 7662 optional
//   includeUser?: boolean            // App-specific
// }

// Response (RFC 7662 compliant):
{
  active: boolean,              // RFC 7662 required field
  sub?: string,                 // RFC 7662 standard claim
  sid?: string,                 // Custom claim (session ID)
  iss?: string,                 // RFC 7662 standard claim
  aud?: string,                 // RFC 7662 standard claim
  scope?: string,               // RFC 7662 standard claim
  exp?: number,                 // RFC 7662 standard claim
  iat?: number,                 // RFC 7662 standard claim
  nbf?: number,                 // RFC 7662 standard claim
  role?: { id: number | string, name?: string },  // App-specific
  provider?: string,           // App-specific
  email?: string | null,       // App-specific (only if includeUser=true)
  error_code?: string          // Optional, non-sensitive error code
}
```

### Phase 2: AnythingLLM - Core Integration (Week 2)

**Tasks:**
1. [ ] Add `externalId` and `externalProvider` fields to users table (migration)
2. [ ] Create `validateExternalToken` middleware
3. [ ] Implement user sync function (`syncExternalUser`)
4. [ ] Add Keystone Core API configuration to environment variables
5. [ ] Update `validatedRequest` to support external auth mode
6. [ ] Add caching layer for token validation

**Files to Create/Modify (AnythingLLM):**
- `server/utils/middleware/validateExternalToken.js` (new)
- `server/utils/auth/syncExternalUser.js` (new)
- `server/utils/auth/auditAuth.js` (new)
- `server/utils/middleware/validatedRequest.js` (modify)
- `server/prisma/schema.prisma` (modify - add externalId fields)
- `server/models/user.js` (modify - add externalId support)

### Phase 3: AnythingLLM - External API Integration (Week 3)

**Tasks:**
1. [ ] Implement token introspection endpoint call
2. [ ] Add retry logic for Keystone Core API calls
3. [ ] Add circuit breaker for Keystone Core API failures
4. [ ] Implement token validation caching (Redis or in-memory)
5. [ ] Test authentication flow end-to-end

### Phase 4: User Synchronization (Week 4)

**Tasks:**
1. [ ] Implement role mapping logic
2. [ ] Handle first-time user creation
3. [ ] Handle user updates (role changes, etc.)
4. [ ] Add user sync audit logging
5. [ ] Test user sync scenarios

### Phase 5: HIPAA Hardening (Week 5)

**Tasks:**
1. [ ] Implement comprehensive audit logging (both sides)
2. [ ] Add PHI validation (no PHI in tokens/logs)
3. [ ] Enforce HTTPS for Keystone Core API calls
4. [ ] Migrate secrets to GCP Secret Manager
5. [ ] Add rate limiting for authentication endpoints
6. [ ] Add security headers

### Phase 6: Testing & Documentation (Week 6)

**Tasks:**
1. [ ] Write integration tests (Keystone Core API introspection)
2. [ ] Write E2E tests for auth flow
3. [ ] Security testing (token tampering, etc.)
4. [ ] Document API integration
5. [ ] Create runbook for operations
6. [ ] HIPAA compliance review

---

## 6. Configuration Management

### 6.1 Environment Variables (Keystone Core API)

```bash
# ===== TOKEN INTROSPECTION (Service-to-Service, RFC 7662) =====
# Service API key for introspection endpoint authentication
AUTH_INTROSPECTION_SERVICE_KEY=<GCP_SECRET_MANAGER:auth-introspection-service-key>

# Rate limiting for introspection endpoint
AUTH_INTROSPECTION_RATE_LIMIT=100  # requests per minute per service

# ===== JWT STANDARDS CONFIGURATION (RFC 7519, RFC 9068) =====
# Issuer URL (for iss claim)
AUTH_JWT_ISSUER=https://keystone-core-api.production.example.com

# Default audience (for aud claim)
AUTH_JWT_AUDIENCE=anythingllm

# Key ID for JWT header (kid claim)
AUTH_JWT_KEY_ID=hmac-2025-01

# Algorithm allow-list (enforce algorithm validation)
AUTH_JWT_ALLOWED_ALGORITHMS=HS256  # Comma-separated, future: HS256,RS256
```

### 6.2 Environment Variables (AnythingLLM)

```bash
# ===== EXTERNAL AUTHENTICATION =====
# Enable external auth mode
EXTERNAL_AUTH_ENABLED=true
EXTERNAL_AUTH_MODE=introspect  # Options: introspect, shared-secret

# Keystone Core API Configuration
EXTERNAL_AUTH_API_URL=https://keystone-core-api.production.example.com

# Token Introspection Mode
EXTERNAL_API_SERVICE_KEY=<GCP_SECRET_MANAGER:external-api-service-key>
EXTERNAL_AUTH_INTROSPECTION_CACHE_TTL=300  # 5 minutes

# Shared Secret Mode (if used)
EXTERNAL_AUTH_JWT_SECRET=<GCP_SECRET_MANAGER:external-auth-jwt-secret>
EXTERNAL_AUTH_VERIFY_SESSION=true  # Call Keystone Core API to verify session

# HTTPS Enforcement
EXTERNAL_AUTH_REQUIRE_HTTPS=true  # Enforce HTTPS in production
```

### 6.3 Feature Flag (AnythingLLM)

```javascript
// server/utils/auth/config.js
const ExternalAuthConfig = {
  enabled: process.env.EXTERNAL_AUTH_ENABLED === "true",
  mode: process.env.EXTERNAL_AUTH_MODE || "introspect",
  apiUrl: process.env.EXTERNAL_AUTH_API_URL,
  requireHTTPS: process.env.NODE_ENV === "production" && 
                process.env.EXTERNAL_AUTH_REQUIRE_HTTPS !== "false"
};

// Validate configuration
if (ExternalAuthConfig.enabled && !ExternalAuthConfig.apiUrl) {
  throw new Error("EXTERNAL_AUTH_API_URL required when EXTERNAL_AUTH_ENABLED=true");
}

module.exports = { ExternalAuthConfig };
```

---

## 7. Security Considerations

### 7.1 Token Validation Security

**Attack Vectors:**
1. **Token Replay:** Reuse of expired or revoked tokens
   - **Mitigation:** Token introspection checks revocation via session validation, cache TTL prevents stale validations

2. **Token Tampering:** Modification of JWT payload
   - **Mitigation:** Cryptographic signature validation (HS256 HMAC)

3. **Token Theft:** Interception of tokens in transit
   - **Mitigation:** HTTPS only, secure token storage (httpOnly cookies recommended)

4. **Token Injection:** Forged tokens
   - **Mitigation:** Signature verification, service API key authentication for introspection

### 7.2 Service-to-Service Security

**If Using Token Introspection:**
- Service API key must be stored securely (GCP Secret Manager)
- Service API key must be rotated regularly (every 90 days)
- Introspection endpoint must be rate-limited (100 req/min per service)
- Introspection calls must be logged for audit trail
- Service API key should be different from user JWT secret

### 7.3 Rate Limiting

**Required Rate Limits (Keystone Core API):**
```typescript
// Introspection endpoint
@Throttle({ default: { limit: 100, ttl: 60000 } })  // 100 requests per minute
@Post('introspect')
```

**Required Rate Limits (AnythingLLM):**
```javascript
// Authentication endpoints
const rateLimitConfig = {
  "/api/*/auth/*": {
    windowMs: 60 * 1000,  // 1 minute
    max: 5  // 5 requests per minute
  },
  // Token introspection calls (internal)
  internalTokenValidation: {
    windowMs: 60 * 1000,
    max: 100  // 100 validations per minute per user
  }
};
```

### 7.4 Error Handling

**Never Expose:**
- Raw tokens in error messages
- Keystone Core API internal errors
- User details in authentication failures
- PHI in any error response

**Safe Error Messages:**
```javascript
// ✅ Good
{ error: "Invalid or expired token" }
{ error: "Authentication failed" }

// ❌ Bad
{ error: "Token expired at 2025-01-27T10:30:00Z" }  // Exposes timing
{ error: "User not found: john.doe@example.com" }  // Exposes email
{ error: "Keystone Core API returned 500: Database connection failed" }  // Exposes internals
```

---

## 8. Rollback Plan

### 8.1 Feature Flag Rollback

If issues arise, disable external auth via feature flag:
```bash
EXTERNAL_AUTH_ENABLED=false
```

This reverts to AnythingLLM's native authentication.

### 8.2 Gradual Rollout

**Phase 1:** Internal testing only
- `EXTERNAL_AUTH_ENABLED=true` for test users only
- Monitor logs and errors

**Phase 2:** Beta users
- Enable for specific user groups
- Monitor authentication success rates

**Phase 3:** Full rollout
- Enable for all users
- Keep native auth as fallback option

---

## 9. Monitoring & Alerting

### 9.1 Key Metrics

```javascript
// Metrics to track
{
  external_auth_validation_success_rate: "percentage",
  external_auth_validation_latency: "ms",
  keystone_api_availability: "percentage",
  external_user_sync_errors: "count",
  external_auth_failures_by_reason: "count by reason",
  token_introspection_rate: "requests per minute"
}
```

### 9.2 Alerts

**Critical Alerts:**
- Keystone Core API unavailable for > 1 minute
- Token validation failure rate > 5%
- User sync errors > 10 in 5 minutes
- Authentication latency > 1 second (p95)
- Introspection endpoint error rate > 1%

**Warning Alerts:**
- Token validation cache miss rate > 50%
- Keystone Core API response time > 500ms (p95)
- User sync latency > 200ms

---

## 10. Testing Strategy

### 10.1 Unit Tests (Keystone Core API)

```typescript
// Tests for introspectToken method
describe("AuthService.introspectToken", () => {
  it("should validate valid token", async () => {});
  it("should reject expired token", async () => {});
  it("should reject revoked token (session deleted)", async () => {});
  it("should reject invalid signature", async () => {});
  it("should return user info when includeUser=true", async () => {});
  it("should require service API key", async () => {});
});
```

### 10.2 Integration Tests (AnythingLLM)

```javascript
// Tests for validateExternalToken middleware
describe("validateExternalToken", () => {
  it("should validate valid token", async () => {});
  it("should reject expired token", async () => {});
  it("should reject tampered token", async () => {});
  it("should reject missing token", async () => {});
  it("should handle Keystone Core API unavailability", async () => {});
});

// Tests for syncExternalUser
describe("syncExternalUser", () => {
  it("should create new user on first login", async () => {});
  it("should update existing user", async () => {});
  it("should map roles correctly", async () => {});
});
```

### 10.3 E2E Tests

```javascript
// E2E authentication flow
describe("External Auth Integration", () => {
  it("should complete full auth flow", async () => {
    // 1. User authenticates with Keystone Core API
    // 2. Keystone Core API issues JWT
    // 3. Client sends JWT to AnythingLLM
    // 4. AnythingLLM validates JWT via introspection
    // 5. Verify user created in AnythingLLM
    // 6. Verify user can access protected resources
  });
});
```

### 10.4 Security Tests

- Token tampering attempts
- Expired token reuse
- Replayed tokens
- Invalid signature tokens
- Missing required claims
- Service API key validation
- Session revocation verification

---

## 11. Open Questions & Decisions Required

### 11.1 Integration Pattern Selection

**Question:** Which integration pattern should we use?

**Recommendation:** **Token Introspection (Option A)** ⭐
- Best for HIPAA (no shared secrets)
- Supports real-time revocation
- Maintains security boundaries
- Acceptable performance with caching
- Works with current HS256 implementation (no migration needed)

**Alternative:** Shared Secret (Option B) if performance is critical and secret management is acceptable.

**Not Recommended:** RS256 (Option C) - requires significant Keystone Core API migration.

### 11.2 User Role Mapping

**Question:** How should Keystone Core API roles map to AnythingLLM roles?

**Keystone Core API Roles:**
- `{ id: 1, name: 'admin' }` → AnythingLLM `admin`
- `{ id: 2, name: 'user' }` → AnythingLLM `default`

**Future Considerations:**
- If Keystone Core API adds more roles, update mapping function
- Consider custom AnythingLLM roles for specific use cases

### 11.3 Session Management

**Question:** Should AnythingLLM maintain its own sessions, or rely entirely on Keystone Core API?

**Recommendation:** Rely on Keystone Core API for session management. AnythingLLM validates tokens only. Session revocation is handled by Keystone Core API (session deletion).

### 11.4 User Data Synchronization

**Question:** How often should user data be synced from Keystone Core API?

**Recommendation:** 
- On every authentication (validate + sync)
- Background sync job (optional, daily) for role/permission updates
- Real-time sync on role changes (if Keystone Core API supports webhooks)

### 11.5 Fallback Strategy

**Question:** What happens if Keystone Core API is unavailable?

**Options:**
1. **Fail Closed:** Reject all requests (most secure)
2. **Cached Validation:** Use cached validation results (with TTL)
3. **Graceful Degradation:** Fall back to AnythingLLM native auth

**Recommendation:** Fail closed with cached validation (5-minute TTL) to handle brief outages. Cache should be invalidated on logout events.

**RFC 7662 Note:** Caching is recommended by RFC 7662 but introduces a revocation lag window. The 5-minute TTL balances performance with security (access tokens are 15-min, so revocation lag is acceptable).

---

## 12. HIPAA Compliance Checklist

### Pre-Implementation

- [x] Keystone Core API confirmed HIPAA-compliant ✅
- [ ] BAA signed with Keystone Core API provider (if applicable)
- [ ] Security review of integration pattern
- [x] PHI handling documented (none in auth flow) ✅

### Implementation (Keystone Core API)

- [x] No PHI in JWT tokens ✅
- [ ] Token introspection endpoint implemented
- [ ] Service API key authentication implemented
- [ ] Audit logging for introspection events
- [ ] Rate limiting on introspection endpoint
- [ ] Error messages sanitized (no PHI exposure)

### Implementation (AnythingLLM)

- [ ] No PHI in audit logs
- [ ] HTTPS enforced for all Keystone Core API calls
- [ ] Secrets stored in GCP Secret Manager
- [ ] Comprehensive audit logging implemented
- [ ] Rate limiting on auth endpoints
- [ ] Error messages sanitized (no PHI exposure)

### Post-Implementation

- [ ] Security testing completed
- [ ] HIPAA compliance review
- [ ] Documentation updated
- [ ] Team training on new auth flow
- [ ] Monitoring and alerting configured

---

## 13. Recommendations

### Immediate Actions

1. **Confirm Keystone Core API Capabilities:**
   - ✅ Token introspection endpoint needs to be built (this plan)
   - ❌ JWKS endpoint not available (would require RS256 migration)
   - ✅ JWT payload structure confirmed: `{ id, role: { id, name }, sessionId, iat, exp }`
   - ✅ User model structure confirmed

2. **Choose Integration Pattern:**
   - **Recommended:** Token Introspection (best security, works with current implementation)
   - **Alternative:** Shared Secret (if performance is critical)

3. **Design User Sync Strategy:**
   - Role mapping: `admin` → `admin`, `user` → `default`
   - Sync on every authentication
   - Handle null email (Apple private relay)

### Long-Term Considerations

1. **Multi-Tenancy:** If AnythingLLM supports multiple organizations, ensure Keystone Core API user IDs are scoped correctly

2. **Token Caching:** Implement Redis or in-memory cache for token validation results (with TTL)

3. **Metrics & Observability:** Add detailed metrics for authentication flow to detect issues early

4. **Security Audits:** Regular security audits of authentication integration

5. **RS256 Migration (Future):** Consider migrating Keystone Core API to RS256 for even stronger security (requires JWKS endpoint)
   - Implement JWKS endpoint: `GET /.well-known/jwks.json`
   - Migrate from HS256 to RS256 gradually
   - Support both algorithms during migration period
   - AnythingLLM can verify signatures locally with public keys, reducing introspection calls

---

## 14. Conclusion

This action plan provides a comprehensive roadmap for integrating AnythingLLM's multi-user authentication with the Keystone Core API while maintaining HIPAA compliance. The recommended approach uses token introspection for maximum security and compliance, which works with the current HS256 implementation without requiring algorithm migration.

**Key Implementation Points:**
1. **Keystone Core API** needs to build the token introspection endpoint (`POST /v1/auth/introspect`)
2. **AnythingLLM** needs to implement external token validation middleware
3. Both sides need proper audit logging and rate limiting
4. Service-to-service authentication via API key is required

**Next Steps:**
1. Review this plan with security and compliance teams
2. Begin Phase 1: Build token introspection endpoint in Keystone Core API
3. Begin Phase 2: Implement external auth in AnythingLLM
4. Test integration end-to-end
5. Schedule regular reviews and updates

---

**Standards Compliance:**
- ✅ **RFC 7519** (JSON Web Token): Standard claims (`sub`, `iss`, `aud`, `iat`, `exp`, `nbf`)
- ✅ **RFC 7662** (OAuth 2.0 Token Introspection): Introspection endpoint with `active` field
- ✅ **RFC 9068** (JWT Profile for OAuth 2.0 Access Tokens): `typ: "at+jwt"` header
- ✅ **RFC 6750** (OAuth 2.0 Bearer Token Usage): Bearer token extraction
- ✅ **HIPAA Compliance**: No PHI in tokens, audit logging, encryption in transit

**Migration Considerations:**
- Existing tokens use `id` and `sessionId` (legacy format)
- New tokens will use `sub` and `sid` (RFC 7519 aligned)
- Introspection endpoint should accept both formats during migration
- Backward compatibility maintained for existing mobile clients

---

**Document Status:** Ready for Implementation (Standards-Aligned)  

**Last Updated:** 2025-01-27  

**Standards Review:** RFC 7519, RFC 7662, RFC 9068, RFC 6750  

**Next Review Date:** After Phase 1 completion (Keystone Core API introspection endpoint)

