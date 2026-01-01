---
name: AnythingLLM Service Identity Implementation
overview: Implement service identity token minting using GCP service account to authenticate Keystone Core API requests to AnythingLLM's internal/admin routes. Creates a new anythingllm module with token provider and HTTP client service following existing NestJS patterns.
todos:
  - id: create-config-types
    content: Create anythingllm-config.type.ts and anythingllm.config.ts following the existing config pattern with validation
    status: pending
  - id: create-service-identity-service
    content: Create anythingllm-service-identity.service.ts with token minting using google-auth-library and caching
    status: pending
    dependencies:
      - create-config-types
  - id: create-client-service
    content: Create anythingllm-client.service.ts with HTTP client functionality and request ID generation
    status: pending
    dependencies:
      - create-service-identity-service
  - id: create-module
    content: Create anythingllm.module.ts wiring up services and exporting client service
    status: pending
    dependencies:
      - create-client-service
  - id: update-config-type
    content: Add AnythingLLMConfig to src/config/config.type.ts AllConfigType
    status: pending
    dependencies:
      - create-config-types
  - id: update-app-module
    content: Add anythingllmConfig to ConfigModule.forRoot load array in src/app.module.ts
    status: pending
    dependencies:
      - update-config-type
  - id: update-env-examples
    content: Add ANYTHINGLLM_* environment variables to env-example-document and env-example-relational
    status: pending
---

# AnythingLLM Service Identity Implementation Plan

## Overview

This plan implements service identity token minting in Keystone Core API to authenticate with AnythingLLM's internal/admin routes. The implementation follows existing NestJS module patterns and integrates with the GCP service account `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`.

## Architecture

The implementation creates a new `anythingllm` module that provides:

1. **Service Identity Token Provider** - Mints OIDC ID tokens using `google-auth-library`
2. **HTTP Client Service** - Makes authenticated requests to AnythingLLM APIs
3. **Configuration** - Environment-based config following existing patterns

## Implementation Details

### 1. Create AnythingLLM Module Structure

Create `src/anythingllm/` module following the existing module pattern:

- `src/anythingllm/config/anythingllm-config.type.ts` - TypeScript type definitions
- `src/anythingllm/config/anythingllm.config.ts` - NestJS config registration with validation
- `src/anythingllm/services/anythingllm-service-identity.service.ts` - Token minting service
- `src/anythingllm/services/anythingllm-client.service.ts` - HTTP client service
- `src/anythingllm/anythingllm.module.ts` - Module definition

### 2. Configuration (`anythingllm-config.type.ts` & `anythingllm.config.ts`)

**Environment Variables:**

- `ANYTHINGLLM_SERVICE_AUTH_MODE` (default: `gcp`) - Auth mode: `gcp` or `local_jwt`
- `ANYTHINGLLM_SERVICE_AUDIENCE` (default: `anythingllm-internal`) - Token audience (must match AnythingLLM config)
- `ANYTHINGLLM_BASE_URL` (required) - Base URL for AnythingLLM API (should include `/api` prefix if needed)

**Config Type:**

```typescript
export type AnythingLLMConfig = {
  serviceAuthMode: 'gcp' | 'local_jwt';
  serviceAudience: string;
  baseUrl: string;
};
```

Follow the validation pattern from `document-processing.config.ts` using `class-validator` decorators.

### 3. Service Identity Token Provider (`anythingllm-service-identity.service.ts`)

**Key Features:**

- Injectable NestJS service
- Uses `GoogleAuth` from `google-auth-library` (already installed v10.3.0)
- Token caching (55 minute TTL for 1-hour tokens)
- GCP mode: Uses `getIdTokenClient()` to mint OIDC ID tokens
- Local mode: TODO placeholder for future JWT signing (not implemented)
- Error handling with descriptive messages
- HIPAA-compliant: No token logging

**Implementation Notes:**

- Use `GoogleAuth` without explicit service account email (relies on ADC/impersonation)
- Cache tokens in-memory with expiration timestamp
- Throw errors if token minting fails (fail-closed)

### 4. HTTP Client Service (`anythingllm-client.service.ts`)

**Key Features:**

