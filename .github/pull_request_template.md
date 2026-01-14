# Pull Request

## 📋 Summary

<!-- Provide a brief summary of what this PR accomplishes -->

**Type:** [ ] Feature | [ ] Bug Fix | [ ] Refactor | [ ] Documentation | [ ] Performance | [ ] Security

**Related Issue(s):** <!-- Link to related issues, e.g., #123 -->

---

## 🎯 Changes Overview

<!-- High-level description of what changed -->

### What Changed
- 
- 
- 

### Why Changed
- 
- 

---

## 🔍 Functionality Changes

### API Endpoints

#### New Endpoints
- [ ] **Endpoint:** `METHOD /path`
  - **Description:**
  - **Request Body:**
  - **Response:**
  - **Authentication Required:** [ ] Yes | [ ] No
  - **Rate Limited:** [ ] Yes | [ ] No

#### Modified Endpoints
- [ ] **Endpoint:** `METHOD /path`
  - **Changes:**
  - **Breaking:** [ ] Yes | [ ] No
  - **Migration Notes:**

#### Removed Endpoints
- [ ] **Endpoint:** `METHOD /path`
  - **Reason:**
  - **Migration Path:**

### Data Models / Entities

#### New Models
- [ ] **Model:** `ModelName`
  - **Fields:**
  - **Relationships:**
  - **Indexes:**

#### Modified Models
- [ ] **Model:** `ModelName`
  - **Added Fields:**
  - **Removed Fields:**
  - **Modified Fields:**
  - **Migration Required:** [ ] Yes | [ ] No

#### Removed Models
- [ ] **Model:** `ModelName`
  - **Reason:**
  - **Data Migration:**

### Business Logic Changes

- [ ] **Service:** `ServiceName`
  - **Changes:**
  - **Impact:**

### Configuration Changes

- [ ] **New Environment Variables:**
  ```env
  NEW_VAR=description
  ```

- [ ] **Modified Environment Variables:**
  ```env
  MODIFIED_VAR=old_value → new_value
  ```

- [ ] **Removed Environment Variables:**
  ```env
  REMOVED_VAR=reason
  ```

- [ ] **Config Files Modified:**
  - 

### Dependencies

- [ ] **New Dependencies:**
  - `package-name@version` - Reason

- [ ] **Updated Dependencies:**
  - `package-name@old-version → new-version` - Reason

- [ ] **Removed Dependencies:**
  - `package-name@version` - Reason

---

## ✅ Health Checks

### Code Quality

- [ ] **Linting:** All files pass ESLint
  ```bash
  npm run lint
  ```

- [ ] **Type Checking:** No TypeScript errors
  ```bash
  npm run type-check
  ```

- [ ] **Code Formatting:** Code follows project style
  ```bash
  npm run format:check
  ```

- [ ] **No Console Logs:** Production code doesn't contain `console.log` (use Logger instead)

- [ ] **No Hardcoded Secrets:** All secrets come from environment variables or config

### Testing

- [ ] **Unit Tests:** New/modified code has unit tests
  - Coverage: `X%`
  ```bash
  npm run test
  ```

- [ ] **Integration Tests:** Integration tests added/updated
  ```bash
  npm run test:e2e
  ```

- [ ] **Manual Testing:** Manually tested the following:
  - [ ] Feature works as expected
  - [ ] Error cases handled properly
  - [ ] Edge cases considered

### Git Health

- [ ] **Merge Conflicts:** No merge conflicts with target branch
  ```bash
  git fetch origin main
  git merge origin/main
  ```

- [ ] **Commit Messages:** Follow conventional commits format
  - Format: `type(scope): description`
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

- [ ] **Commit History:** Clean, logical commit history
  - [ ] No "WIP" or "fix" commits
  - [ ] Commits are atomic and meaningful

- [ ] **Branch Status:** Up to date with target branch
  ```bash
  git log main..HEAD --oneline
  ```

### Security & HIPAA Compliance

- [ ] **No PHI in Logs:** No Protected Health Information logged
  - [ ] No emails in logs
  - [ ] No names in logs
  - [ ] No medical data in logs
  - [ ] Only IDs and metadata logged

- [ ] **No PHI in JWT:** JWT tokens don't contain PHI
  - [ ] Only user ID, role, sessionId in JWT
  - [ ] No email, name, or health data

- [ ] **Authentication:** All new endpoints require authentication
  - [ ] JWT guard applied
  - [ ] Session validation enabled

- [ ] **Authorization:** Proper authorization checks
  - [ ] Users can only access their own data
  - [ ] Role-based access control where applicable

