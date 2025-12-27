# User Self-Management for Documents - Test Documentation

**Document Version**: 1.0  
**Date**: December 2025  
**Classification**: Internal - Test Documentation  
**Purpose**: Comprehensive documentation of test coverage and test scenarios for the user self-management feature

---

## Table of Contents

1. [Overview](#1-overview)
2. [Test Structure](#2-test-structure)
3. [Test Scenarios](#3-test-scenarios)
4. [Running Tests](#4-running-tests)
5. [Test Coverage](#5-test-coverage)
6. [Test Helpers](#6-test-helpers)
7. [Common Issues](#7-common-issues)

---

## 1. Overview

### 1.1 Test Philosophy

The test suite follows the existing E2E test patterns:
- **End-to-End**: Tests run against the full application stack
- **Realistic**: Uses actual database and API endpoints
- **Comprehensive**: Covers all user self-management scenarios
- **Isolated**: Each test creates its own test data

### 1.2 Test Files

- **Main Test File**: `test/document-processing/documents.e2e-spec.ts`
- **Manager Onboarding Tests**: `test/managers/manager-onboarding.e2e-spec.ts`
- **Access Control Tests**: `test/access-control/access-grants.e2e-spec.ts`

---

## 2. Test Structure

### 2.1 Test Organization

Tests are organized in a nested `describe` structure:

```
Document Processing Endpoints (E2E)
├── POST /v1/documents/upload
│   ├── should allow origin manager to upload document
│   ├── should allow user with assigned manager to upload document
│   ├── should reject admin from uploading documents
│   └── should allow user without assigned manager to upload document (self-managed) ✨
│
└── User Self-Management ✨
    ├── Upload without manager assignment
    │   └── should allow user to upload document and self-manage
    │
    ├── View self-managed document
    │   ├── should allow user to view their self-managed document
    │   └── should reject other users from viewing self-managed document
    │
    ├── Trigger OCR on self-managed document
    │   ├── should allow user to trigger OCR on their self-managed document
    │   └── should reject other users from triggering OCR
    │
    ├── Assign manager to self-managed document
    │   ├── should allow user to assign manager to their self-managed document
    │   ├── should reject assigning manager twice (immutable)
    │   └── should reject other users from assigning manager
    │
    └── User with manager assignment uploads new document
        └── should use assigned manager when user has manager assignment
```

### 2.2 Test Setup

```typescript
describe('User Self-Management', () => {
  let selfManagingUser: TestUser;
  let selfManagedDocId: string;
  let manager: TestManager;

  beforeAll(async () => {
    // Create user without manager assignment
    selfManagingUser = await createTestUser(RoleEnum.user, 'self-managing');
    
    // Create a manager for assignment tests
    manager = await createTestManager(adminToken);
  }, 120000); // 2 minute timeout for rate limiting
});
```

---

## 3. Test Scenarios

### 3.1 Upload Scenarios

#### Test: User Uploads Without Manager Assignment

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should allow user without assigned manager to upload document (self-managed)`

**Steps**:
1. Create user without manager assignment
2. Upload document
3. Verify `originManagerId` is `null`
4. Verify document is created successfully

**Expected Result**:
```json
{
  "status": 201,
  "body": {
    "id": "uuid",
    "originManagerId": null,
    "documentType": "LAB_RESULT",
    ...
  }
}
```

#### Test: User Uploads With Manager Assignment

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should allow user with assigned manager to upload document`

**Steps**:
1. Assign manager to user
2. Upload document
3. Verify `originManagerId` is set to manager ID

**Expected Result**:
```json
{
  "status": 201,
  "body": {
    "id": "uuid",
    "originManagerId": 123, // Manager ID
    ...
  }
}
```

### 3.2 View Scenarios

#### Test: User Views Own Self-Managed Document

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should allow user to view their self-managed document`

**Steps**:
1. Create self-managed document
2. User requests document
3. Verify 200 response
4. Verify `originManagerId` is `null`

**Expected Result**: `200 OK` with document data

#### Test: Other User Cannot View Self-Managed Document

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should reject other users from viewing self-managed document`

**Steps**:
1. Create self-managed document
2. Different user requests document
3. Verify 403/404 response

**Expected Result**: `403 Forbidden` or `404 Not Found`

### 3.3 OCR Trigger Scenarios

#### Test: User Triggers OCR on Self-Managed Document

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should allow user to trigger OCR on their self-managed document`

**Steps**:
1. Create self-managed document
2. User triggers OCR
3. Verify 202 (accepted) or 400 (not ready) response

**Expected Result**: `202 Accepted` or `400 Bad Request` (if document not in triggerable state)

**Note**: This test follows the original pattern - accepts both success and "not ready" states.

#### Test: Other User Cannot Trigger OCR

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should reject other users from triggering OCR`

**Steps**:
1. Create self-managed document
2. Different user triggers OCR
3. Verify 403 response

**Expected Result**: `403 Forbidden`

### 3.4 Manager Assignment Scenarios

#### Test: User Assigns Manager to Self-Managed Document

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should allow user to assign manager to their self-managed document`

**Steps**:
1. Create self-managed document
2. User assigns manager
3. Verify 200 response
4. Verify `originManagerId` is updated
5. Verify `originManagerId` is not null

**Expected Result**:
```json
{
  "status": 200,
  "body": {
    "id": "uuid",
    "originManagerId": 123, // Manager ID
    ...
  }
}
```

#### Test: Cannot Assign Manager Twice

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should reject assigning manager twice (immutable)`

**Steps**:
1. Create self-managed document
2. Assign manager (first time) - should succeed
3. Try to assign manager again (second time)
4. Verify 400 response

**Expected Result**: `400 Bad Request` with message "Document already has a manager"

#### Test: Other User Cannot Assign Manager

**File**: `test/document-processing/documents.e2e-spec.ts`  
**Test Name**: `should reject other users from assigning manager`

**Steps**:
1. Create self-managed document
2. Different user tries to assign manager
3. Verify 403 response

**Expected Result**: `403 Forbidden`

### 3.5 Manager Onboarding Test Updates

#### Test: User Without Manager Can Upload

**File**: `test/managers/manager-onboarding.e2e-spec.ts`  
**Test Name**: `should ALLOW user without assigned manager to upload document (self-managed)`

**Note**: This test was updated from expecting rejection (400) to expecting success (201).

**Steps**:
1. Create user without manager assignment
2. Upload document
3. Verify 201 response
4. Verify `originManagerId` is `null`

**Expected Result**: `201 Created` with `originManagerId: null`

---

## 4. Running Tests

### 4.1 Prerequisites

1. **Database**: Ensure database is running and migrations are applied
   ```bash
   npm run migration:run
   ```

2. **Environment**: Ensure `.env` is configured correctly

3. **Dependencies**: Install all dependencies
   ```bash
   npm install
   ```

### 4.2 Running All Document Tests

```bash
npm run test:e2e -- test/document-processing/documents.e2e-spec.ts
```

### 4.3 Running Self-Management Tests Only

```bash
npm run test:e2e -- test/document-processing/documents.e2e-spec.ts -t "User Self-Management"
```

### 4.4 Running Manager Onboarding Tests

```bash
npm run test:e2e -- test/managers/manager-onboarding.e2e-spec.ts
```

### 4.5 Running Access Control Tests

```bash
npm run test:e2e -- test/access-control/access-grants.e2e-spec.ts
```

### 4.6 Test Timeouts

Self-management tests have extended timeouts due to:
- User creation rate limiting (65 second waits)
- Manager creation delays
- Document processing delays

Default timeout: **120 seconds** (2 minutes)

---

## 5. Test Coverage

### 5.1 Upload Coverage

✅ User uploads without manager → Self-managed document  
✅ User uploads with manager → Manager-managed document  
✅ Manager uploads → Manager-managed document  
✅ Admin uploads → Rejected (403)

### 5.2 View Coverage

✅ Self-managing user views own document → Allowed  
✅ Other user views self-managed document → Denied  
✅ Manager views own document → Allowed  
✅ User with grant views document → Allowed

### 5.3 OCR Trigger Coverage

✅ Self-managing user triggers OCR → Allowed  
✅ Other user triggers OCR → Denied  
✅ Manager triggers OCR → Allowed  
✅ User with grant triggers OCR → Denied

### 5.4 Manager Assignment Coverage

✅ User assigns manager to own document → Allowed  
✅ User assigns manager twice → Denied (immutable)  
✅ Other user assigns manager → Denied  
✅ Assigning to non-self-managed document → Denied

### 5.5 Edge Cases

✅ Document already processed → Handled gracefully  
✅ Manager not verified → Rejected  
✅ Document not found → 404  
✅ Invalid manager ID → 404

---

## 6. Test Helpers

### 6.1 createTestUser()

Creates a test user with specified role.

```typescript
const user = await createTestUser(RoleEnum.user, 'test-prefix');
// Returns: { id: number, email: string, token: string, roleId: RoleEnum }
```

**Features**:
- Handles rate limiting automatically
- Waits for email confirmation
- Returns authenticated token

### 6.2 createTestManager()

Creates a test manager via admin invitation flow.

```typescript
const manager = await createTestManager(adminToken);
// Returns: { id: number, userId: number, token: string }
```

**Features**:
- Creates manager invitation
- Accepts invitation
- Verifies manager
- Returns authenticated token

### 6.3 readPdfFile()

Reads a test PDF file for uploads.

```typescript
const pdfBuffer = readPdfFile(getTestPdfPath());
```

**Location**: `test/utils/test-helpers.ts`

---

## 7. Common Issues

### 7.1 Rate Limiting

**Symptom**: Tests fail with 429 (Too Many Requests)

**Solution**: Test helpers automatically handle rate limiting with retries and 65-second waits. If tests still fail:
- Run tests sequentially (not in parallel)
- Increase delays between test suites
- Check rate limit configuration

### 7.2 Timeout Errors

**Symptom**: Tests timeout before completion

**Solution**: 
- Increase timeout in `beforeAll` hooks (default: 120000ms)
- Check database connection
- Verify all services are running

### 7.3 Document Not Found (404)

**Symptom**: Tests expect document but get 404

**Possible Causes**:
- Document not created successfully
- Document ID mismatch
- Database transaction issues

**Solution**:
- Verify document creation response
- Check document ID is stored correctly
- Ensure database transactions are committed

### 7.4 Authorization Failures (403)

**Symptom**: Tests expect access but get 403

**Possible Causes**:
- Incorrect actor type
- Missing access grants
- Self-management check failing

**Solution**:
- Verify actor matches `originUserContextId` for self-managed docs
- Check `isOriginManager()` logic
- Verify access grant creation

### 7.5 Manager Assignment Failures

**Symptom**: Cannot assign manager to document

**Possible Causes**:
- Document already has manager
- Manager not verified
- Actor is not self-managing user

**Solution**:
- Verify `originManagerId` is `null` before assignment
- Check manager verification status
- Verify actor matches `originUserContextId`

---

## 8. Test Data Management

### 8.1 Test Isolation

Each test creates its own:
- Users
- Managers
- Documents
- Access grants

This ensures tests don't interfere with each other.

### 8.2 Cleanup

Tests don't explicitly clean up data. The test database should be:
- Reset between test runs
- Isolated from production
- Regularly cleaned

### 8.3 Test Data Patterns

**User Emails**: `{prefix}.{timestamp}.{random}@example.com`  
**Document IDs**: UUIDs generated by the system  
**Manager IDs**: Sequential integers from database

---

## 9. Continuous Integration

### 9.1 CI Configuration

Tests should run in CI with:
- Isolated test database
- Proper environment variables
- Extended timeouts
- Sequential execution (to avoid rate limiting)

### 9.2 Test Reports

Test results include:
- Pass/fail status
- Execution time
- Console logs
- Error messages

---

## 10. Best Practices

### 10.1 Writing New Tests

1. **Use Test Helpers**: Always use `createTestUser()`, `createTestManager()`, etc.
2. **Handle Rate Limiting**: Be aware of rate limits and use appropriate timeouts
3. **Verify Responses**: Check both status codes and response bodies
4. **Test Edge Cases**: Include negative test cases
5. **Isolate Tests**: Don't depend on other tests' data

### 10.2 Debugging Tests

1. **Check Console Logs**: Tests output detailed logs
2. **Verify Database State**: Check database directly if needed
3. **Use Debugger**: Set breakpoints in test code
4. **Run Single Test**: Use `-t` flag to run specific test

### 10.3 Maintaining Tests

1. **Update When API Changes**: Keep tests in sync with implementation
2. **Review Test Coverage**: Ensure all scenarios are covered
3. **Refactor Common Patterns**: Extract repeated code to helpers
4. **Document Complex Tests**: Add comments for non-obvious logic

---

## Appendix A: Test Execution Example

```bash
$ npm run test:e2e -- test/document-processing/documents.e2e-spec.ts

> nestjs-boilerplate@1.2.0 test:e2e
> env-cmd jest --config ./test/jest-e2e.json test/document-processing/documents.e2e-spec.ts

 PASS  test/document-processing/documents.e2e-spec.ts (265.704 s)
  Document Processing Endpoints (E2E)
    POST /v1/documents/upload
      ✓ should allow origin manager to upload document (875 ms)
      ✓ should allow user with assigned manager to upload document (1066 ms)
      ✓ should reject admin from uploading documents (403) (18 ms)
      ✓ should allow user without assigned manager to upload document (self-managed) (3176 ms)
      ...
    User Self-Management
      Upload without manager assignment
        ✓ should allow user to upload document and self-manage (1061 ms)
      View self-managed document
        ✓ should allow user to view their self-managed document (23 ms)
        ✓ should reject other users from viewing self-managed document (2317 ms)
      Trigger OCR on self-managed document
        ✓ should allow user to trigger OCR on their self-managed document (6 ms)
        ✓ should reject other users from triggering OCR (2296 ms)
      Assign manager to self-managed document
        ✓ should allow user to assign manager to their self-managed document (10 ms)
        ✓ should reject assigning manager twice (immutable) (475 ms)
        ✓ should reject other users from assigning manager (2807 ms)
      User with manager assignment uploads new document
        ✓ should use assigned manager when user has manager assignment (837 ms)

Test Suites: 1 passed, 1 total
Tests:       9 skipped, 54 passed, 63 total
```

---

**End of Document**

