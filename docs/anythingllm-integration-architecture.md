# AnythingLLM Integration Architecture

**Project:** Keystone Core API + AnythingLLM Integration  
**Date:** 2025-01-27  
**Status:** Active Implementation

---

## Executive Summary

Keystone Core API integrates with AnythingLLM as a **service-to-service proxy** that provides:
1. **Service Identity Authentication** - GCP OIDC tokens for secure service-to-service communication
2. **Delegated Token Authentication** - User-scoped tokens with embedded actor claims (RFC 8693)
3. **Policy-Based Authorization** - Centralized access control before forwarding requests
4. **Admin Proxy Endpoints** - Typed, HIPAA-compliant proxy for AnythingLLM admin operations

**Key Principle:** Keystone Core API acts as a **secure gateway** between end-users and AnythingLLM, handling authentication, authorization, and audit logging while maintaining HIPAA compliance.

---

## Architecture Overview

### High-Level Flow

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Client    │────────▶│ Keystone Core API │────────▶│ AnythingLLM  │
│  (Mobile)   │  JWT    │   (Gateway)       │  Token  │   (Service)  │
└─────────────┘         └──────────────────┘         └──────────────┘
                              │
                              │
                    ┌─────────┴─────────┐
                    │                   │
              ┌─────▼─────┐      ┌──────▼──────┐
              │  Policy  │      │  Token     │
              │  Check   │      │  Issuance  │
              └──────────┘      └────────────┘
