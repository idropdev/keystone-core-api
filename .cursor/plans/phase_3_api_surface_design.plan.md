# PHASE 3: API Surface Design - Document Identity Management Platform

## Status

**Phase**: 3 - API Surface Design (NO CODE)**Status**: Awaiting Approval**Document**: [docs/phase-3-api-surface-design.md](docs/phase-3-api-surface-design.md)

## Overview

This phase defines the complete REST API surface for the HIPAA-compliant Document Identity Management Platform. It specifies all endpoints, their purposes, required authorization, expected side effects, and request/response contracts.**Key Principle**: All endpoints follow the origin-centered, AccessGrant-driven access model. Authorization is enforced at the controller/guard level, with domain services handling business logic.

## Core Deliverables

### 1. Document Endpoints (8 endpoints)

- ✅ POST /v1/documents/upload - Upload document with origin manager selection
- ✅ GET /v1/documents/:id - Get document metadata
- ✅ GET /v1/documents/:id/download - Get signed download URL
- ✅ GET /v1/documents - List accessible documents
- ✅ GET /v1/documents/:id/status - Get processing status
- ✅ GET /v1/documents/:id/fields - Get extracted fields (OCR + edits)
- ✅ PATCH /v1/documents/:id/fields - Edit extracted fields (users only)
- ✅ PATCH /v1/documents/:id - Update metadata (origin manager only)

### 2. Access Grant Endpoints (3 endpoints)

- ✅ POST /v1/documents/:id/access-grants - Create access grant
- ✅ DELETE /v1/documents/:id/access-grants/:grantId - Revoke access grant
- ✅ GET /v1/documents/:id/access-grants - List grants (origin manager only)

### 3. Revocation Request Endpoints (3 endpoints)

- ✅ POST /v1/documents/:id/revocation-requests - Create revocation request
- ✅ PATCH /v1/revocation-requests/:id - Approve/deny request (origin manager)
- ✅ GET /v1/revocation-requests - List requests

### 4. OCR Processing Endpoints (2 endpoints)

- ✅ POST /v1/documents/:id/ocr/trigger - Trigger OCR (origin manager)
- ✅ POST /v1/documents/:id/ocr/retry - Retry OCR after error (origin manager)

### 5. Manager Endpoints (2 endpoints)

- ✅ GET /v1/managers - List verified managers (directory)
- ✅ GET /v1/managers/:id - Get manager details

### 6. User Manager Assignment Endpoints (3 endpoints)

- ✅ POST /v1/users/:id/manager-assignments - Assign user to manager (admin)
- ✅ DELETE /v1/users/:id/manager-assignments/:id - Remove assignment (admin)
- ✅ GET /v1/users/:id/manager-assignments - List assignments

**Total**: 21 endpoints

## Key Design Principles

1. **RESTful**: Resource-based URLs, standard HTTP methods
2. **AccessGrant-Driven**: All document access via AccessGrant resolution
3. **Origin Manager Authority**: Immutable custodial authority
4. **Admin Exclusion**: Admins hard-denied from document endpoints
5. **Audit Everything**: All mutations and access logged
6. **No PHI Exposure**: No PHI in URLs, query params, or error messages

## Authorization Model

- **JWT Required**: All endpoints require Bearer token
- **Actor Extraction**: Type and ID from JWT payload
- **Guard Enforcement**: Guards reject admins before domain service
- **Domain Validation**: AccessGrant resolution in domain service

## Common Patterns

- **Success**: 200 OK, 201 Created, 202 Accepted, 204 No Content
- **Errors**: 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found
- **Pagination**: Consistent format across all list endpoints
- **Audit**: All mutations and access operations logged synchronously

## Next Steps After Approval

1. **PHASE 4**: Audit & HIPAA Strategy (event taxonomy, log schema, retention)
2. **PHASE 5**: Implementation (incremental, module by module)