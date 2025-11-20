# AnythingLLM External Authentication Implementation Guide

**Project:** AnythingLLM Integration with Keystone Core API  

**Date:** 2025-01-27  

**Focus:** Replace internal JWT auth with Keystone Core API token validation  

**Status:** Implementation Guide for AnythingLLM Team

---

## Executive Summary

This guide provides step-by-step instructions for integrating AnythingLLM's multi-user authentication with the external Keystone Core API. AnythingLLM will accept and validate JWT tokens issued by Keystone Core API instead of generating its own tokens.

**Key Principle:** Keystone Core API is the Authorization Server (OAuth2), AnythingLLM is the Resource Server.

**Standards Compliance:**
- ✅ RFC 7662 (OAuth 2.0 Token Introspection)
- ✅ RFC 6750 (OAuth 2.0 Bearer Token Usage)
- ✅ RFC 7519 (JSON Web Token)
- ✅ HIPAA Compliance (no PHI in tokens/logs)

---

## 1. Architecture Overview

### 1.1 Current State

**AnythingLLM Authentication:**
- Multi-user mode with username/password
- JWT tokens signed with `JWT_SECRET` (local secret)
- Tokens contain: `{ id: userId, username?, iat, exp }`
- Middleware: `validatedRequest.js` → `validateMultiUserRequest()`

### 1.2 Target State

**Keystone Core API Authentication:**
- Mobile-first OAuth: Google Sign-In, Apple Sign-In, Facebook Sign-In, Email/Password
- Issues JWT tokens with: `{ sub, sid, role, iss, aud, scope, iat, exp, nbf }` (NO PHI)
- Short-lived access tokens (~15 min) + long-lived refresh tokens
- Session-based authentication with revocation support
- HS256 (HMAC) algorithm

**New Flow:**
```
User authenticates with Keystone Core API → 
Keystone Core API issues JWT → Client stores JWT → 
Client sends JWT to AnythingLLM → 
AnythingLLM validates JWT via introspection endpoint → 
AnythingLLM loads/finds user → Request proceeds
```

### 1.3 JWT Token Structure (Keystone Core API)

**JWT Header (RFC 9068):**
```json
{
  "alg": "HS256",
  "typ": "at+jwt",
  "kid": "hmac-2025-01"
}
```

**JWT Payload (RFC 7519):**
```json
{
  "sub": "123",                    // Subject (user ID) - RFC 7519
  "sid": "456",                    // Session ID (custom claim)
  "role": { "id": 2, "name": "user" },
  "scope": "anythingllm:read anythingllm:write",
  "iss": "https://keystone.example.com",
  "aud": "anythingllm",
  "iat": 1738000000,
  "exp": 1738000900,
  "nbf": 1737999940
}
```

**Note:** Legacy tokens may use `id` instead of `sub` and `sessionId` instead of `sid`. The introspection endpoint handles both formats.

---

## 2. Configuration

### 2.1 Environment Variables

Add to your `.env` file:

```bash
# ===== EXTERNAL AUTHENTICATION =====
# Enable external auth mode
EXTERNAL_AUTH_ENABLED=true
EXTERNAL_AUTH_MODE=introspect  # Options: "introspect", "shared-secret"

# Keystone Core API Configuration
EXTERNAL_AUTH_API_URL=https://keystone-core-api.production.example.com
EXTERNAL_AUTH_ISSUER=https://keystone-core-api.production.example.com
EXTERNAL_AUTH_AUDIENCE=anythingllm

# Token Introspection Mode (Recommended)
EXTERNAL_API_SERVICE_KEY=<GCP_SECRET_MANAGER:external-api-service-key>
EXTERNAL_AUTH_INTROSPECTION_CACHE_TTL=300  # 5 minutes (seconds)

# Shared Secret Mode (Backup Only - Not Recommended)
# Only use in local dev or emergency situations
EXTERNAL_AUTH_JWT_SECRET=<GCP_SECRET_MANAGER:external-auth-jwt-secret>
EXTERNAL_AUTH_VERIFY_SESSION=true  # Call Keystone Core API to verify session

# HTTPS Enforcement
EXTERNAL_AUTH_REQUIRE_HTTPS=true  # Enforce HTTPS in production
```

### 2.2 Configuration Module

Create `server/utils/auth/config.js`:

