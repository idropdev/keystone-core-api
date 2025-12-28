# AnythingLLM Service Identity Implementation

**Status:** ✅ Implemented  
**Date:** 2025-12-27  
**Service Account:** `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`

## Overview

This document describes the implementation of service identity token minting in Keystone Core API to authenticate requests to AnythingLLM's internal/admin routes using GCP service account OIDC ID tokens.

## Architecture

The implementation follows NestJS module patterns and provides:

1. **Service Identity Token Provider** - Mints OIDC ID tokens using `google-auth-library`
2. **HTTP Client Service** - Makes authenticated requests to AnythingLLM APIs with automatic token injection
3. **Health Check Service** - Provides health check endpoint to verify connectivity
4. **Configuration** - Environment-based config with validation

## Module Structure

```
src/anythingllm/
├── config/
│   ├── anythingllm-config.type.ts
│   └── anythingllm.config.ts
├── services/
│   ├── anythingllm-service-identity.service.ts
│   ├── anythingllm-client.service.ts
│   ├── anythingllm-health.service.ts
│   ├── anythingllm-service-identity.service.spec.ts
│   └── anythingllm-client.service.spec.ts
└── anythingllm.module.ts
```

## Configuration

### Environment Variables

```env
# Service identity configuration
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp  # Options: gcp, local_jwt (local_jwt not yet implemented)
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal  # Must match AnythingLLM config
ANYTHINGLLM_BASE_URL=http://localhost:3001/api  # Base URL for AnythingLLM API (include /api prefix if needed)
```

**Important:** `ANYTHINGLLM_SERVICE_AUDIENCE` must exactly match `ANYTHINGLLM_SERVICE_AUDIENCE` in AnythingLLM configuration.

### Configuration Type

```typescript
export type AnythingLLMConfig = {
  serviceAuthMode: 'gcp' | 'local_jwt';
  serviceAudience: string;
  baseUrl: string;
};
```

## Services

### AnythingLLMServiceIdentityService

Mints OIDC ID tokens using GCP service account identity via `google-auth-library`.

**Features:**
- Token caching (55-minute TTL for 1-hour tokens)
- Supports ADC (Application Default Credentials), service account key files, and impersonation
- HIPAA-compliant logging (no tokens or PHI)
- Automatic token refresh

**Usage:**
```typescript
const token = await serviceIdentityService.getIdToken();
```

### AnythingLLMClientService

HTTP client for making authenticated requests to AnythingLLM APIs.

**Features:**
- Automatic service identity token injection
- Request ID generation (UUID)
- Standard headers (`Authorization`, `X-Request-Id`, `X-Client-Service`)
- Comprehensive logging for debugging
- Error handling (fail-closed)

**Usage:**
```typescript
const response = await anythingllmClient.callAnythingLLM(
  '/v1/admin/is-multi-user-mode',
  { method: 'GET' }
);

const data = await response.json();
```

### AnythingLLMHealthService

Health check service for verifying AnythingLLM connectivity and authentication.

**Features:**
- Tests token minting
- Tests API connectivity
- Tests authentication
- Returns detailed health status

**Endpoint:** `GET /api/health/anythingllm`

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

### POST Request Example

```typescript
async createWorkspace(name: string) {
  const response = await this.anythingllmClient.callAnythingLLM(
    '/v1/workspace/new',
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create workspace: ${response.status} - ${errorText}`);
  }

  return await response.json();
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

## Logging

The implementation includes comprehensive logging for debugging and monitoring:

### Service Identity Service Logs

- Configuration values (auth mode, audience)
- GCP credentials type (ADC, key file, impersonation)
- GCP Project ID
- Token minting progress and duration
- Token metadata (service account email, audience, expiration)
- Error details with stack traces

### HTTP Client Service Logs

- Request details (method, URL, request ID)
- Token metadata (service account email, audience)
- Response details (status, duration)
- Error details with full error messages

### Log Levels

Logs use `warn` level to ensure visibility with default logger configuration. All logs are HIPAA-compliant (no tokens or PHI).

**Example Log Output:**
```
[Service Identity] Configuration - AuthMode: gcp | Audience: anythingllm-internal
[Service Identity] Using service account key file: .secrets/keystone-sa-key.json
[Service Identity] GCP Project ID: anythingllm-dropdev-hybrid-v1
[Service Identity] Successfully minted GCP ID token | Audience: anythingllm-internal | Service Account: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com | Token Audience: anythingllm-internal | Expires: 2025-12-28T06:52:36.000Z | Duration: 165ms | Token Length: 881 bytes
[AnythingLLM Request] GET http://localhost:3001/api/v1/admin/is-multi-user-mode | RequestId: d23ec9d8-da6e-4d4b-a2a4-099f2deb1e0d | Token Service Account: keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com | Token Audience: anythingllm-internal | Token Length: 881 bytes
[AnythingLLM Response] GET http://localhost:3001/api/v1/admin/is-multi-user-mode | Status: 200 | Duration: 181ms | RequestId: d23ec9d8-da6e-4d4b-a2a4-099f2deb1e0d
```

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

## Security Considerations

1. **Token Caching**: Tokens cached for 55 minutes (tokens expire in 1 hour)
2. **No Token Logging**: Never logs tokens in error messages or debug output
3. **Fail Closed**: If token minting fails, throw error (do not make unauthenticated requests)
4. **Audience Matching**: Must exactly match `anythingllm-internal` in AnythingLLM
5. **Service Account**: Relies on ADC/impersonation for local dev, attached service account for GCP

## Troubleshooting

### Common Issues

1. **"Failed to mint GCP ID token"**
   - Verify ADC is configured: `gcloud auth application-default print-access-token`
   - Verify `roles/iam.serviceAccountTokenCreator` permission is granted (for impersonation)
   - Verify service account is attached to the VM/Cloud Run instance
   - Check that `ANYTHINGLLM_SERVICE_AUDIENCE` is set correctly

2. **"Invalid service identity token" (401 from AnythingLLM)**
   - Verify `ANYTHINGLLM_SERVICE_AUDIENCE` matches in both services
   - Verify service account email is `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`
   - Check token expiration (tokens expire in 1 hour)
   - See debugging guide: `docs/anythingllm-service-identity-debugging.md`

3. **Local Development Issues**
   - Use `gcloud auth application-default login --impersonate-service-account=...` for local testing
   - Or use `local_jwt` mode (not yet implemented)

### Debugging Guide

For detailed debugging instructions when AnythingLLM rejects tokens, see:
- `docs/anythingllm-service-identity-debugging.md` - Comprehensive debugging guide
- `docs/anythingllm-debug-prompt.md` - Quick debugging prompt for code analysis

## Related Documentation

- [AnythingLLM Integration Plan](anythingllm-integration-plan.md)
- [AnythingLLM External Auth Implementation](anythingllm-external-auth-implementation.md)
- [GCP Authentication Setup](gcp-authentication-setup.md)
- [HIPAA Authentication](hipaa-authentication.md)

## TODO / Future Enhancements

- [ ] Implement `local_jwt` mode for local development without GCP
- [ ] Add retry logic with exponential backoff for HTTP client
- [ ] Add circuit breaker pattern for AnythingLLM API failures
- [ ] Add request/response logging middleware (without sensitive data)
- [ ] Move secrets to GCP Secret Manager (when SecretManagerService is implemented)

