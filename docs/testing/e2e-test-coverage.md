# Keystone Core API - E2E Test Coverage Documentation

This document describes what each E2E test suite proves about the Keystone Core API system. These tests validate the complete integration between Keystone and AnythingLLM, covering authentication, authorization, user provisioning, document processing, and the streaming chat workflow.

## Test Suite Overview

| Test File | Coverage Area | Key Validations |
|-----------|--------------|-----------------|
| `document-upload-with-ocr.e2e-spec.ts` | **Full Workflow** | User creation → workspace provisioning → OCR processing → AnythingLLM integration → streaming chat |
| `workspace-thread-document.e2e-spec.ts` | **Complete Workflow** | Workspace management, thread creation, document upload, streaming chat |
| `user-provisioning.e2e-spec.ts` | **User Lifecycle** | User creation → AnythingLLM sync → workspace assignment → status sync |
| `role-mapping-provisioning.e2e-spec.ts` | **Role Mapping** | Admin/Manager/User role mapping, external identity fields |
| `external-user-lookup.e2e-spec.ts` | **External Identity** | ExternalId lookup, provider verification, 404 handling |
| `keystone-api-role-delegation.e2e-spec.ts` | **Auth Delegation** | Delegated tokens (HS256), role-based authorization |
| `system-endpoints.e2e-spec.ts` | **System Health** | System endpoints, role-based access, correlation IDs |

---

## 1. Document Upload with OCR (document-upload-with-ocr.e2e-spec.ts)

### What It Proves

This is the **most comprehensive test** - it validates the complete end-to-end workflow from user registration to AI-powered document chat.

#### Step 1: User Creation & Auto-Provisioning
- ✅ User registration via `POST /api/v1/auth/email/register`
- ✅ User login and JWT token issuance
- ✅ Automatic AnythingLLM provisioning triggered on user creation
- ✅ Workspace auto-created with deterministic slug: `workspace-for-user-{userId}`

#### Step 2: Workspace Verification
- ✅ User-workspace mapping stored in `anythingllm_user_mappings` table
- ✅ Workspace exists in AnythingLLM (verified via admin API)
- ✅ User is assigned to their workspace

#### Step 3: Document Upload & OCR
- ✅ Document upload via `POST /api/v1/documents/upload`
- ✅ OCR trigger via `POST /api/v1/documents/:id/ocr/trigger`
- ✅ OCR processing completes (Document AI + Vision AI)
- ✅ OCR fields extracted via `GET /api/v1/documents/:id/fields`

#### Step 4: AnythingLLM Integration
- ✅ Document upload to AnythingLLM with OCR fields
- ✅ Document embedding and vector storage
- ✅ New schema for `documentFields` and `visionFields`

#### Step 5: Streaming Chat
- ✅ Thread creation via `POST /api/anythingllm/v1/workspace/:slug/thread/new`
- ✅ Streaming chat via `POST /api/anythingllm/v1/workspace/:slug/thread/:threadSlug/stream-chat`
- ✅ Server-Sent Events (SSE) parsing
- ✅ LLM response with document context

### Authentication Flow Proven
```
User JWT → Keystone → Delegated Token (HS256) → AnythingLLM
```

---

## 2. Workspace, Thread, Document (workspace-thread-document.e2e-spec.ts)

### What It Proves

Validates the complete workflow for workspace management, document handling, and chat functionality.

#### Authentication
- ✅ Admin token verification via `GET /api/anythingllm/v1/system/auth`
- ✅ Service identity authentication
- ✅ Delegated token issuance (HS256)

#### Workspace Management
- ✅ Workspace creation via `POST /api/anythingllm/v1/workspace/new`
- ✅ Workspace slug and ID returned correctly

#### Document Management
- ✅ Document upload via `POST /api/anythingllm/v1/document/upload`
- ✅ Multi-part form data with file attachment
- ✅ Document added to specified workspace

#### Thread Management
- ✅ Thread creation in workspace
- ✅ Thread metadata (id, slug, name, workspace_id)

#### Complete Workflow
- ✅ User creation → workspace → user assignment → thread → document → streaming chat
- ✅ Role-based workspace assignment
- ✅ Document embedding and retrieval

---

## 3. User Provisioning (user-provisioning.e2e-spec.ts)

### What It Proves

Validates the complete user lifecycle from Keystone to AnythingLLM.

#### User Creation & Provisioning
- ✅ User registration triggers async provisioning
- ✅ User created in AnythingLLM with `externalId` and `externalProvider`
- ✅ Mapping stored in `anythingllm_user_mappings` table

#### Workspace Assignment
- ✅ Workspace slug: `patient-{sha256(keystoneUserId)}`
- ✅ Default users automatically assigned to their workspace
- ✅ Admin/manager users skip workspace assignment (access to all)

#### Role-Based Behavior
- ✅ Default users (RoleEnum.user) → workspace assigned
- ✅ Admin users (RoleEnum.admin) → workspace created, assignment skipped
- ✅ Manager users (RoleEnum.manager) → workspace created, assignment skipped