```javascript
const ExternalAuthConfig = {
  enabled: process.env.EXTERNAL_AUTH_ENABLED === "true",
  mode: process.env.EXTERNAL_AUTH_MODE || "introspect",
  apiUrl: process.env.EXTERNAL_AUTH_API_URL,
  issuer: process.env.EXTERNAL_AUTH_ISSUER,
  audience: process.env.EXTERNAL_AUTH_AUDIENCE,
  serviceKey: process.env.EXTERNAL_API_SERVICE_KEY,
  cacheTTL: parseInt(process.env.EXTERNAL_AUTH_INTROSPECTION_CACHE_TTL || "300", 10),
  requireHTTPS: process.env.NODE_ENV === "production" && 
                process.env.EXTERNAL_AUTH_REQUIRE_HTTPS !== "false",
  jwtSecret: process.env.EXTERNAL_AUTH_JWT_SECRET,  // Only for shared-secret mode
  verifySession: process.env.EXTERNAL_AUTH_VERIFY_SESSION === "true"
};

// Validate configuration
if (ExternalAuthConfig.enabled) {
  if (!ExternalAuthConfig.apiUrl) {
    throw new Error("EXTERNAL_AUTH_API_URL required when EXTERNAL_AUTH_ENABLED=true");
  }
  
  if (ExternalAuthConfig.mode === "introspect" && !ExternalAuthConfig.serviceKey) {
    throw new Error("EXTERNAL_API_SERVICE_KEY required when EXTERNAL_AUTH_MODE=introspect");
  }
  
  if (ExternalAuthConfig.mode === "shared-secret" && !ExternalAuthConfig.jwtSecret) {
    throw new Error("EXTERNAL_AUTH_JWT_SECRET required when EXTERNAL_AUTH_MODE=shared-secret");
  }
  
  // Enforce HTTPS in production
  if (ExternalAuthConfig.requireHTTPS) {
    const url = new URL(ExternalAuthConfig.apiUrl);
    if (url.protocol !== "https:") {
      throw new Error("EXTERNAL_AUTH_API_URL must use HTTPS in production");
    }
  }
}

module.exports = { ExternalAuthConfig };
```

---

## 3. Database Schema Changes

### 3.1 User Model Migration

Add `externalId` and `externalProvider` fields to your users table:

**Prisma Schema:**
```prisma
model users {
  id                Int       @id @default(autoincrement())
  username          String?   @unique
  password          String?   // Null for external-only users
  externalId        String?   @unique // Keystone Core API user ID
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

**Migration:**
```sql
-- Add external auth fields
ALTER TABLE users 
  ADD COLUMN externalId VARCHAR(255) NULL,
  ADD COLUMN externalProvider VARCHAR(255) NULL;

-- Create unique index
CREATE UNIQUE INDEX users_externalId_externalProvider_idx 
  ON users(externalId, externalProvider) 
  WHERE externalId IS NOT NULL;
```

---

## 4. Token Validation Middleware

### 4.1 Introspection Mode (Recommended)

Create `server/utils/middleware/validateExternalToken.js`:

```javascript
const { ExternalAuthConfig } = require("../auth/config");
const { syncExternalUser } = require("../auth/syncExternalUser");
const cache = require("../cache"); // Your cache implementation (Redis or in-memory)

/**
 * RFC 7662: OAuth 2.0 Token Introspection
 * RFC 6750: OAuth 2.0 Bearer Token Usage
 * 
 * Validates JWT tokens issued by Keystone Core API via introspection endpoint.
 */