- Injectable NestJS service
- Injects `AnythingLLMServiceIdentityService` for token minting
- Injects `ConfigService` for base URL
- `callAnythingLLM(endpoint: string, options?: RequestInit): Promise<Response>`
- Adds headers:
- `Authorization: Bearer <token>`
- `X-Request-Id: <uuid>` (using `crypto.randomUUID()`)
- `X-Client-Service: keystone`
- `Content-Type: application/json`
- URL construction handles both relative and absolute URLs
- Throws errors if token minting fails (fail-closed)

**Implementation Notes:**

- Use native `fetch` (consistent with `auth-facebook.service.ts`)
- Generate request IDs using `crypto.randomUUID()` (Node.js 14.17+, no uuid package needed)
- Preserve existing headers from options parameter
- Handle base URL trailing slashes and endpoint leading slashes

### 5. Module Registration (`anythingllm.module.ts`)

- Import `ConfigModule.forFeature(anythingllmConfig)`
- Provide `AnythingLLMServiceIdentityService` and `AnythingLLMClientService`
- Export `AnythingLLMClientService` for use in other modules
- Follow the pattern from `document-processing.module.ts`

### 6. Configuration Integration

**Update `src/config/config.type.ts`:**

- Import `AnythingLLMConfig` type
- Add `anythingllm: AnythingLLMConfig;` to `AllConfigType`

**Update `src/app.module.ts`:**

- Import `anythingllmConfig` from the config file
- Add `anythingllmConfig` to the `ConfigModule.forRoot({ load: [...] })` array

### 7. Environment Variables Documentation

**Update `env-example-document` and `env-example-relational`:**

Add comments and variables:

```env
# AnythingLLM Service Identity Configuration
# TODO: These secrets must live in GCP Secret Manager in production.
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
# Base URL should include /api prefix if needed
# Example: https://anythingllm.internal.example.com/api
# Example (local): http://localhost:3001/api
ANYTHINGLLM_BASE_URL=http://localhost:3001/api
```

### 8. Usage Example Integration

The HTTP client service can be injected into other services (e.g., `DocumentProcessingService`) when AnythingLLM integration is needed:

```typescript
constructor(
  private readonly anythingllmClient: AnythingLLMClientService,
) {}

async checkMultiUserMode(): Promise<boolean> {
  const response = await this.anythingllmClient.callAnythingLLM(
    '/v1/admin/is-multi-user-mode',
    { method: 'GET' },
  );
  const data = await response.json();
  return data.isMultiUser === true;
}
```

## File Structure

```javascript
src/anythingllm/
├── config/
│   ├── anythingllm-config.type.ts
│   └── anythingllm.config.ts
├── services/
│   ├── anythingllm-service-identity.service.ts
│   └── anythingllm-client.service.ts
└── anythingllm.module.ts
```

## Dependencies

- ✅ `google-auth-library` (v10.3.0) - Already installed
- ✅ `crypto.randomUUID()` - Native Node.js (no package needed)
- ✅ `@nestjs/config` - Already installed
- ✅ `class-validator` - Already installed

## GCP Setup and IAM Permissions

**Service Account:** `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`

**IAM Permission Note:**

The `roles/iam.serviceAccountTokenCreator` permission is required for local impersonation and may be required in some org-restricted GCP environments. On GCE/Cloud Run, minting an ID token via metadata/ADC typically works without explicitly granting TokenCreator to itself (because the runtime can mint tokens for its own identity).

**When TokenCreator is required:**

- Local development with service account impersonation
- Minting tokens for a different service account
- Some org-policy-restricted environments

**For Local Development (Impersonation):**

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

**For GCE/Cloud Run:**

Attach the service account to the instance/service. TokenCreator may not be required unless org policies restrict it.

## Security Considerations

1. **Token Caching**: Tokens cached for 55 minutes (tokens expire in 1 hour)
2. **No Token Logging**: Never log tokens in error messages or debug output
3. **Fail Closed**: If token minting fails, throw error (do not make unauthenticated requests)
4. **Audience Matching**: Must exactly match `anythingllm-internal` in AnythingLLM
5. **Service Account**: Relies on ADC/impersonation for local dev, attached service account for GCP

## Testing Considerations

- Unit tests for token provider (mocking `google-auth-library`)
- Unit tests for HTTP client (mocking token provider and fetch)
- Integration tests require GCP setup or local JWT mode (TBD)

## TODOs for Future

- Implement `local_jwt` mode for local development without GCP
- Add retry logic with exponential backoff for HTTP client
- Add circuit breaker pattern for AnythingLLM API failures
- Add request/response logging (without sensitive data)