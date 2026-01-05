# AnythingLLM Developer API Documentation

**Version:** 1.0.0  
**OpenAPI Specification:** OAS 3.0  
**Base URL:** `/api`

API endpoints that enable programmatic reading, writing, and updating of your AnythingLLM instance. UI supplied by Swagger.io.

> **Note:** This documentation focuses on **Admin endpoints** which are implemented in Keystone Core API. Other endpoints are documented for reference but are not currently proxied through Keystone.

---

## Table of Contents

- [Admin Endpoints (Implemented)](#admin-endpoints-implemented)
- [Authentication](#authentication)
- [Reference: Other Endpoints](#reference-other-endpoints)
  - [Documents](#documents)
  - [Workspaces & Threads](#workspaces--threads)
  - [User Management](#user-management)
  - [OpenAI Compatible Endpoints](#openai-compatible-endpoints)
- [Schemas](#schemas)

---

## Admin Endpoints (Implemented)

> **Status:** ✅ **Implemented in Keystone Core API**  
> **Authentication:** Service Identity (GCP OIDC ID token)  
> **Base Path:** `/api/anythingllm/v1/admin`

These endpoints are **fully implemented** in Keystone Core API as a secure proxy to AnythingLLM. All requests require **service identity authentication** (GCP service account OIDC tokens).

For implementation details, see [AnythingLLM Integration Architecture](./anythingllm-integration-architecture.md).

---

### GET /api/anythingllm/v1/admin/is-multi-user-mode

Check if the AnythingLLM instance is in multi-user mode.

**Authentication:** Service Identity (GCP OIDC ID token)

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Multi-user mode status | `application/json` |
| 401 | Unauthorized (invalid service identity) | `application/json` |
| 403 | Forbidden (user JWT token rejected) | `application/json` |

**200 Response Example:**
```json
{
  "multiUserMode": true
}
```

---

### GET /api/anythingllm/v1/admin/users

List all users in AnythingLLM.

**Authentication:** Service Identity (GCP OIDC ID token)

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | List of users | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

**200 Response Example:**
```json
{
  "users": [
    {
      "id": 1,
      "username": "admin",
      "role": "admin",
      "suspended": 0
    }
  ]
}
```

---

### POST /api/anythingllm/v1/admin/users/new

Create a new user in AnythingLLM.

**Authentication:** Service Identity (GCP OIDC ID token)

**Request Body:**
```json
{
  "username": "newuser",
  "password": "secure-password",
  "role": "default"
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Created user | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### POST /api/anythingllm/v1/admin/users/:id

Update an existing user by ID.

**Authentication:** Service Identity (GCP OIDC ID token)

**Parameters:**
- `id` (path, required): User ID

**Request Body:**
```json
{
  "username": "updated-username",
  "role": "admin"
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Update result | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### DELETE /api/anythingllm/v1/admin/users/:id

Delete a user by ID.

**Authentication:** Service Identity (GCP OIDC ID token)

**Parameters:**
- `id` (path, required): User ID

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Delete result | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### GET /api/anythingllm/v1/admin/invites

List all invitations.

**Authentication:** Service Identity (GCP OIDC ID token)

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | List of invitations | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### POST /api/anythingllm/v1/admin/invite/new

Create a new invitation.

**Authentication:** Service Identity (GCP OIDC ID token)

**Request Body:**
```json
{
  "email": "user@example.com",
  "role": "default"
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Created invitation | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### DELETE /api/anythingllm/v1/admin/invite/:id

Revoke an invitation by ID.

**Authentication:** Service Identity (GCP OIDC ID token)

**Parameters:**
- `id` (path, required): Invite ID

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Revoke result | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### GET /api/anythingllm/v1/admin/workspaces/:workspaceId/users

Get users with access to a workspace.

**Authentication:** Service Identity (GCP OIDC ID token)

**Parameters:**
- `workspaceId` (path, required): Workspace ID

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Workspace users | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### POST /api/anythingllm/v1/admin/workspaces/:workspaceSlug/manage-users

Manage users in a workspace by slug.

**Authentication:** Service Identity (GCP OIDC ID token)

**Parameters:**
- `workspaceSlug` (path, required): Workspace slug

**Request Body:**
```json
{
  "userIds": [1, 2, 3],
  "action": "add" | "remove"
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Manage users result | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### POST /api/anythingllm/v1/admin/workspace-chats

Get workspace chats with pagination.

**Authentication:** Service Identity (GCP OIDC ID token)

**Request Body:**
```json
{
  "offset": 0,
  "limit": 50
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Workspace chats | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

### POST /api/anythingllm/v1/admin/preferences

Update system preferences.

**Authentication:** Service Identity (GCP OIDC ID token)

**Request Body:**
```json
{
  "preferenceKey": "value"
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Preferences update result | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

## Authentication

### GET /v1/auth

Verify the attached Authentication header contains a valid API token.

> **Note:** This endpoint is part of AnythingLLM's native API and is not currently proxied through Keystone Core API.

**Parameters:** None

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | Valid auth token was found | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

**200 Response Example:**
```json
{
  "authenticated": true
}
```

**401/403 Response Example:**
```json
{
  "message": "Invalid API Key"
}
```

---

## Reference: Other Endpoints

> **Note:** The following endpoints are documented for reference but are **not currently implemented** in Keystone Core API. They are part of AnythingLLM's native API.

### Documents

### GET /v1/admin/is-multi-user-mode

Check if the instance is in multi-user mode.

### GET /v1/admin/users

Get all users.

### POST /v1/admin/users/new

Create a new user.

### POST /v1/admin/users/{id}

Update a user by ID.

**Parameters:**
- `id` (path, required): User ID

### DELETE /v1/admin/users/{id}

Delete a user by ID.

**Parameters:**
- `id` (path, required): User ID

### GET /v1/admin/invites

Get all invites.

### POST /v1/admin/invite/new

Create a new invite.

### DELETE /v1/admin/invite/{id}

Delete an invite by ID.

**Parameters:**
- `id` (path, required): Invite ID

### GET /v1/admin/workspaces/{workspaceId}/users

Get users for a workspace.

**Parameters:**
- `workspaceId` (path, required): Workspace ID

### POST /v1/admin/workspaces/{workspaceId}/update-users

Update users for a workspace.

**Parameters:**
- `workspaceId` (path, required): Workspace ID

### POST /v1/admin/workspaces/{workspaceSlug}/manage-users

Manage users for a workspace by slug.

**Parameters:**
- `workspaceSlug` (path, required): Workspace slug

---

### Documents

> **Status:** ⚠️ Not implemented in Keystone Core API (reference only)

#### POST /v1/document/upload

Upload a new file to AnythingLLM to be parsed and prepared for embedding.

**Parameters:** None

**Request Body:** Multipart form data with file

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |
| 500 | Internal Server Error | `application/json` |

**200 Response Example:**
```json
{
  "success": true,
  "error": null,
  "documents": [
    {
      "location": "custom-documents/anythingllm.txt-6e8be64c-c162-4b43-9997-b068c0071e8b.json",
      "name": "anythingllm.txt-6e8be64c-c162-4b43-9997-b068c0071e8b.json",
      "url": "file://Users/tim/Documents/anything-llm/collector/hotdir/anythingllm.txt",
      "title": "anythingllm.txt",
      "docAuthor": "Unknown",
      "description": "Unknown",
      "docSource": "a text file uploaded by the user.",
      "chunkSource": "anythingllm.txt",
      "published": "1/16/2024, 3:07:00 PM",
      "wordCount": 93,
      "token_count_estimate": 115
    }
  ]
}
```

**500 Response Example:**
```json
{
  "success": false,
  "error": "Document processing API is not online. Document will not be processed automatically."
}
```

---

#### POST /v1/document/upload/{folderName}

Upload a new file to a specific folder in AnythingLLM to be parsed and prepared for embedding. If the folder does not exist, it will be created.

**Parameters:**
- `folderName` (path, required): Target folder path (defaults to 'custom-documents' if not provided)
  - Example: `my-folder`

**Request Body:** Multipart form data with file

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |
| 500 | Internal Server Error | `application/json` |

**200 Response Example:**
```json
{
  "success": true,
  "error": null,
  "documents": [
    {
      "location": "custom-documents/anythingllm.txt-6e8be64c-c162-4b43-9997-b068c0071e8b.json",
      "name": "anythingllm.txt-6e8be64c-c162-4b43-9997-b068c0071e8b.json",
      "url": "file://Users/tim/Documents/anything-llm/collector/hotdir/anythingllm.txt",
      "title": "anythingllm.txt",
      "docAuthor": "Unknown",
      "description": "Unknown",
      "docSource": "a text file uploaded by the user.",
      "chunkSource": "anythingllm.txt",
      "published": "1/16/2024, 3:07:00 PM",
      "wordCount": 93,
      "token_count_estimate": 115
    }
  ]
}
```

---

#### POST /v1/document/upload-link

Upload a valid URL for AnythingLLM to scrape and prepare for embedding. Optionally, specify a comma-separated list of workspace slugs to embed the document into post-upload.

**Parameters:** None

**Request Body:** `application/json`

**Request Body Schema:**
```json
{
  "link": "https://anythingllm.com",
  "addToWorkspaces": "workspace1, workspace2",
  "scraperHeaders": {
    "Authorization": "Bearer token123",
    "My-Custom-Header": "value"
  }
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |
| 500 | Internal Server Error | `application/json` |

**200 Response Example:**
```json
{
  "success": true,
  "error": null,
  "documents": [
    {
      "id": "c530dbe6-bff1-4b9e-b87f-710d539d20bc",
      "url": "file://useanything_com.html",
      "title": "useanything_com.html",
      "docAuthor": "no author found",
      "description": "No description found.",
      "docSource": "URL link uploaded by the user.",
      "chunkSource": "https://anythingllm.com"
    }
  ]
}
```

---

### Workspaces & Threads

> **Status:** ⚠️ Not implemented in Keystone Core API (reference only)

#### GET /v1/workspace/{slug}/thread/{threadSlug}/chats

Get chats for a workspace thread.

**Parameters:**
- `slug` (path, required): Unique slug of workspace
- `threadSlug` (path, required): Unique slug of thread

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 400 | Bad Request | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |
| 500 | Internal Server Error | `application/json` |

**200 Response Example:**
```json
{
  "history": [
    {
      "role": "user",
      "content": "What is AnythingLLM?",
      "sentAt": 1692851630
    },
    {
      "role": "assistant",
      "content": "AnythingLLM is a platform that allows you to convert notes, PDFs, and other source materials into a chatbot. It ensures privacy, cites its answers, and allows multiple people to interact with the same documents simultaneously. It is particularly useful for businesses to enhance the visibility and readability of various written communications such as SOPs, contracts, and sales calls. You can try it out with a free trial to see if it meets your business needs.",
      "sources": [
        {
          "source": "object about source document and snippets used"
        }
      ]
    }
  ]
}
```

---

#### POST /v1/workspace/{slug}/thread/{threadSlug}/chat

Chat with a workspace thread.

**Parameters:**
- `slug` (path, required): Unique slug of workspace
- `threadSlug` (path, required): Unique slug of thread

**Request Body:** `application/json`

**Request Body Schema:**
```json
{
  "message": "What is AnythingLLM?",
  "mode": "query | chat",
  "userId": 1,
  "attachments": [
    {
      "name": "image.png",
      "mime": "image/png",
      "contentString": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ],
  "reset": false
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 400 | Bad Request | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |
| 500 | Internal Server Error | `application/json` |

**200 Response Example:**
```json
{
  "id": "chat-uuid",
  "type": "abort | textResponse",
  "textResponse": "Response to your query",
  "sources": [
    {
      "title": "anythingllm.txt",
      "chunk": "This is a context chunk used in the answer of the prompt by the LLM."
    }
  ],
  "close": true,
  "error": "null | text string of the failure mode."
}
```

---

#### POST /v1/workspace/{slug}/thread/{threadSlug}/stream-chat

Stream chat with a workspace thread.

**Parameters:**
- `slug` (path, required): Unique slug of workspace
- `threadSlug` (path, required): Unique slug of thread

**Request Body:** `application/json`

**Request Body Schema:**
```json
{
  "message": "What is AnythingLLM?",
  "mode": "query | chat",
  "userId": 1,
  "attachments": [
    {
      "name": "image.png",
      "mime": "image/png",
      "contentString": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ],
  "reset": false
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `text/event-stream` |
| 400 | Bad Request | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

**200 Response Example (Stream):**
```json
[
  {
    "id": "uuid-123",
    "type": "abort | textResponseChunk",
    "textResponse": "First chunk",
    "sources": [],
    "close": false,
    "error": "null | text string of the failure mode."
  },
  {
    "id": "uuid-123",
    "type": "abort | textResponseChunk",
    "textResponse": "chunk two",
    "sources": [],
    "close": false,
    "error": "null | text string of the failure mode."
  },
  {
    "id": "uuid-123",
    "type": "abort | textResponseChunk",
    "textResponse": "final chunk of LLM output!",
    "sources": [
      {
        "title": "anythingllm.txt",
        "chunk": "Context chunk used in answer"
      }
    ],
    "close": true,
    "error": "null | text string of the failure mode."
  }
]
```

---

### User Management

> **Status:** ⚠️ Not implemented in Keystone Core API (reference only)

#### GET /v1/users

Get all users.

#### GET /v1/users/{id}/issue-auth-token

Issue an authentication token for a user.

**Parameters:**
- `id` (path, required): User ID

---

### OpenAI Compatible Endpoints

> **Status:** ⚠️ Not implemented in Keystone Core API (reference only)

#### GET /v1/openai/models

Get available models (OpenAI compatible).

#### POST /v1/openai/chat/completions

Create a chat completion (OpenAI compatible).

**Request Body:** `application/json`

**Request Body Schema (OpenAI Compatible):**
```json
{
  "model": "string",
  "messages": [
    {
      "role": "user | assistant | system",
      "content": "string"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

#### POST /v1/openai/embeddings

Create embeddings (OpenAI compatible).

**Request Body:** `application/json`

**Request Body Schema (OpenAI Compatible):**
```json
{
  "model": "text-embedding-ada-002",
  "input": "The text to embed"
}
```

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

#### GET /v1/openai/vector_stores

Get vector stores (OpenAI compatible).

**Responses:**

| Code | Description | Media Type |
|------|-------------|------------|
| 200 | OK | `application/json` |
| 401 | Unauthorized | `application/json` |
| 403 | Forbidden | `application/json` |

---

## Schemas

### InvalidAPIKey

**Schema:**
```json
{
  "message": "Invalid API Key"
}
```

**Used in:**
- 401 Unauthorized responses
- 403 Forbidden responses

---

## Authentication

### Admin Endpoints (Keystone Core API)

Admin endpoints require **Service Identity authentication** using GCP OIDC ID tokens:

```
Authorization: Bearer <gcp-oidc-id-token>
```

**Authentication Flow:**
1. Keystone Core API mints OIDC ID token using GCP service account
2. Token is automatically injected into requests to AnythingLLM
3. AnythingLLM validates the OIDC token signature and audience

**Error Responses:**
- `401 Unauthorized`: Invalid or expired service identity token
- `403 Forbidden`: User JWT token rejected (service identity required)

### Other Endpoints (AnythingLLM Native API)

Other endpoints require an API token in the Authorization header:

```
Authorization: Bearer <your-api-token>
```

**Authentication Flow:**
1. Obtain an API token from your AnythingLLM instance
2. Include the token in the `Authorization` header as `Bearer <token>`
3. Use the `/v1/auth` endpoint to verify token validity

**Error Responses:**
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: Token is valid but lacks required permissions

---

## Common Response Patterns

### Success Response
Most successful operations return:
```json
{
  "success": true,
  "error": null,
  "data": { ... }
}
```

### Error Response
Error responses typically include:
```json
{
  "success": false,
  "error": "Error message description",
  "message": "Human-readable error message"
}
```

### Pagination
Endpoints that return lists may support pagination (check individual endpoint documentation).

---

## Rate Limiting

Rate limiting may be applied to prevent abuse. Check response headers for rate limit information:
- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when the rate limit resets

---

## Versioning

This API is versioned under `/v1/`. Future versions will use `/v2/`, `/v3/`, etc.

---

## Base URL

All endpoints are prefixed with `/api`:
- Development: `http://localhost:3001/api`
- Production: `https://your-instance.com/api`

---

## Notes

- All timestamps are in Unix epoch format (seconds since January 1, 1970)
- File uploads use multipart/form-data encoding
- Streaming endpoints use Server-Sent Events (SSE) with `text/event-stream` content type
- OpenAI compatible endpoints follow the OpenAI API specification for interoperability

---

## Support

For API documentation and interactive testing, visit the Swagger UI at:
- `/api/docs` (when running locally)
- `https://your-instance.com/api/docs` (in production)