async function validateExternalToken(req, res, next) {
  // Feature flag: fall back to internal auth if disabled
  if (!ExternalAuthConfig.enabled) {
    return next();
  }

  // RFC 6750: Extract Bearer token
  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Optional: Light structural check (no cryptographic validation here)
  const decodedPayload = safeDecodePayload(token);
  if (
    !decodedPayload ||
    (typeof decodedPayload.sub !== "string" && typeof decodedPayload.id !== "string") ||
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

  // RFC 7662: Token Introspection with caching
  const cacheKey = `introspect:${token}`;
  let introspection = await cache.get(cacheKey);

  if (!introspection) {
    try {
      introspection = await callKeystoneIntrospect(token);
      
      // Only cache active tokens
      if (introspection && introspection.active) {
        await cache.set(cacheKey, introspection, ExternalAuthConfig.cacheTTL);
      }
    } catch (error) {
      // If introspection fails, check cache for stale result
      const cachedResult = await cache.get(cacheKey);
      if (cachedResult && cachedResult.active) {
        introspection = cachedResult;
      } else {
        // Fail closed: reject request if no cache and introspection fails
        return res.status(401).json({ error: "Invalid or expired token" });
      }
    }
  }

  // RFC 7662: Check active field
  if (!introspection || !introspection.active) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Defense in depth: Re-check iss/aud from introspection response
  if (
    introspection.iss !== ExternalAuthConfig.issuer ||
    introspection.aud !== ExternalAuthConfig.audience
  ) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Extract user info (handle both legacy and new formats)
  const externalUser = {
    id: introspection.sub || introspection.id,  // RFC 7519: sub claim (or legacy id)
    role: introspection.role,
    provider: introspection.provider,
    email: introspection.email ?? null,
    scope: introspection.scope ?? "",
    sid: introspection.sid || introspection.sessionId  // Session ID
  };

  // Sync user to local database
  const localUser = await syncExternalUser(externalUser);

  // Attach to request
  res.locals.user = localUser;
  res.locals.externalUser = externalUser;
  res.locals.scope = externalUser.scope.split(" ").filter(Boolean);  // OAuth2 scopes

  return next();
}

/**
 * Call Keystone Core API introspection endpoint (RFC 7662)
 */
async function callKeystoneIntrospect(token) {
  const response = await fetch(`${ExternalAuthConfig.apiUrl}/v1/auth/introspect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ExternalAuthConfig.serviceKey}`
    },
    body: JSON.stringify({
      token: token,
      tokenTypeHint: "access_token",
      includeUser: true
    })
  });

  if (!response.ok) {
    throw new Error(`Introspection failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * Safe base64url decode of JWT payload (no signature verification)
 */
function safeDecodePayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

module.exports = { validateExternalToken };
```

### 4.2 Shared Secret Mode (Backup Only)

**Warning:** Only use in local dev or emergency situations. Not recommended for production.

```javascript
const { decodeJWT } = require("../http");
const { ExternalAuthConfig } = require("../auth/config");

async function validateExternalTokenSharedSecret(req, res, next) {
  if (!ExternalAuthConfig.enabled || ExternalAuthConfig.mode !== "shared-secret") {
    return next();
  }

  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Validate using shared secret
  const decoded = decodeJWT(token, ExternalAuthConfig.jwtSecret);
  
  if (!decoded || (!decoded.sub && !decoded.id)) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Verify session is still valid via Keystone Core API (for revocation support)
  if (ExternalAuthConfig.verifySession) {
    const sessionId = decoded.sid || decoded.sessionId;
    const sessionValid = await verifySession(sessionId);
    if (!sessionValid) {
      return res.status(401).json({ error: "Session revoked" });
    }
  }

  // Find or sync user
  const externalUser = {
    id: decoded.sub || decoded.id,
    role: decoded.role,
    provider: decoded.provider,
    sid: decoded.sid || decoded.sessionId
  };

  const localUser = await syncExternalUser(externalUser);

  res.locals.user = localUser;
  res.locals.externalUser = externalUser;
  next();
}

async function verifySession(sessionId) {
  // Call Keystone Core API to verify session is still active
  // This is a lightweight check, not full introspection
  try {
    const response = await fetch(
      `${ExternalAuthConfig.apiUrl}/v1/auth/session/${sessionId}/verify`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${ExternalAuthConfig.serviceKey}`
        }
      }
    );
    return response.ok;
  } catch (error) {
    return false; // Fail closed
  }
}
```

---

## 5. User Synchronization

### 5.1 Sync Function

Create `server/utils/auth/syncExternalUser.js`:

```javascript
const { User } = require("../../models/user");
const prisma = require("../../prisma"); // Your Prisma client

/**
 * Sync external user from Keystone Core API to AnythingLLM database
 */
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

/**
 * Map Keystone Core API roles to AnythingLLM roles
 */
function mapExternalRoleToAnythingLLMRole(externalRole) {
  // Keystone Core API roles: { id: 1, name: 'admin' } or { id: 2, name: 'user' }
  const roleMap = {
    "admin": "admin",      // Keystone admin → AnythingLLM admin
    "user": "default",     // Keystone user → AnythingLLM default
  };
  
  // Handle role object or string
  const roleName = externalRole?.name || externalRole;
  return roleMap[roleName] || "default";
}

module.exports = { syncExternalUser };
```

### 5.2 User Lookup

Update your user model to support external ID lookup:

```javascript
// In your User model or repository
async function findByExternalId(externalId, provider = "keystone-core-api") {
  return await prisma.users.findFirst({
    where: {
      externalId: String(externalId),
      externalProvider: provider
    }
  });
}
```

---

## 6. Integration with Existing Middleware

### 6.1 Update validatedRequest

Modify `server/utils/middleware/validatedRequest.js`:

```javascript
const { validateExternalToken } = require("./validateExternalToken");
const { validateMultiUserRequest } = require("./validateMultiUserRequest"); // Existing
const { ExternalAuthConfig } = require("../auth/config");