#### Status Sync
- ✅ User suspension sync when status → inactive
- ✅ User unsuspension sync when status → active
- ✅ Soft delete triggers suspension sync

#### Idempotency
- ✅ Duplicate user creation handled gracefully (422 emailAlreadyExists)
- ✅ Rate limiting handled (429 → wait for TTL reset)

#### Failure Handling
- ✅ User creation not blocked if AnythingLLM unavailable
- ✅ Provisioning failures logged but don't rollback user
- ✅ Workspace creation failure prevents orphaned users/mappings

#### Retry Logic
- ✅ Transient failures retried with exponential backoff
- ✅ 1s → 2s → 4s retry intervals

---

## 4. Role Mapping Provisioning (role-mapping-provisioning.e2e-spec.ts)

### What It Proves

Validates that Keystone roles map correctly to AnythingLLM roles.

#### Role Mapping Table
| Keystone Role | RoleEnum | AnythingLLM Role |
|---------------|----------|------------------|
| Admin | 1 | `admin` |
| Manager | 3 | `manager` |
| User | 2 | `default` |

#### Admin Role
- ✅ Admin user created with role 'admin' in AnythingLLM
- ✅ External identity fields verified

#### Manager Role
- ✅ Manager user created with role 'manager' in AnythingLLM
- ✅ External identity fields verified

#### User Role
- ✅ Regular user created with role 'default' in AnythingLLM
- ✅ External identity fields verified

#### Edge Cases
- ✅ Null role defaults to 'default'
- ✅ Unknown role IDs default to 'default'

#### External Identity
- ✅ `externalId` = Keystone user ID
- ✅ `externalProvider` = 'keystone'

#### Authorization
- ✅ Admin token required for user creation
- ✅ Manager cannot create users in AnythingLLM
- ✅ Delegated tokens use HS256 algorithm

---

## 5. External User Lookup (external-user-lookup.e2e-spec.ts)

### What It Proves

Validates the ability to look up AnythingLLM users by Keystone user ID.

#### Endpoint
```
GET /v1/admin/users/external/:externalId?provider=keystone
```

#### Successful Lookup
- ✅ User found by externalId after provisioning
- ✅ Returns user.id, externalId, externalProvider, role

#### Error Handling
- ✅ 404 for non-existent externalId
- ✅ Different provider values handled
- ✅ Empty externalId error handling
- ✅ Service identity token errors handled

#### Integration
- ✅ User found immediately after provisioning completes
- ✅ Polling mechanism for async provisioning

---

## 6. Keystone API Role Delegation (keystone-api-role-delegation.e2e-spec.ts)

### What It Proves

Validates bidirectional role delegation between Keystone and AnythingLLM.

#### Token Structure
```json
{
  "sub": "svc-keystone",
  "act": {
    "sub": "<userId>",
    "roles": ["admin"|"manager"|"user"],
    "sessionId": "<sessionId>"
  },
  "scope": ["anythingllm:..."],
  "aud": "anythingllm",
  "iat": <timestamp>,
  "exp": <timestamp>,
  "nbf": <timestamp>
}
```

#### Delegated Token Issuance
- ✅ Admin user → delegated token with roles=['admin']
- ✅ Manager user → delegated token with roles=['manager']
- ✅ User → delegated token with roles=['user']

#### Token Validation
- ✅ Missing `act` claim rejected
- ✅ Invalid `act.roles` type rejected
- ✅ Token expiration set correctly
- ✅ Token audience matches configuration

#### Authorization Matrix
| Role | Scopes |
|------|--------|
| Admin | `admin:read`, `admin:write`, `system:read` |
| Manager | `admin:read` (no `admin:write`) |
| User | `system:read` only |

#### Algorithm
- ✅ Delegated tokens use HS256 (not RS256)
- ✅ Service identity tokens use RS256

---

## 7. System Endpoints (system-endpoints.e2e-spec.ts)

### What It Proves

Validates system health endpoints with role-based access.

#### Endpoints Tested
| Endpoint | Returns |
|----------|---------|
| `GET /api/anythingllm/v1/system/auth` | `{ authenticated: boolean }` |
| `GET /api/anythingllm/v1/system` | `{ settings: {...} }` |
| `GET /api/anythingllm/v1/system/vector-count` | `{ count: number }` |
| `GET /api/anythingllm/v1/system/workspace-count` | `{ count: number }` |
| `GET /api/anythingllm/v1/system/document-count` | `{ count: number }` |
| `GET /api/anythingllm/v1/system/check-token` | `{ authenticated: boolean }` |

#### Role-Based Access
- ✅ Admin → all endpoints
- ✅ Manager → all endpoints
- ✅ User → depends on `SYSTEM_VISIBILITY_ALLOW_USERS` config
- ✅ Service identity → all endpoints

#### Error Handling
- ✅ Invalid JWT → 401
- ✅ Missing token → 401 or 200 (service identity fallback)

#### Response Normalization
- ✅ Auth endpoints return only `{ authenticated: boolean }`
- ✅ No additional sensitive fields leaked

