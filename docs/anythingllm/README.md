# AnythingLLM Integration Documentation

**Project:** Keystone Core API → AnythingLLM Integration  
**Last Updated:** 2025-01-27  
**Status:** Active Implementation

---

## Overview

Keystone Core API integrates with AnythingLLM as a **service-to-service proxy** that provides:

1. **Service Identity Authentication** - GCP OIDC tokens for secure service-to-service communication
2. **Delegated Token Authentication** - User-scoped tokens with embedded actor claims (RFC 8693)
3. **Policy-Based Authorization** - Centralized access control before forwarding requests
4. **Admin Proxy Endpoints** - Typed, HIPAA-compliant proxy for AnythingLLM admin operations

**Key Principle:** Keystone Core API acts as a **secure gateway** between end-users and AnythingLLM, handling authentication, authorization, and audit logging while maintaining HIPAA compliance.

---

## Quick Links by Role

### For Developers

- **[Architecture Overview](architecture.md)** - Complete system architecture and components
- **[API Reference](development/api-reference.md)** - Developer API documentation
- **[Admin Proxy](development/admin-proxy.md)** - Admin endpoint implementation
- **[Endpoint Onboarding](development/endpoint-onboarding.md)** - Adding new endpoints

### For DevOps / Platform Engineers

- **[Authentication Setup](authentication/setup.md)** - Complete setup guide for S2S token delegation
- **[Service Identity](authentication/service-identity.md)** - Service identity implementation details
- **[Delegated Tokens](authentication/delegated-tokens.md)** - Delegated token authentication guide
- **[VM Setup](deployment/vm-setup.md)** - Production VM deployment guide

### For Security / Compliance

- **[Delegated Tokens](authentication/delegated-tokens.md)** - Token structure and validation (RFC 8693)
- **[Service Identity](authentication/service-identity.md)** - GCP OIDC token implementation
- **[Architecture](architecture.md)** - Security architecture and HIPAA compliance

### For Testing / QA

- **[Testing Guide](testing/testing-guide.md)** - Complete testing documentation
- **[Debugging](testing/debugging.md)** - Troubleshooting guide

---

## Architecture Overview

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Client    │────────▶│ Keystone Core API │────────▶│ AnythingLLM  │
│  (Mobile)   │  JWT    │   (Gateway)       │  Token  │   (Service)  │
└─────────────┘         └──────────────────┘         └──────────────┘
                              │
                              │
                    ┌─────────┴─────────┐
                    │                   │
              ┌─────▼─────┐      ┌──────▼──────┐
              │  Policy  │      │  Token     │
              │  Check   │      │  Issuance  │
              └──────────┘      └────────────┘
```

### Integration Patterns

1. **Service Identity** (Admin/System Operations)
   - Uses GCP service account OIDC tokens
   - For system-level operations (admin endpoints, provisioning)
   - No user context required

2. **Delegated Tokens** (User-Scoped Operations)
   - Uses RFC 8693 actor claims (`act` claim)
   - Embeds user context in token
   - For user-scoped operations (workspaces, threads, documents)

---

## Core Components

### Implemented Modules

✅ **Service Identity** (`src/anythingllm/services/`)
- `AnythingLLMServiceIdentityService` - GCP OIDC token minting
- `AnythingLLMClientService` - HTTP client with token injection
- `AnythingLLMHealthService` - Health check endpoint

✅ **Auth Delegation** (`src/anythingllm-auth-delegation/`)
- `AnythingLLMAuthDelegationService` - Delegated token issuance
- RFC 8693 actor claims implementation

✅ **Policy Engine** (`src/anythingllm-policy/`)
- `AnythingLLMPolicyService` - Authorization evaluation
- Role-based access control

✅ **Orchestrator** (`src/anythingllm-orchestrator/`)
- `AnythingLLMOrchestratorService` - Composes policy → token → client call

✅ **Admin Proxy** (`src/anythingllm/admin/`)
- `AnythingLLMAdminController` - Typed admin endpoints
- `AnythingLLMAdminService` - Admin operations
- `ServiceIdentityGuard` - Service identity validation

✅ **Adapter Layer** (`src/anythingllm/adapter/`)
- `AnythingLLMAdapterService` - High-level adapter interface
- Workspace, document, thread management

✅ **Registry Pattern** (`src/anythingllm/registry/`)
- `AnythingLLMRegistryClient` - Typed endpoint registry
- Endpoint definitions and schemas

---

## Documentation Structure

```
docs/anythingllm/
├── README.md (this file)
├── architecture.md
├── authentication/
│   ├── service-identity.md
│   ├── delegated-tokens.md
│   └── setup.md
├── deployment/
│   └── vm-setup.md
├── development/
│   ├── api-reference.md
│   ├── admin-proxy.md
│   └── endpoint-onboarding.md
└── testing/
    ├── testing-guide.md
    └── debugging.md
```

---

## Getting Started

1. **Read Architecture**: Start with [Architecture Overview](architecture.md)
2. **Setup Authentication**: Follow [Authentication Setup Guide](authentication/setup.md)
3. **Review API**: Check [API Reference](development/api-reference.md)
4. **Run Tests**: See [Testing Guide](testing/testing-guide.md)

---

## Standards Compliance

- ✅ **RFC 8693** (OAuth 2.0 Token Exchange) - Actor claims in delegated tokens
- ✅ **RFC 7662** (OAuth 2.0 Token Introspection) - Token introspection endpoint
- ✅ **RFC 7519** (JWT) - Standard JWT structure
- ✅ **HIPAA Compliance** - No PHI in tokens, audit logging, encryption in transit

---

## Related Documentation

- [Main Documentation Index](../readme.md)
- [HIPAA Authentication](../hipaa-authentication.md)
- [GCP Authentication Setup](../gcp-authentication-setup.md)
- [Document Processing](../document-processing.md)

---

**Last Updated:** 2025-01-27




