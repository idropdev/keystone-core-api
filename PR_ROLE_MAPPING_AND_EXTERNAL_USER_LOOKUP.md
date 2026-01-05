# Pull Request: Role Mapping and External User Lookup Implementation

## 📋 Summary

**Type:** [x] Feature | [ ] Bug Fix | [ ] Refactor | [ ] Documentation | [ ] Performance | [ ] Security

**Related Issue(s):** <!-- Add issue numbers if applicable -->

This PR implements comprehensive role mapping from Keystone to AnythingLLM and adds external user lookup capabilities. Users created in Keystone are now automatically provisioned to AnythingLLM with appropriate role mappings (`admin`, `manager`, `default`), and the system can efficiently lookup users by their external ID.

---

## 🎯 Changes Overview

### What Changed
- Implemented role mapping from Keystone `RoleEnum` to AnythingLLM roles (admin, manager, default)
- Added external user lookup endpoint support (`GET /v1/admin/users/external/:externalId?provider=keystone`)
- Extended registry client to support query parameters
- Updated schemas to include `externalId` and `externalProvider` fields
- Optimized workspace assignment (skip for admin/manager roles)
- Added comprehensive test coverage (E2E and unit tests)

### Why Changed
- Enable automatic role-based provisioning when users are created in Keystone
- Improve idempotency checks with efficient O(1) lookups instead of O(n) list-and-filter
- Support AnythingLLM's external user management requirements
- Ensure proper role mapping alignment with AnythingLLM's role system

---

## 🔍 Functionality Changes

### Key Features

### 1. Role Mapping Implementation

- **Role Mapping Function**: Maps Keystone's `RoleEnum` (admin, manager, user) to AnythingLLM roles (admin, manager, default)
- **Automatic Provisioning**: Users are automatically provisioned with the correct role when created in Keystone
- **External Identity Fields**: Users are marked with `externalId` and `externalProvider` to indicate they're externally managed

**Role Mapping Table:**
| Keystone Role | AnythingLLM Role | Description |
|---------------|------------------|-------------|
| `admin` (ID: 1) | `admin` | Full system access, can manage all users and settings |
| `manager` (ID: 2) | `manager` | Can manage workspaces, documents, and users (but not other admins) |
| `user` (ID: 3) / `null` / `undefined` | `default` | Standard user with access to assigned workspaces only |

### 2. External User Lookup Endpoint

- **New Endpoint**: `GET /v1/admin/users/external/:externalId?provider=keystone`
- **Efficient Lookup**: Replaces O(n) list-and-filter approach with O(1) direct lookup
- **Idempotency**: Used for idempotency checks before user creation
- **Query Parameter Support**: Extended registry client to support query parameters

### 3. Registry Client Enhancements

- **Query Parameter Support**: Added `query` option to `RegistryCallOptions`
- **URL Building**: Enhanced `buildPath()` to append query strings to URLs
- **Type Safety**: Added `QueryParams` type for query parameter handling

### 4. Schema Updates

- **AdminUserSchema**: Added `externalId` and `externalProvider` optional fields
- **CreateUserRequestSchema**: Added `externalId` and `externalProvider` fields
- **AdminUserRole Enum**: Added `MANAGER = 'manager'` role

### 5. Workspace Assignment Optimization

- **Smart Assignment**: Admin and manager roles skip workspace assignment (they have access to all workspaces automatically)
- **Default Users**: Workspace assignment for default users is temporarily skipped (to be implemented when workspace creation is added)

## Technical Changes

### Core Implementation Files

#### `src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts`
- Added `mapKeystoneRoleToAnythingLLMRole()` private method
- Updated `createUserInAnythingLLM()` to use role mapping and include external identity fields
- Replaced list-and-filter idempotency check with direct external ID lookup
- Improved error handling to use `UpstreamError` properly
- Updated audit logs to include `keystoneRoleId` and `anythingllmRole`
- Optimized workspace assignment to skip for admin/manager roles

#### `src/anythingllm/admin/anythingllm-admin.service.ts`
- Added `getUserByExternalId(externalId, provider)` method
- Uses the new external user lookup endpoint with query parameter support

#### `src/anythingllm/registry/anythingllm-endpoints.registry.ts`
- Added `GET_USER_BY_EXTERNAL_ID: 'admin.getUserByExternalId'` endpoint ID
- Registered endpoint: `GET /v1/admin/users/external/:externalId`