#### Correlation ID
- ✅ `X-Request-Id` header returned for tracing

---

## Authentication Patterns Proven

### 1. User JWT Authentication
```
Mobile App → User JWT → Keystone → Validates session → Returns data
```

### 2. Delegated Token Flow (HS256)
```
User JWT → Keystone → Issue delegated token → AnythingLLM validates → Returns data
```

### 3. Service Identity Flow (RS256)
```
Keystone (service account) → RS256 signed token → AnythingLLM (internal ops)
```

---

## Rate Limiting Proven

### Auth Endpoints
- Limit: 5 requests per 60 seconds (IP-based)
- TTL: 60,000ms (60 seconds)
- Handling: Wait for full TTL window + 5s buffer before retry

### Global Endpoints
- Limit: 10 requests per 60 seconds (IP-based)
- Handling: Automatic retry with exponential backoff

### 429 Detection
- ✅ Tests handle 429 responses gracefully
- ✅ Retry with proper delay (`RATE_LIMIT_TTL_MS + RATE_LIMIT_BUFFER_MS`)
- ✅ Maximum retry attempts: 3-5 depending on operation

---

## Failure Scenarios Proven

### Workspace Creation Failure
- ✅ Keystone user created (not blocked)
- ✅ No mapping stored (prevents orphaned mappings)
- ✅ No orphaned AnythingLLM user

### Assignment Failure
- ✅ Graceful error handling
- ✅ System doesn't crash

### Network Errors
- ✅ Retry logic with exponential backoff
- ✅ Timeout handling (10s per request)

### AnythingLLM Unavailable
- ✅ User creation succeeds in Keystone
- ✅ Provisioning logged as warning

---

## Database Entities Verified

### Users Table
- `id`, `email`, `provider`, `socialId`
- `firstName`, `lastName`, `role`, `status`
- Soft delete fields

### anythingllm_user_mappings Table
- `keystoneUserId` → `anythingllmUserId`
- `workspaceSlug`, `workspaceId`

### Sessions Table
- Session hash for refresh token validation
- Logout/password change invalidation

---

## Security Constraints Proven

### HIPAA Alignment
- ✅ No PHI in JWT (only id, role, sessionId)
- ✅ No PHI in logs (only userId, provider, event type)
- ✅ No health-related OAuth scopes

### Token Security
- ✅ Short-lived access tokens (~15m)
- ✅ Long-lived refresh tokens (tied to session)
- ✅ HS256 for delegated tokens (shared secret)
- ✅ RS256 for service identity (asymmetric)

---

## Running the Tests

### Full Suite
```bash
npm run test:e2e
```

### Individual Tests
```bash
npm run test:e2e -- document-upload-with-ocr.e2e-spec.ts
npm run test:e2e -- workspace-thread-document.e2e-spec.ts
npm run test:e2e -- user-provisioning.e2e-spec.ts
npm run test:e2e -- role-mapping-provisioning.e2e-spec.ts
npm run test:e2e -- external-user-lookup.e2e-spec.ts
npm run test:e2e -- keystone-api-role-delegation.e2e-spec.ts
npm run test:e2e -- system-endpoints.e2e-spec.ts
```

### Skip AnythingLLM Tests
```bash
SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e
```

### Skip OCR Tests
```bash
SKIP_OCR_TESTS=true npm run test:e2e
```

---

## Environment Requirements

```env
# Keystone API
APP_PORT=3000
APP_URL=http://localhost:3000

# AnythingLLM
ANYTHINGLLM_BASE_URL=http://localhost:3001/api
ENABLE_DELEGATED_TOKENS=true
ANYTHINGLLM_DELEGATED_TOKEN_SECRET=<shared-secret>
ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE=anythingllm

# Auth
AUTH_JWT_SECRET=<secret>
AUTH_JWT_TOKEN_EXPIRES_IN=15m
AUTH_REFRESH_SECRET=<secret>
AUTH_REFRESH_TOKEN_EXPIRES_IN=365d

# Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secret

# GCP (for OCR)
GCP_PROJECT_ID=<project>
DOCUMENT_AI_PROCESSOR_ID=<processor>
```

---

## Test Completion Metrics

| Area | Coverage |
|------|----------|
| User Authentication | ✅ Complete |
| User Provisioning | ✅ Complete |
| Role Mapping | ✅ Complete |
| Workspace Management | ✅ Complete |
| Document Upload | ✅ Complete |
| OCR Processing | ✅ Complete |
| Thread Management | ✅ Complete |
| Streaming Chat | ✅ Complete |
| System Endpoints | ✅ Complete |
| Rate Limiting | ✅ Complete |
| Error Handling | ✅ Complete |
| Auth Delegation | ✅ Complete |

---

## Next Steps for Full Production Readiness

1. **Stress Testing** - Concurrent user load testing
2. **Performance Benchmarks** - Response time thresholds
3. **Chaos Engineering** - Network partition simulation
4. **Security Scanning** - OWASP ZAP integration
5. **Audit Trail Testing** - Verify all auth events logged
6. **MFA Testing** - When MFA is implemented
