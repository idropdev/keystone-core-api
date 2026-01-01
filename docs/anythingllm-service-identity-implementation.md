# AnythingLLM Service Identity Implementation

**Status:** ✅ Implemented and Tested  
**Last Updated:** 2025-12-29  
**Service Account:** `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`

## Overview

This document describes how the service identity authentication system works in Keystone Core API for authenticating requests to AnythingLLM's internal/admin routes using GCP service account OIDC ID tokens.

The implementation provides secure service-to-service (S2S) authentication between Keystone and AnythingLLM, ensuring that only authorized services can access admin endpoints.

## Architecture

The service identity system consists of four main components:

1. **Service Identity Service** - Mints OIDC ID tokens using GCP service account credentials
2. **HTTP Client Service** - Makes authenticated requests to AnythingLLM APIs with automatic token injection
3. **Service Identity Guard** - Validates incoming service identity tokens (for AnythingLLM admin proxy endpoints)
4. **Health Check Service** - Provides health check endpoint to verify connectivity and authentication

### Module Structure

```
src/anythingllm/
├── config/
│   ├── anythingllm-config.type.ts
│   └── anythingllm.config.ts
├── services/
│   ├── anythingllm-service-identity.service.ts  # Token minting
│   ├── anythingllm-client.service.ts            # HTTP client
│   └── anythingllm-health.service.ts            # Health checks
├── guards/
│   └── service-identity.guard.ts                 # Token validation
├── admin/
│   ├── anythingllm-admin.controller.ts          # Admin proxy endpoints
│   ├── anythingllm-admin.service.ts
│   └── anythingllm-admin.module.ts
├── registry/
│   ├── anythingllm-endpoints.registry.ts        # Endpoint definitions
│   ├── anythingllm-registry-client.ts
│   └── schemas/                                  # Request/response schemas
└── anythingllm.module.ts
```

## How It Works

### 1. Token Minting Flow

The `AnythingLLMServiceIdentityService` is responsible for minting OIDC ID tokens:

```typescript
// Get a token (automatically cached for 55 minutes)
const token = await serviceIdentityService.getIdToken();
```

**Process:**

1. **Check Cache**: First checks if a valid cached token exists (tokens are cached for 55 minutes, tokens expire in 1 hour)
2. **Detect Credentials**: Automatically detects the credential source:
   - Application Default Credentials (ADC) with impersonation
   - Service account key file (via `GOOGLE_APPLICATION_CREDENTIALS`)
   - ADC without impersonation (uses attached service account)
3. **Mint Token**: Uses `google-auth-library` to mint an OIDC ID token with the configured audience
4. **Cache Token**: Stores the token in memory with expiration timestamp
5. **Return Token**: Returns the JWT token string

**Credential Detection:**

The service automatically detects the credential type by checking:

- `GOOGLE_APPLICATION_CREDENTIALS` environment variable (if set, checks the file)
- Default ADC location: `~/.config/gcloud/application_default_credentials.json`
- File type detection:
  - `type: "service_account"` → Service account key file
  - `type: "authorized_user"` or `type: "impersonated_service_account"` → ADC file
  - `service_account_impersonation_url` present → ADC with impersonation configured

**Token Structure:**

The minted tokens are JWT tokens with the following claims:
- `iss`: Google issuer (`https://accounts.google.com` or service account)
- `aud`: The configured audience (e.g., `anythingllm-internal`)
- `email`: Service account email (e.g., `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`)
- `exp`: Expiration timestamp (1 hour from issuance)
- `iat`: Issued at timestamp

### 2. HTTP Client Service

The `AnythingLLMClientService` automatically injects service identity tokens into all requests:

```typescript
// Make an authenticated request
const response = await anythingllmClient.callAnythingLLM(
  '/v1/admin/is-multi-user-mode',
  { method: 'GET' }
);

const data = await response.json();
```

**Process:**

1. **Get Token**: Calls `serviceIdentityService.getIdToken()` (uses cache if available)
2. **Build URL**: Constructs full URL from base URL and endpoint
3. **Generate Request ID**: Creates a UUID for request tracking
4. **Build Headers**: Adds required headers:
   - `Authorization: Bearer <token>`
   - `X-Request-Id: <uuid>`
   - `X-Client-Service: keystone`
   - `Content-Type: application/json`
5. **Make Request**: Sends HTTP request with fetch API
6. **Log Response**: Logs response status and duration (HIPAA-compliant, no tokens)

**Features:**