#### `src/anythingllm/registry/anythingllm-registry-client.ts`
- Added `QueryParams` type
- Extended `RegistryCallOptions` interface with `query?: QueryParams`
- Enhanced `buildPath()` method to append query parameters to URLs

#### `src/anythingllm/registry/schemas/admin-user.schema.ts`
- Added `MANAGER = 'manager'` to `AdminUserRole` enum
- Added `externalId?: string | null` to `AdminUserSchema` and `CreateUserRequestSchema`
- Added `externalProvider?: string | null` to `AdminUserSchema` and `CreateUserRequestSchema`

### Test Files

#### `test/anythingllm/role-mapping-provisioning.e2e-spec.ts`
Comprehensive E2E tests covering:
- Admin role mapping (Keystone admin → AnythingLLM admin)
- Manager role mapping (Keystone manager → AnythingLLM manager)
- Default/User role mapping (Keystone user → AnythingLLM default)
- Edge cases (null/undefined roles, unknown role IDs)
- External identity fields verification
- AnythingLLM unavailable scenarios (graceful degradation)
- Role mapping table correctness verification

#### `test/anythingllm/external-user-lookup.e2e-spec.ts`
New test suite covering:
- Successful lookup of existing external users
- 404 error handling for non-existent users
- Provider parameter handling (default and explicit values)
- Endpoint URL format verification
- Integration with user provisioning flow
- Error handling scenarios (network errors, token errors)

#### `test/anythingllm/role-mapping.unit.spec.ts`
Unit tests for the role mapping function:
- All valid `RoleEnum` mappings
- Null/undefined input handling
- Unknown role ID handling
- String and numeric role ID handling

---

## 🧪 Testing

### Test Results

All tests passing:
- ✅ **12/12** role mapping provisioning E2E tests
- ✅ **7/7** external user lookup E2E tests
- ✅ **All unit tests** for role mapping function

### Test Coverage

- **Role Mapping**: Tests verify correct mapping for all role types and edge cases
- **External Identity**: Tests verify `externalId` and `externalProvider` are correctly set
- **Error Handling**: Tests verify graceful degradation when AnythingLLM is unavailable
- **Idempotency**: Tests verify user lookup works correctly for idempotency checks
- **Integration**: Tests verify end-to-end flow from user creation to AnythingLLM provisioning

### Test Files Added/Modified
- `test/anythingllm/role-mapping-provisioning.e2e-spec.ts` (new)
- `test/anythingllm/external-user-lookup.e2e-spec.ts` (new)
- `test/anythingllm/role-mapping.unit.spec.ts` (new)

---

## ⚠️ Breaking Changes

**None.** This is a backward-compatible enhancement.

---

## 🔄 Migration Notes

No migration required. Existing users will continue to work as before. New users will automatically benefit from role mapping.

---

## 🔒 Security Considerations

- ✅ External identity fields (`externalId`, `externalProvider`) are properly validated
- ✅ Role mapping respects AnythingLLM's role immutability for external users
- ✅ Service identity authentication required for external user lookup
- ✅ No PHI in logs or audit trails (only user IDs and role names)
- ✅ Idempotency checks prevent duplicate user creation

---

## ⚡ Performance Improvements

- **Before**: O(n) list-and-filter for idempotency checks
- **After**: O(1) direct lookup by external ID
- **Impact**: Significantly faster user provisioning, especially as user count grows

---

## 🚀 Future Enhancements

- [ ] Implement workspace creation and assignment for default users
- [ ] Add support for additional role mappings if needed
- [ ] Consider caching external user lookups for frequently accessed users

---

## 📚 Related Documentation

- `docs/user creation s2s athorization propagation.md` - AnythingLLM side implementation reference
- AnythingLLM API documentation for external user lookup endpoint

---

## 📝 Checklist

- [x] Code follows project style guidelines
- [x] Tests added/updated and passing (19 new tests)
- [x] Documentation updated (PR description)
- [x] No breaking changes
- [x] Error handling implemented
- [x] Logging/Audit trails in place
- [x] Security considerations addressed
- [x] Performance considerations addressed (O(n) → O(1) improvement)
- [x] HIPAA compliance maintained (no PHI in logs)