```

### Integration Patterns

Keystone Core API supports **two authentication patterns** for AnythingLLM:

1. **Service Identity** (Admin/System Operations)
   - Uses GCP service account OIDC tokens
   - For system-level operations (admin endpoints, provisioning)
   - No user context required

2. **Delegated Tokens** (User-Scoped Operations)
   - Uses RFC 8693 actor claims (`act` claim)
   - Embeds user context in token
   - For user-scoped operations (workspaces, threads, documents)

---

## Core Components

### 1. Service Identity Authentication

**Purpose:** Authenticate Keystone Core API to AnythingLLM using GCP service account identity.

**Implementation:**
- **Service:** `AnythingLLMServiceIdentityService`
- **Location:** `src/anythingllm/services/anythingllm-service-identity.service.ts`
- **Method:** Mints OIDC ID tokens via `google-auth-library`

**Flow:**
```
1. Service checks for cached token (55-minute TTL)
2. If expired/missing, mints new OIDC ID token
3. Token audience: configured AnythingLLM audience
4. Token cached in memory for performance
5. Token injected into Authorization header
```

**Token Structure:**
```json
{
  "iss": "https://accounts.google.com",
  "aud": "anythingllm-internal",
  "email": "keystone@project.iam.gserviceaccount.com",
  "exp": 1738000900,
  "iat": 1738000000
}
```

**Configuration:**
- `ANYTHINGLLM_BASE_URL` - AnythingLLM instance URL
- `ANYTHINGLLM_SERVICE_AUDIENCE` - Token audience
- `GOOGLE_APPLICATION_CREDENTIALS` - Service account key (or ADC)

---

### 2. Delegated Token Authentication

**Purpose:** Issue user-scoped tokens with embedded actor claims for user operations.

**Implementation:**
- **Service:** `AnythingLLMAuthDelegationService`
- **Location:** `src/anythingllm-auth-delegation/service.ts`
- **Standard:** RFC 8693 (OAuth 2.0 Token Exchange)

**Flow:**
```
1. User authenticates with Keystone Core API (Google/Apple/Facebook/Email)
2. User requests AnythingLLM operation
3. Policy service authorizes operation
4. Delegation service issues delegated token with actor claim
5. Token forwarded to AnythingLLM with user context
```

**Token Structure (RFC 8693):**
```json
{
  "sub": "svc-keystone",           // Service identity
  "act": {                         // Actor claim (RFC 8693)
    "sub": "user-123",             // Original user ID
    "roles": ["user"],
    "sessionId": "session-456",
    "provider": "google"
  },
  "scope": "anythingllm:read anythingllm:write",
  "aud": "anythingllm",
  "iss": "https://keystone.example.com",
  "iat": 1738000000,
  "exp": 1738000300,
  "nbf": 1737999940
}
```

**Configuration:**
- `ENABLE_DELEGATED_TOKENS` - Feature flag
- `DELEGATED_TOKEN_EXPIRES_IN` - Token lifetime (default: 5 minutes)
- `DELEGATED_TOKEN_AUDIENCE` - Token audience

---

### 3. Policy-Based Authorization

**Purpose:** Centralized access control before forwarding requests to AnythingLLM.

**Implementation:**
- **Service:** `AnythingLLMPolicyService`
- **Location:** `src/anythingllm-policy/service.ts`
- **Pattern:** Policy engine with operation-based rules

**Flow:**
```
1. Request received with user context
2. Policy service evaluates operation + resource context
3. Returns authorization decision (allowed/denied)
4. If allowed, returns scope for token issuance
5. If denied, returns 403 Forbidden
```

**Operations:**
- `DOCUMENT_UPLOAD`
- `DOCUMENT_DELETE`
- `WORKSPACE_CREATE`
- `WORKSPACE_READ`
- `WORKSPACE_UPDATE`
- `THREAD_CREATE`
- `THREAD_READ`
- `CHAT_SEND`
- `ADMIN_*` (admin operations)

---

### 4. Orchestrator Service

**Purpose:** Single entry point that composes policy check → token issuance → client call.

**Implementation:**
- **Service:** `AnythingLLMOrchestratorService`
- **Location:** `src/anythingllm-orchestrator/service.ts`

**Flow:**
```
1. Authorize operation (policy check)
2. Issue delegated token (if authorized)
3. Call AnythingLLM with delegated token
4. Return response to client
```

**Usage:**
```typescript
const response = await orchestrator.executeOperation({
  operation: AnythingLLMOperation.DOCUMENT_UPLOAD,
  requesterContext: {
    userId: 'user-123',
    roles: ['user'],
    sessionId: 'session-456'
  },
  resourceContext: {
    workspaceSlug: 'my-workspace'
  }
});
```

---

### 5. Client Service

**Purpose:** HTTP client that handles token injection and request forwarding.

**Implementation:**
- **Service:** `AnythingLLMClientService`
- **Location:** `src/anythingllm/services/anythingllm-client.service.ts`

**Features:**
- Automatic token injection (service identity or delegated)
- Request ID generation for tracing
- HIPAA-compliant logging (no tokens, no PHI)
- Error normalization

**Usage:**
```typescript
// With service identity
const response = await clientService.callAnythingLLM('/v1/admin/users');

// With delegated token
const response = await clientService.callAnythingLLM(
  '/v1/workspace/my-workspace/thread/my-thread/chat',
  { method: 'POST', body: JSON.stringify({ message: 'Hello' }) },
  delegatedToken
);
```

---

## Admin Implementation

### Overview

The Admin implementation provides **typed, HIPAA-compliant proxy endpoints** for AnythingLLM admin operations. All admin endpoints require **service identity authentication** (not user JWT tokens).

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Request Flow                        │
└─────────────────────────────────────────────────────────────┘

Client Request
    │
    ▼
┌─────────────────────────────────────┐
│  AnythingLLMAdminController         │
│  - Validates service identity        │
│  - Routes to admin service           │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  AnythingLLMAdminService            │
│  - Typed service methods            │
│  - Uses registry client             │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  AnythingLLMRegistryClient          │
│  - Endpoint registry lookup         │
│  - Path parameter substitution      │
│  - Request forwarding               │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  AnythingLLMClientService           │
│  - Service identity token injection│
│  - HTTP request to AnythingLLM      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  AnythingLLM Service                │
│  - Validates service identity token  │
│  - Executes admin operation          │
└─────────────────────────────────────┘
```