- Automatic token injection
- Request ID tracking
- Comprehensive logging (without exposing tokens)
- Error handling (fail-closed)
- Support for relative and absolute URLs

### 3. Service Identity Guard

The `ServiceIdentityGuard` validates incoming service identity tokens for admin proxy endpoints:

```typescript
@UseGuards(ServiceIdentityGuard)
@Controller('api/anythingllm/admin')
export class AnythingLLMAdminController {
  // All endpoints require service identity authentication
}
```

**Validation Process:**

1. **Extract Token**: Gets Bearer token from `Authorization` header
2. **Identify Token Type**: Decodes token to determine if it's:
   - Service identity token (GCP-issued)
   - User JWT token (application-issued)
   - Unknown/invalid
3. **Reject User JWTs**: Explicitly rejects end-user JWT tokens
4. **Validate Service Token**: Checks:
   - Token expiration
   - Audience claim matches configuration
   - Token structure is valid
5. **Attach to Request**: Adds `serviceIdentity` object to request for downstream use

**Token Type Detection:**

The guard identifies token types by examining JWT claims:

- **Service Identity Tokens**:
  - `iss` contains `googleapis.com` or is `https://accounts.google.com`
  - `email` or `azp` ends with `.iam.gserviceaccount.com`
  - `aud` matches configured audience

- **User JWT Tokens**:
  - `iss` matches application name
  - Contains `sub` and `role` claims
  - Not from GCP

### 4. E2E Testing

The E2E tests (`test/anythingllm/service-identity.e2e-spec.ts`) make **real HTTP requests** to AnythingLLM endpoints:

**Test Coverage:**

- ✅ Service Identity Token Minting
- ✅ System Status Endpoints (`/v1/admin/is-multi-user-mode`)
- ✅ User Management (`/v1/admin/users`, `/v1/admin/users/new`)
- ✅ Invitation Management (`/v1/admin/invites`, `/v1/admin/invite/new`)
- ✅ Request Headers and Authentication
- ✅ Error Handling
- ✅ URL Construction

**Running Tests:**

```bash
# With AnythingLLM running
ANYTHINGLLM_BASE_URL=http://localhost:3001/api npm run test:e2e -- service-identity.e2e-spec.ts

# Skip if AnythingLLM not available
SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- service-identity.e2e-spec.ts
```

**Note:** The `test:e2e` script includes `NODE_OPTIONS="--experimental-vm-modules"` by default to support `google-auth-library`'s dynamic imports in Jest.

## Configuration

### Environment Variables

```env
# Service identity configuration
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp  # Options: gcp, local_jwt (local_jwt not yet implemented)
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal  # Must match AnythingLLM config
ANYTHINGLLM_BASE_URL=http://localhost:3001/api  # Base URL for AnythingLLM API
```

**Important:** `ANYTHINGLLM_SERVICE_AUDIENCE` must exactly match `ANYTHINGLLM_SERVICE_AUDIENCE` in AnythingLLM configuration.

### GCP Credentials Configuration

The system supports three credential sources (in order of precedence):

