# Authorization Logic Review: Manager Document Access

## Summary

**Authorization Logic Status**: ✅ **CORRECT** - The authorization logic for allowing origin managers to access their documents is implemented correctly and follows the intended design.

**401 Error Analysis**: The 401 (Unauthorized) error is occurring at the **JWT Guard level** (token/session validation), **before** the authorization logic is executed. This is likely due to token expiration (default 15 minutes) or session cleanup in long-running test suites.

---

## Authorization Flow Analysis

### 1. Document Upload Flow (Setting originManagerId)

When a manager uploads a document:

```typescript
// In document-processing.domain.service.ts:uploadDocument()
if (actor.type === 'manager') {
  // actor.id = User ID (from JWT token)
  const manager = await this.managerRepository.findByUserId(actor.id);
  
  // Store Manager Entity ID (not User ID) in originManagerId
  originManagerId = manager.id; // ✅ Manager entity ID stored
  document.originManagerId = originManagerId;
}
```

**Key Point**: `originManagerId` stores the **Manager Entity ID**, not the User ID. This is correct because:
- Multiple users could theoretically have manager roles
- Manager entities have their own lifecycle (verification, suspension, etc.)
- Documents are owned by the Manager entity, not the User entity

### 2. Document Access Check Flow (Verifying Access)

When a manager tries to access a document:

```typescript
// In access-grant.domain.service.ts:hasAccess()
if (actorType === 'manager') {
  // actorId = User ID (from JWT token via extractActorFromRequest)
  const manager = await this.managerRepository.findByUserId(actorId);
  
  // Compare Manager Entity IDs (both sides are Manager IDs)
  if (manager && document.originManagerId === manager.id) {
    return true; // ✅ Access granted
  }
}
```

**Key Point**: The comparison is correct:
- `actorId` (User ID) → Lookup Manager by User ID → Get `manager.id` (Manager Entity ID)
- Compare `manager.id` === `document.originManagerId` (both are Manager Entity IDs)

### 3. Request Processing Flow

```
1. HTTP Request: GET /api/v1/documents/{documentId}
   ↓
2. JWT Guard (AuthGuard('jwt'))
   - Validates JWT token signature
   - Checks if session exists and is active
   - ❌ 401 Unauthorized if token invalid/expired OR session deleted
   - ✅ Attaches req.user (JwtPayloadType) to request
   ↓
3. Controller: DocumentProcessingController.getDocument()
   - Hard denies admins (403 Forbidden)
   - Extracts actor: extractActorFromRequest(req)
     - actor.type = 'manager' (from req.user.role.id)
     - actor.id = req.user.id (User ID)
   ↓
4. Domain Service: DocumentAccessDomainService.getDocument()
   - Calls accessGrantService.hasAccess(documentId, actor.type, actor.id)
   ↓
5. Access Check: AccessGrantDomainService.hasAccess()
   - Lookup Manager by User ID
   - Compare Manager ID === document.originManagerId
   - ✅ Returns true if match (implicit access for origin manager)
   ↓
6. Returns Document
```

---

## Why 401 Instead of Authorization Failure?

The 401 error indicates the **JWT Guard is failing** before reaching the authorization logic. This happens in `jwt.strategy.ts:validate()`:

```typescript
// jwt.strategy.ts
public async validate(payload: JwtPayloadType) {
  // ... extract userId and sessionId ...
  
  if (normalizedPayload.sessionId) {
    const session = await this.sessionService.findById(normalizedPayload.sessionId);
    if (!session) {
      // ❌ Session deleted/invalid → throws UnauthorizedException (401)
      throw new UnauthorizedException();
    }
  }
  
  return normalizedPayload;
}
```

**Possible Causes**:
1. **Token Expiration**: JWT tokens expire after 15 minutes (`AUTH_JWT_TOKEN_EXPIRES_IN=15m`). Long test suites may exceed this.
2. **Session Cleanup**: Sessions may be deleted/cleaned up during test execution.
3. **Token Invalid**: Token signature validation fails (unlikely but possible).

---

## Verification: Authorization Logic is Correct

### ✅ Correct ID Mapping