### Components

#### 1. Admin Controller

**File:** `src/anythingllm/admin/anythingllm-admin.controller.ts`

**Purpose:** NestJS controller that exposes admin endpoints with Swagger documentation.

**Features:**
- Service identity guard (rejects user JWT tokens)
- Typed request/response DTOs
- Error normalization
- HIPAA-compliant logging

**Endpoints:**
```typescript
GET    /api/anythingllm/v1/admin/is-multi-user-mode
GET    /api/anythingllm/v1/admin/users
POST   /api/anythingllm/v1/admin/users/new
POST   /api/anythingllm/v1/admin/users/:id
DELETE /api/anythingllm/v1/admin/users/:id
GET    /api/anythingllm/v1/admin/invites
POST   /api/anythingllm/v1/admin/invite/new
DELETE /api/anythingllm/v1/admin/invite/:id
GET    /api/anythingllm/v1/admin/workspaces/:workspaceId/users
POST   /api/anythingllm/v1/admin/workspaces/:workspaceSlug/manage-users
POST   /api/anythingllm/v1/admin/workspace-chats
POST   /api/anythingllm/v1/admin/preferences
```

**Example:**
```typescript
@Get('users')
@UseGuards(ServiceIdentityGuard)
async listUsers(): Promise<ListUsersResponseSchema> {
  const result = await this.adminService.listUsers();
  return result.data;
}
```

#### 2. Admin Service

**File:** `src/anythingllm/admin/anythingllm-admin.service.ts`

**Purpose:** Typed service methods for all admin operations.

**Features:**
- Type-safe method signatures
- Uses registry client for consistent request handling
- Returns normalized response types

**Example:**
```typescript
async listUsers(): Promise<RegistryCallResult<ListUsersResponseSchema>> {
  return this.registryClient.call<ListUsersResponseSchema>(
    AnythingLLMAdminEndpointIds.LIST_USERS,
  );
}
```

#### 3. Endpoint Registry

**File:** `src/anythingllm/registry/anythingllm-endpoints.registry.ts`

**Purpose:** Single source of truth for all AnythingLLM endpoint definitions.

**Features:**
- Endpoint ID constants
- Path templates with parameter placeholders
- Authentication policy (`serviceIdentity` | `userJwt` | `none`)
- Request/response schemas
- Retry policies
- Timeout configuration

**Example:**
```typescript
export const AnythingLLMAdminEndpoints = {
  LIST_USERS: {
    id: 'admin.listUsers',
    method: 'GET',
    path: '/v1/admin/users',
    auth: 'serviceIdentity',
    requestSchema: null,
    responseSchema: ListUsersResponseSchema,
    tags: ['admin', 'users'],
  },
  UPDATE_USER: {
    id: 'admin.updateUser',
    method: 'POST',
    path: '/v1/admin/users/:id',
    auth: 'serviceIdentity',
    requestSchema: UpdateUserRequestSchema,
    responseSchema: UserOperationResponseSchema,
    tags: ['admin', 'users'],
  },
} as const;
```

#### 4. Registry Client

**File:** `src/anythingllm/registry/anythingllm-registry-client.ts`

**Purpose:** Generic typed caller that handles endpoint lookup, path parameter substitution, and request forwarding.

**Features:**
- Endpoint registry lookup by ID
- Path parameter substitution (`:id` → actual value)
- Request body serialization
- Response deserialization
- Error normalization (UpstreamError)
- Retry logic (configurable per endpoint)
- Timeout handling

**Example:**
```typescript
const result = await registryClient.call<ListUsersResponseSchema>(
  AnythingLLMAdminEndpointIds.LIST_USERS
);

const result = await registryClient.call<UserOperationResponseSchema, UpdateUserRequestSchema>(
  AnythingLLMAdminEndpointIds.UPDATE_USER,
  {
    params: { id: 123 },
    body: { username: 'new-username' }
  }
);
```