async function validatedRequest(req, res, next) {
  // If external auth is enabled, use external validation
  if (ExternalAuthConfig.enabled) {
    return validateExternalToken(req, res, next);
  }
  
  // Otherwise, use existing internal auth
  return validateMultiUserRequest(req, res, next);
}

module.exports = { validatedRequest };
```

---

## 7. Audit Logging

### 7.1 Logging Implementation

Create `server/utils/auth/auditAuth.js`:

```javascript
const { EventLogs } = require("../../models/eventLogs");

/**
 * Log authentication events (HIPAA-compliant)
 * 
 * Rules:
 * - Never log raw tokens
 * - Never log PHI (email, name, etc.)
 * - Only log: userId, timestamp, IP, event type, success/failure
 */
async function logAuthEvent(eventType, metadata, userId = null) {
  await EventLogs.logEvent(eventType, {
    ...metadata,
    authProvider: "keystone-core-api",
    timestamp: new Date().toISOString()
  }, userId);

  // TODO: Forward to GCP Cloud Logging for HIPAA audit retention
  // console.info(JSON.stringify({
  //   compliance: "HIPAA",
  //   event: eventType,
  //   ...metadata
  // }));
}

module.exports = { logAuthEvent };
```

### 7.2 Event Types

Add to your event logging system:

```javascript
// Authentication events
{
  event: "external_auth_token_validated",
  userId: 123,
  externalUserId: "456",
  ipAddress: "10.0.1.50",
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

---

## 8. Error Handling

### 8.1 Safe Error Messages

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

## 9. Rate Limiting

### 9.1 Add Rate Limiting

```javascript
const rateLimit = require("express-rate-limit");

// Rate limiting for external auth validation
const externalAuthLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,  // 100 validations per minute per IP
  message: { error: "Too many authentication requests" }
});

// Apply to protected routes
app.use("/api/*", externalAuthLimiter);
```

---

## 10. Testing

### 10.1 Unit Tests

```javascript
describe("validateExternalToken", () => {
  it("should validate valid token", async () => {
    // Mock introspection response
    // Verify user is synced
  });
  
  it("should reject expired token", async () => {
    // Test expiration handling
  });
  
  it("should reject tampered token", async () => {
    // Test signature validation
  });
  
  it("should handle Keystone Core API unavailability", async () => {
    // Test fail-closed behavior
  });
});
```

### 10.2 Integration Tests

```javascript
describe("External Auth Integration", () => {
  it("should complete full auth flow", async () => {
    // 1. Get token from Keystone Core API
    // 2. Send token to AnythingLLM
    // 3. Verify user created
    // 4. Verify user can access protected resources
  });
});
```

---

## 11. Monitoring & Alerting

### 11.1 Key Metrics

Track:
- `external_auth_validation_success_rate` (percentage)
- `external_auth_validation_latency` (ms)
- `keystone_api_availability` (percentage)
- `external_user_sync_errors` (count)
- `external_auth_failures_by_reason` (count by reason)

### 11.2 Alerts

**Critical:**
- Keystone Core API unavailable for > 1 minute
- Token validation failure rate > 5%
- User sync errors > 10 in 5 minutes

**Warning:**
- Token validation cache miss rate > 50%
- Keystone Core API response time > 500ms (p95)

---

## 12. Rollback Plan

### 12.1 Feature Flag Rollback

If issues arise, disable external auth:

```bash
EXTERNAL_AUTH_ENABLED=false
```

This reverts to AnythingLLM's native authentication.

### 12.2 Gradual Rollout

1. **Phase 1:** Internal testing only
2. **Phase 2:** Beta users
3. **Phase 3:** Full rollout

---

## 13. HIPAA Compliance Checklist

- [x] No PHI in JWT tokens (handled by Keystone Core API)
- [ ] No PHI in audit logs
- [ ] HTTPS enforced for all Keystone Core API calls
- [ ] Secrets stored in GCP Secret Manager
- [ ] Comprehensive audit logging implemented
- [ ] Rate limiting on auth endpoints
- [ ] Error messages sanitized (no PHI exposure)

---

## 14. Implementation Checklist

- [ ] Add environment variables
- [ ] Create configuration module
- [ ] Add database migration (externalId, externalProvider)
- [ ] Implement `validateExternalToken` middleware
- [ ] Implement `syncExternalUser` function
- [ ] Update `validatedRequest` to use external auth
- [ ] Add audit logging
- [ ] Add rate limiting
- [ ] Write tests
- [ ] Update documentation
- [ ] Deploy to staging
- [ ] Test end-to-end
- [ ] Deploy to production

---

**Document Status:** Ready for Implementation  

**Last Updated:** 2025-01-27  

**Standards:** RFC 7662, RFC 6750, RFC 7519, HIPAA