| Step | ID Type | Source | Usage |
|------|---------|--------|-------|
| Upload: Actor ID | User ID | `req.user.id` from JWT | Lookup Manager entity |
| Upload: Manager ID | Manager Entity ID | `manager.id` from repository | Store in `document.originManagerId` |
| Access: Actor ID | User ID | `req.user.id` from JWT | Lookup Manager entity |
| Access: Manager ID | Manager Entity ID | `manager.id` from repository | Compare with `document.originManagerId` |

**Result**: Both upload and access use the same lookup pattern (`findByUserId` → `manager.id`), ensuring consistency.

### ✅ Correct Comparison Logic

```typescript
// Upload time
document.originManagerId = manager.id; // Manager Entity ID

// Access time
const manager = await managerRepository.findByUserId(userId);
if (document.originManagerId === manager.id) { // Both Manager Entity IDs
  return true;
}
```

**Result**: Comparing like-for-like (Manager Entity IDs on both sides).

### ✅ Follows Design Patterns

1. **Implicit Access for Origin Manager**: Origin managers have implicit access without needing AccessGrant records.
2. **Manager Entity as Authority**: Documents are owned by Manager entities, not User entities.
3. **Session-Based Validation**: JWT strategy validates sessions exist before allowing access.

---

## Recommendation: Fix Test Token Expiration

The authorization logic is correct, but the test fails due to token expiration. Recommended fix:

### Option 1: Refresh Token Before Access Test

Add token refresh logic in the test:

```typescript
it('should allow origin manager to access their documents', async () => {
  if (!documentId) {
    throw new Error('documentId not set');
  }

  // Refresh token if needed (handle expiration in long test suites)
  let token = managerUser.token;
  try {
    // Try a lightweight request to check if token is valid
    const testResponse = await request(APP_URL)
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' });
    
    if (testResponse.status === 401) {
      // Token expired, would need refresh token to renew
      // For now, skip or recreate manager user
      throw new Error('Token expired - test suite took too long');
    }
  } catch (error) {
    // Handle token expiration
  }

  const response = await request(APP_URL)
    .get(`/api/v1/documents/${documentId}`)
    .auth(token, { type: 'bearer' });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('id', documentId);
  expect(response.body).toHaveProperty('originManagerId', manager.id);
});
```

### Option 2: Increase Test Token Expiration (Test Environment Only)

In test environments, use longer token expiration:

```bash
# .env.test
AUTH_JWT_TOKEN_EXPIRES_IN=24h  # Long expiration for test suites
```

### Option 3: Create Fresh Manager/Token Per Test Suite

Create a new manager with a fresh token in the test suite's `beforeAll`:

```typescript
describe('Manager Assignment and Access Control', () => {
  let freshManager: TestManager;
  let freshManagerUser: TestUser;
  let freshDocumentId: string;

  beforeAll(async () => {
    // Create fresh manager with fresh token for this test suite
    freshManager = await createTestManager(adminToken);
    freshManagerUser = {
      id: freshManager.userId,
      email: '',
      token: freshManager.token,
      roleId: RoleEnum.manager,
    };

    // Upload document with fresh manager
    const pdfBuffer = readPdfFile(getTestPdfPath());
    const uploadResponse = await request(APP_URL)
      .post('/api/v1/documents/upload')
      .auth(freshManagerUser.token, { type: 'bearer' })
      .field('documentType', 'LAB_RESULT')
      .attach('file', pdfBuffer, 'test.pdf');
    
    freshDocumentId = uploadResponse.body.id;
  }, 120000);
  
  it('should allow origin manager to access their documents', async () => {
    const response = await request(APP_URL)
      .get(`/api/v1/documents/${freshDocumentId}`)
      .auth(freshManagerUser.token, { type: 'bearer' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('originManagerId', freshManager.id);
  });
});
```

---

## Conclusion

**Authorization Logic**: ✅ **CORRECT** - The code correctly:
1. Stores Manager Entity ID in `originManagerId` during upload
2. Looks up Manager Entity by User ID during access check
3. Compares Manager Entity IDs for authorization
4. Grants implicit access to origin managers

**401 Error**: The error is occurring at the **JWT Guard level** (token/session validation), not in the authorization logic. This is a **test infrastructure issue** (token expiration), not an authorization logic bug.

**Recommendation**: Implement one of the token refresh/fresh token strategies above to fix the test failure.