#### 5. Service Identity Guard

**File:** `src/anythingllm/guards/service-identity.guard.ts`

**Purpose:** Validates GCP service identity tokens and explicitly rejects user JWT tokens.

**Features:**
- Validates OIDC ID token signature
- Checks token audience
- Verifies token expiration
- Rejects user JWT tokens (explicit security boundary)
- HIPAA-compliant logging

**Flow:**
```
1. Extract Authorization header
2. Validate token format (Bearer token)
3. Decode and verify OIDC ID token
4. Check audience matches service audience
5. Check expiration
6. Reject if user JWT token detected
7. Allow if service identity token valid
```

#### 6. Schema Definitions

**Location:** `src/anythingllm/registry/schemas/`

**Purpose:** TypeScript DTOs with class-validator decorators for request/response validation.

**Files:**
- `admin-user.schema.ts` - User CRUD DTOs
- `admin-invite.schema.ts` - Invite DTOs
- `admin-workspace.schema.ts` - Workspace user management DTOs
- `admin-preferences.schema.ts` - Preferences DTO

**Example:**
```typescript
export class CreateUserRequestSchema {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  role?: string;
}
```

#### 7. Admin Oversight Service

**File:** `src/anythingllm/admin/anythingllm-admin-oversight.service.ts`

**Purpose:** Provides admin/system-level observability of user conversations.

**Features:**
- Thread history access
- Workspace-level chat queries
- Manager note injection
- Chat export for compliance/audit

**Example:**
```typescript
// Inject manager note into thread
await oversightService.injectManagerNote(
  'workspace-slug',
  'thread-slug',
  managerUserId,
  'This conversation requires review',
  'MANAGER NOTE'
);
```

---

## Security & HIPAA Compliance

### Authentication Security

1. **Service Identity Tokens**
   - OIDC ID tokens minted via GCP service account
   - Tokens cached for 55 minutes (tokens expire in 1 hour)
   - Automatic token refresh on expiration
   - Fail-closed on token minting failure

2. **Delegated Tokens**
   - Short-lived (default: 5 minutes)
   - Embedded actor claims (RFC 8693)
   - Policy-based scope assignment
   - Automatic expiration

3. **Service Identity Guard**
   - Explicitly rejects user JWT tokens
   - Validates OIDC token signature
   - Checks audience and expiration
   - HIPAA-compliant logging (no tokens, no PHI)

### HIPAA Compliance

1. **No PHI in Tokens**
   - Service identity tokens: service account email only
   - Delegated tokens: user ID, roles, session ID (no email, no name)
   - No health-related data in tokens

2. **No PHI in Logs**
   - Logs only: userId, operation, status, timestamp
   - Never logs: raw tokens, emails, names, health data
   - Structured JSON logging for audit trail

3. **Audit Logging**
   - All admin operations logged
   - Token minting events logged (DEBUG level)
   - Authorization decisions logged
   - Error events logged with sanitized messages

4. **Error Handling**
   - Normalized error responses (UpstreamError)
   - No internal error details exposed
   - No PHI in error messages
   - HIPAA-safe error logging

---

## Module Structure

```
src/anythingllm/
├── admin/                              # Admin proxy implementation
│   ├── anythingllm-admin.controller.ts
│   ├── anythingllm-admin.service.ts
│   ├── anythingllm-admin.module.ts
│   └── anythingllm-admin-oversight.service.ts
├── registry/                           # Endpoint registry
│   ├── anythingllm-endpoints.registry.ts
│   ├── anythingllm-registry-client.ts
│   ├── upstream-error.ts
│   └── schemas/                       # Request/response DTOs
│       ├── admin-user.schema.ts
│       ├── admin-invite.schema.ts
│       ├── admin-workspace.schema.ts
│       └── admin-preferences.schema.ts
├── services/                          # Core services
│   ├── anythingllm-client.service.ts
│   └── anythingllm-service-identity.service.ts
├── guards/                            # Authentication guards
│   └── service-identity.guard.ts
└── anythingllm.module.ts

src/anythingllm-orchestrator/          # Orchestrator (user operations)
├── service.ts
└── dto/

src/anythingllm-policy/                # Policy engine
├── service.ts
└── domain/

src/anythingllm-auth-delegation/       # Delegated token issuance
├── service.ts
└── domain/
```