1. **Service Account Key File** (via `GOOGLE_APPLICATION_CREDENTIALS`)
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
   ```

2. **ADC with Impersonation** (recommended for local development)
   ```bash
   gcloud auth application-default login \
     --impersonate-service-account=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com
   ```

3. **ADC without Impersonation** (uses attached service account on GCE/Cloud Run)

The service automatically detects which credential source is being used and logs it for debugging.

## Available Admin Endpoints

The following AnythingLLM admin endpoints are available through the service identity system:

### System Status
- `GET /v1/admin/is-multi-user-mode` - Check if multi-user mode is enabled

### User Management
- `GET /v1/admin/users` - List all users
- `POST /v1/admin/users/new` - Create a new user
- `POST /v1/admin/users/:id` - Update a user
- `DELETE /v1/admin/users/:id` - Delete a user

### Invitation Management
- `GET /v1/admin/invites` - List all invitations
- `POST /v1/admin/invite/new` - Create a new invitation
- `DELETE /v1/admin/invite/:id` - Revoke an invitation

### Workspace Management
- `GET /v1/admin/workspaces/:workspaceId/users` - Get workspace users
- `POST /v1/admin/workspaces/:workspaceSlug/manage-users` - Manage workspace users
- `POST /v1/admin/workspace-chats` - Get workspace chats

### System Preferences
- `POST /v1/admin/preferences` - Update system preferences

All endpoints require service identity authentication and are accessible through:
- Direct HTTP client calls: `anythingllmClient.callAnythingLLM(endpoint, options)`
- Admin proxy endpoints: `/api/anythingllm/admin/*` (protected by `ServiceIdentityGuard`)

## Usage Examples

### Basic API Call

```typescript
import { AnythingLLMClientService } from './anythingllm/services/anythingllm-client.service';

constructor(
  private readonly anythingllmClient: AnythingLLMClientService,
) {}

async checkMultiUserMode(): Promise<boolean> {
  const response = await this.anythingllmClient.callAnythingLLM(
    '/v1/admin/is-multi-user-mode',
    { method: 'GET' },
  );

  if (!response.ok) {
    throw new Error(`AnythingLLM API error: ${response.status}`);
  }

  const data = await response.json();
  return data.isMultiUser === true;
}
```

### Create User

```typescript
async createUser(username: string, password: string, role: string) {
  const response = await this.anythingllmClient.callAnythingLLM(
    '/v1/admin/users/new',
    {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        role,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create user: ${response.status} - ${errorText}`);
  }

  return await response.json();
}
```

### Create Invitation

```typescript
async createInvite(workspaceIds: number[]) {
  const response = await this.anythingllmClient.callAnythingLLM(
    '/v1/admin/invite/new',
    {
      method: 'POST',
      body: JSON.stringify({
        workspaceIds,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to create invite: ${response.status}`);
  }

  const data = await response.json();
  return data.invite; // { id, code, status, ... }
}
```

## Health Check Endpoint

**Endpoint:** `GET /api/health/anythingllm`

**Response:**
```json
{
  "status": "healthy",
  "endpoint": "/v1/admin/is-multi-user-mode",
  "reachable": true,
  "authenticated": true,
  "responseTime": 184,
  "timestamp": "2025-12-28T05:52:36.000Z"
}
```

**Status Values:**
- `healthy` - Token minting, connectivity, and authentication all successful
- `unhealthy` - Authentication failed or token minting failed
- `degraded` - Connectivity issues (AnythingLLM unreachable)

## Logging

The implementation includes comprehensive, HIPAA-compliant logging:

### Service Identity Service Logs

- Configuration values (auth mode, audience)
- GCP credentials type (ADC, key file, impersonation)
- Token minting progress and duration
- Token metadata (service account email, audience, expiration)
- Error details with helpful guidance

### HTTP Client Service Logs

- Request details (method, URL, request ID)
- Token metadata (service account email, audience, token length)
- Response details (status, duration)
- Error details with full error messages

### Log Levels

Logs use `warn` level to ensure visibility with default logger configuration. All logs are HIPAA-compliant (no tokens or PHI).

**Example Log Output:**
```
[Service Identity] Configuration - AuthMode: gcp | Audience: anythingllm-internal
[Service Identity] Using Application Default Credentials (ADC) with impersonation: https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com:generateAccessToken
[Service Identity] Successfully minted GCP ID token | Audience: anythingllm-internal | Service Account: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com | Token Audience: anythingllm-internal | Expires: 2025-12-28T06:52:36.000Z | Duration: 165ms | Token Length: 881 bytes
[AnythingLLM Request] GET http://localhost:3001/api/v1/admin/is-multi-user-mode | RequestId: d23ec9d8-da6e-4d4b-a2a4-099f2deb1e0d | Token Service Account: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com | Token Audience: anythingllm-internal | Token Length: 881 bytes
[AnythingLLM Response] GET http://localhost:3001/api/v1/admin/is-multi-user-mode | Status: 200 | Duration: 181ms | RequestId: d23ec9d8-da6e-4d4b-a2a4-099f2deb1e0d
```

## Security Considerations

1. **Token Caching**: Tokens cached for 55 minutes (tokens expire in 1 hour) to reduce API calls while ensuring freshness
2. **No Token Logging**: Never logs tokens in error messages or debug output
3. **Fail Closed**: If token minting fails, throws error (does not make unauthenticated requests)
4. **Audience Matching**: Must exactly match `anythingllm-internal` in AnythingLLM
5. **Service Account**: Relies on ADC/impersonation for local dev, attached service account for GCP
6. **User JWT Rejection**: Admin endpoints explicitly reject end-user JWT tokens
7. **Request ID Tracking**: All requests include unique request IDs for tracing

## GCP Setup and IAM Permissions

### Service Account

**Service Account Email:** `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`

### IAM Permissions

The `roles/iam.serviceAccountTokenCreator` permission is required for local impersonation and may be required in some org-restricted GCP environments. On GCE/Cloud Run, minting an ID token via metadata/ADC typically works without explicitly granting TokenCreator to itself.

**When TokenCreator is required:**
- Local development with service account impersonation
- Minting tokens for a different service account
- Some org-policy-restricted environments

### Local Development (Impersonation)

```bash
PROJECT_ID="anythingllm-dropdev-hybrid-v1"
SERVICE_ACCOUNT="keystone-doc-processing@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant your user account permission to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  ${SERVICE_ACCOUNT} \
  --member="user:YOUR_EMAIL@example.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=${PROJECT_ID}

# Set up ADC with impersonation
gcloud auth application-default login --impersonate-service-account=${SERVICE_ACCOUNT}
```

### GCE/Cloud Run

Attach the service account to the instance/service. TokenCreator may not be required unless org policies restrict it.

## Troubleshooting

### Common Issues

1. **"Failed to mint GCP ID token"**
   - Verify ADC is configured: `gcloud auth application-default print-access-token`
   - Verify `roles/iam.serviceAccountTokenCreator` permission is granted (for impersonation)
   - Verify service account is attached to the VM/Cloud Run instance
   - Check that `ANYTHINGLLM_SERVICE_AUDIENCE` is set correctly
   - Check logs for credential type detection messages

2. **"Invalid service identity token" (401 from AnythingLLM)**
   - Verify `ANYTHINGLLM_SERVICE_AUDIENCE` matches in both services
   - Verify service account email is `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`
   - Check token expiration (tokens expire in 1 hour)
   - See debugging guide: `docs/anythingllm-service-identity-debugging.md`

3. **"Cannot use import statement outside a module" (Jest tests)**
   - This is expected - the `test:e2e` script includes `NODE_OPTIONS="--experimental-vm-modules"` by default
   - This is required for Jest to handle `google-auth-library`'s dynamic imports

4. **Local Development Issues**
   - Use `gcloud auth application-default login --impersonate-service-account=...` for local testing
   - Verify ADC file has `service_account_impersonation_url` field
   - Check logs to see which credential type is being detected

### Debugging Guide

For detailed debugging instructions when AnythingLLM rejects tokens, see:
- `docs/anythingllm-service-identity-debugging.md` - Comprehensive debugging guide
- `docs/anythingllm-debug-prompt.md` - Quick debugging prompt for code analysis

## Related Documentation

- [Service Identity Setup for AnythingLLM VM](anythingllm-service-identity-vm-setup.md) - **Staging/Production setup guide** (required before staging)
- [AnythingLLM Integration Plan](anythingllm-integration-plan.md)
- [AnythingLLM External Auth Implementation](anythingllm-external-auth-implementation.md)
- [AnythingLLM Admin Proxy Implementation](anythingllm-admin-proxy-implementation.md)
- [GCP Authentication Setup](gcp-authentication-setup.md)
- [HIPAA Authentication](hipaa-authentication.md)

## Testing

### Unit Tests

Unit tests are located in:
- `src/anythingllm/services/anythingllm-service-identity.service.spec.ts`
- `src/anythingllm/services/anythingllm-client.service.spec.ts`

**Run tests:**
```bash
npm test -- anythingllm-service-identity.service.spec.ts
npm test -- anythingllm-client.service.spec.ts
```

### E2E Tests

E2E tests are located in:
- `test/anythingllm/service-identity.e2e-spec.ts`

**Run E2E tests:**
```bash
# With AnythingLLM running
ANYTHINGLLM_BASE_URL=http://localhost:3001/api npm run test:e2e -- service-identity.e2e-spec.ts

# Skip if AnythingLLM not available
SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- service-identity.e2e-spec.ts
```

**E2E Test Coverage:**
- ✅ Service Identity Token Minting
- ✅ System Status Endpoints
- ✅ User Management (list, create)
- ✅ Invitation Management (list, create)
- ✅ Request Headers and Authentication
- ✅ Error Handling
- ✅ URL Construction

All E2E tests make **real HTTP requests** to AnythingLLM endpoints (no mocking).

## Future Enhancements

- [ ] Implement `local_jwt` mode for local development without GCP
- [ ] Add retry logic with exponential backoff for HTTP client
- [ ] Add circuit breaker pattern for AnythingLLM API failures
- [ ] Add request/response logging middleware (without sensitive data)
- [ ] Move secrets to GCP Secret Manager (when SecretManagerService is implemented)
- [ ] Add token signature verification in ServiceIdentityGuard
