# Running Keystone E2E Tests

## Quick Start

### Run All E2E Tests
```bash
npm run test:e2e
```

### Run the Full Workflow Suite (Recommended for System Validation)
```bash
npm run test:e2e -- keystone-full-workflow.e2e-spec.ts
```

This is the comprehensive test that validates the entire system.

---

## Individual Test Suites

### Document Upload with OCR (Most Comprehensive)
```bash
npm run test:e2e -- document-upload-with-ocr.e2e-spec.ts
```
**Proves:** User creation → workspace provisioning → OCR processing → AnythingLLM integration → streaming chat

### Workspace, Thread, Document
```bash
npm run test:e2e -- workspace-thread-document.e2e-spec.ts
```
**Proves:** Workspace management, thread creation, document upload, streaming chat

### User Provisioning
```bash
npm run test:e2e -- user-provisioning.e2e-spec.ts
```
**Proves:** User lifecycle, AnythingLLM sync, workspace assignment, status sync

### Role Mapping
```bash
npm run test:e2e -- role-mapping-provisioning.e2e-spec.ts
```
**Proves:** Admin/Manager/User role mapping to AnythingLLM

### External User Lookup
```bash
npm run test:e2e -- external-user-lookup.e2e-spec.ts
```
**Proves:** ExternalId lookup, provider verification, 404 handling

### Role Delegation
```bash
npm run test:e2e -- keystone-api-role-delegation.e2e-spec.ts
```
**Proves:** Delegated tokens (HS256), role-based authorization

### System Endpoints
```bash
npm run test:e2e -- system-endpoints.e2e-spec.ts
```
**Proves:** System health endpoints, role-based access

---

## Environment Variables

### Skip Tests
```bash
# Skip AnythingLLM-dependent tests
SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e

# Skip OCR-dependent tests
SKIP_OCR_TESTS=true npm run test:e2e

# Skip both
SKIP_ANYTHINGLLM_TESTS=true SKIP_OCR_TESTS=true npm run test:e2e
```

### Enable Stress Testing
```bash
ENABLE_STRESS_TEST=true npm run test:e2e -- keystone-full-workflow.e2e-spec.ts
```

### Run with Specific Port
```bash
APP_PORT=3000 npm run test:e2e
```

---

## Prerequisites

### Services Required
1. **Keystone API** - Running on `http://localhost:3000`
2. **AnythingLLM** - Running on `http://localhost:3001/api`
3. **PostgreSQL** - Database for Keystone
4. **GCP Services** - For OCR (Document AI, Vision AI)

### Environment Variables
```env
# Keystone API
APP_PORT=3000

# AnythingLLM
ANYTHINGLLM_BASE_URL=http://localhost:3001/api
ENABLE_DELEGATED_TOKENS=true
ANYTHINGLLM_DELEGATED_TOKEN_SECRET=<shared-secret>
ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE=anythingllm

# Auth
AUTH_JWT_SECRET=<secret>
AUTH_REFRESH_SECRET=<secret>

# Admin credentials
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secret
```

---

## Test Output Interpretation

### Success Indicators
- ✅ `[SUCCESS]` - Test step completed successfully
- ✅ `[INFO]` - Informational message
- ✅ `expected 200` - HTTP status assertions passed

### Warning Indicators
- ⚠️ `[SKIP]` - Test skipped (usually due to environment)
- ⚠️ `[WARN]` - Non-critical issue detected
- ⚠️ `[RETRY]` - Retrying due to transient failure

### Error Indicators
- ❌ `[ERROR]` - Test failed
- ❌ `expected 200, got 401` - HTTP status mismatch
- ❌ `[429]` - Rate limited (will auto-retry)

---

## Rate Limiting

The tests automatically handle rate limiting:

| Endpoint Type | Limit | TTL |
|---------------|-------|-----|
| Auth endpoints | 5 req/60s | 60s |
| Global endpoints | 10 req/60s | 60s |

When rate limited (429), tests automatically:
1. Log the rate limit detection
2. Wait for the full TTL window + 5s buffer
3. Retry the request

---

## Debugging Failed Tests

### Increase Timeout
```bash
# In jest-e2e.json
{
  "testTimeout": 120000  // 2 minutes
}
```

### Enable Verbose Logging
```bash
DEBUG=* npm run test:e2e -- keystone-full-workflow.e2e-spec.ts
```

### Run Single Test
```bash
npm run test:e2e -- --testNamePattern="should create user"
```

---

## Test Coverage Areas

| Area | Suite | Status |
|------|-------|--------|
| User Authentication | Phase 1 | ✅ |
| Role Mapping | Phase 2 | ✅ |
| User Provisioning | Phase 2 | ✅ |
| Document Upload | Phase 3 | ✅ |
| OCR Processing | Phase 3 | ✅ |
| AnythingLLM Integration | Phase 4 | ✅ |
| Streaming Chat | Phase 4 | ✅ |
| Status Sync | Phase 5 | ✅ |
| Error Handling | Phase 6 | ✅ |
| Rate Limiting | Phase 7 | ✅ |

---

## CI/CD Integration

### GitHub Actions Example
```yaml
jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: keystone_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:e2e
        env:
          APP_PORT: 3000
          SKIP_ANYTHINGLLM_TESTS: true
          SKIP_OCR_TESTS: true
```

---

## Troubleshooting

### "Connection refused"
- Ensure Keystone API is running on the expected port
- Check `APP_URL` environment variable

### "401 Unauthorized"
- Verify admin credentials are correct
- Check JWT secret configuration

### "429 Too Many Requests"
- Tests will auto-retry, but may timeout
- Increase test timeout or reduce concurrent tests

### "ANYTHINGLLM tests skipped"
- Set `SKIP_ANYTHINGLLM_TESTS=false`
- Ensure AnythingLLM is running
- Check `ANYTHINGLLM_BASE_URL` configuration