- [ ] **Input Validation:** All inputs validated
  - [ ] DTOs use class-validator
  - [ ] File uploads validated (type, size)
  - [ ] SQL injection prevention (parameterized queries)

- [ ] **Rate Limiting:** Rate limiting applied to new endpoints
  - [ ] Throttler configured
  - [ ] Limits appropriate for endpoint

- [ ] **Audit Logging:** Security events logged
  - [ ] Login/logout events
  - [ ] Document access events
  - [ ] Failed authentication attempts

### Performance

- [ ] **Database Queries:** Optimized queries
  - [ ] No N+1 queries
  - [ ] Proper indexes added
  - [ ] Query performance tested

- [ ] **API Response Times:** Acceptable response times
  - [ ] < 200ms for simple endpoints
  - [ ] < 2s for complex operations
  - [ ] Async operations for long-running tasks

- [ ] **Memory Usage:** No memory leaks
  - [ ] Proper cleanup of resources
  - [ ] No circular references

### Documentation

- [ ] **Code Comments:** Complex logic documented
  - [ ] JSDoc comments for public methods
  - [ ] Inline comments for non-obvious code

- [ ] **API Documentation:** Swagger/OpenAPI updated
  - [ ] New endpoints documented
  - [ ] Request/response examples
  - [ ] Error responses documented

- [ ] **README/CHANGELOG:** Updated if needed
  - [ ] New features documented
  - [ ] Breaking changes documented
  - [ ] Migration guide if needed

### Database

- [ ] **Migrations:** Database migrations created (if needed)
  ```bash
  # Check for migration files
  ```

- [ ] **Migration Tested:** Migrations tested up and down
  - [ ] Up migration tested
  - [ ] Down migration tested
  - [ ] Data integrity verified

- [ ] **Backward Compatibility:** Schema changes backward compatible
  - [ ] Old code works with new schema
  - [ ] Migration path documented

### Build & Deployment

- [ ] **Build Success:** Project builds successfully
  ```bash
  npm run build
  ```

- [ ] **Docker:** Docker images build (if applicable)
  ```bash
  docker build -t keystone-core-api .
  ```

- [ ] **Environment Variables:** All required vars documented
  - [ ] `.env.example` updated
  - [ ] New vars documented in README

---

## 📊 PR Statistics

### Code Changes
- **Files Changed:** X
- **Lines Added:** +X
- **Lines Removed:** -X
- **Net Change:** +X

### File Breakdown
- **New Files:** X
- **Modified Files:** X
- **Deleted Files:** X

### Commits
- **Total Commits:** X
- **Commit Range:** `first-commit..last-commit`

---

## 🧪 Testing Instructions

### Prerequisites
```bash
# List any setup required
```

### Test Scenarios

#### Scenario 1: [Description]
1. Step 1
2. Step 2
3. Expected Result

#### Scenario 2: [Description]
1. Step 1
2. Step 2
3. Expected Result

### Test Data
<!-- Provide sample test data if needed -->

---

## 🔄 Migration Guide

<!-- If this PR requires data migration or breaking changes -->

### For Breaking Changes
1. Step 1
2. Step 2
3. Step 3

### Rollback Plan
1. Step 1
2. Step 2

---

## 📸 Screenshots / Examples

<!-- If applicable, add screenshots or API response examples -->

### Before
```json
{
  "example": "before"
}
```

### After
```json
{
  "example": "after"
}
```

---

## ⚠️ Breaking Changes

<!-- List any breaking changes -->

- [ ] **Breaking Change:** Description
  - **Impact:**
  - **Migration:**

---

## 🔗 Related

- Related PRs: <!-- #123, #456 -->
- Related Issues: <!-- #789 -->
- Documentation: <!-- Link to docs -->

---

## 📝 Additional Notes

<!-- Any additional context, concerns, or notes for reviewers -->

---

## ✅ Reviewer Checklist

### For Reviewers

- [ ] Code follows project conventions
- [ ] Tests are adequate and passing
- [ ] Documentation is updated
- [ ] Security considerations addressed
- [ ] Performance impact acceptable
- [ ] HIPAA compliance maintained
- [ ] No breaking changes (or properly documented)
- [ ] Migration path clear (if applicable)

---

## 🚀 Deployment Notes

<!-- Any special deployment considerations -->

- [ ] **Database Migration Required:** [ ] Yes | [ ] No
- [ ] **Environment Variables:** New vars needed
- [ ] **Feature Flags:** Any feature flags to enable
- [ ] **Rollout Plan:** Gradual rollout or all at once

