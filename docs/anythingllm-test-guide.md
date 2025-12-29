# AnythingLLM Test Suite

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