---

## Configuration

### Environment Variables

```bash
# AnythingLLM Base Configuration
ANYTHINGLLM_BASE_URL=https://anythingllm.example.com
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal

# Service Identity (GCP)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
# OR use Application Default Credentials (ADC)

# Delegated Tokens (Optional)
ENABLE_DELEGATED_TOKENS=true
DELEGATED_TOKEN_EXPIRES_IN=300  # 5 minutes
DELEGATED_TOKEN_AUDIENCE=anythingllm
```

### Module Registration

```typescript
// app.module.ts
@Module({
  imports: [
    AnythingLLMModule,
    AnythingLLMAdminModule,  // Admin proxy endpoints
    // ... other modules
  ],
})
export class AppModule {}
```

---

## Testing

### Unit Tests

- `anythingllm-registry-client.spec.ts` - Registry client tests
- `anythingllm-admin.service.spec.ts` - Admin service tests
- `upstream-error.spec.ts` - Error handling tests

### E2E Tests

- `admin-proxy.e2e-spec.ts` - Full admin endpoint integration tests

**Running Tests:**
```bash
# Unit tests
npm test -- anythingllm-admin.service.spec.ts

# E2E tests (requires service token)
TEST_SERVICE_TOKEN=<token> npm run test:e2e -- admin-proxy
```

---

## API Documentation

### Admin Endpoints

All admin endpoints are documented in Swagger UI at `/api/docs` under the "AnythingLLM Admin" tag.

**Base Path:** `/api/anythingllm/v1/admin`

**Authentication:** Service Identity (GCP OIDC ID token)

**Endpoints:**
- `GET /is-multi-user-mode` - Check multi-user mode status
- `GET /users` - List all users
- `POST /users/new` - Create new user
- `POST /users/:id` - Update user
- `DELETE /users/:id` - Delete user
- `GET /invites` - List invitations
- `POST /invite/new` - Create invitation
- `DELETE /invite/:id` - Revoke invitation
- `GET /workspaces/:workspaceId/users` - Get workspace users
- `POST /workspaces/:workspaceSlug/manage-users` - Manage workspace users
- `POST /workspace-chats` - Get workspace chats (paginated)
- `POST /preferences` - Update system preferences

---

## Future Enhancements

1. **Rate Limiting**
   - Per-endpoint rate limits
   - Per-service rate limits
   - TODO: Add throttler configuration

2. **Caching**
   - Response caching for read operations
   - Token validation caching
   - TODO: Add Redis cache layer

3. **Monitoring**
   - Request metrics (latency, error rate)
   - Token minting metrics
   - Authorization decision metrics
   - TODO: Add Prometheus metrics

4. **Circuit Breaker**
   - Fail-fast on AnythingLLM unavailability
   - Automatic recovery
   - TODO: Add circuit breaker pattern

---

## References

- [AnythingLLM Developer API Documentation](./anythingllm-developer-api-documentation.md)
- [AnythingLLM Integration Plan](./anythingllm-integration-plan.md)
- [AnythingLLM Admin Proxy Implementation](./anythingllm-admin-proxy-implementation.md)
- [AnythingLLM Service Identity Implementation](./anythingllm-service-identity-implementation.md)
- [RFC 8693 - OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [RFC 7662 - OAuth 2.0 Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)

---

**Last Updated:** 2025-01-27  
**Status:** Active Implementation






