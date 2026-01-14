# System Architecture and Use Case Flow Diagrams

**Document Version**: 1.0  
**Generated**: December 2025  
**Classification**: Internal - System Architecture Diagrams

---

## System Architecture Overview

This diagram illustrates the high-level architecture of the Document Identity Management Platform, showing how the major components interact and the flow of data between them.

![System Architecture Overview](./System%20Architecture%20Overview.png)

```mermaid
graph TB
    subgraph "Client Layer"
        Mobile[Mobile App<br/>Flutter]
    end

    subgraph "Authentication Layer"
        OAuth[OAuth Providers<br/>Google/Apple]
        Auth[Auth Service<br/>JWT + Sessions]
    end

    subgraph "API Layer"
        Controllers[Controllers<br/>Document/Manager/Auth]
        Guards[JWT Guards<br/>Role Guards<br/>Access Guards]
    end

    subgraph "Domain Layer"
        DocService[Document<br/>Domain Service]
        AccessService[AccessGrant<br/>Domain Service]
        UserService[User Manager<br/>Assignment Service]
        AuditService[Audit Service]
    end

    subgraph "Data Layer"
        DocRepo[Document<br/>Repository]
        AccessRepo[AccessGrant<br/>Repository]
        UserRepo[User<br/>Repository]
        ManagerRepo[Manager<br/>Repository]
        AuditRepo[Audit<br/>Repository]
    end

    subgraph "Storage Layer"
        GCS[Google Cloud Storage<br/>Document Files]
        Postgres[(PostgreSQL<br/>Metadata & Grants)]
        CloudLogs[GCP Cloud Logging<br/>Audit Events]
    end

    subgraph "External Services"
        DocAI[Google Document AI<br/>OCR Processing]
    end

    Mobile -->|OAuth ID Token| OAuth
    OAuth -->|Verify Token| Auth
    Auth -->|Issue JWT| Mobile
    Mobile -->|API Requests<br/>Bearer Token| Controllers
    Controllers -->|Validate| Guards
    Guards -->|Authorized Request| DocService
    Guards -->|Authorized Request| AccessService
    Guards -->|Authorized Request| UserService
    
    DocService -->|Query/Update| DocRepo
    DocService -->|Check Access| AccessService
    DocService -->|Log Events| AuditService
    DocService -->|Trigger OCR| DocAI
    DocService -->|Upload/Download| GCS
    
    AccessService -->|Query/Update| AccessRepo
    AccessService -->|Query| ManagerRepo
    AccessService -->|Query| DocRepo
    AccessService -->|Log Events| AuditService
    
    UserService -->|Query/Update| UserRepo
    UserService -->|Query| ManagerRepo
    UserService -->|Log Events| AuditService
    
    DocRepo -->|Persist| Postgres
    AccessRepo -->|Persist| Postgres
    UserRepo -->|Persist| Postgres
    ManagerRepo -->|Persist| Postgres
    
    AuditService -->|Write Events| AuditRepo
    AuditRepo -->|Persist| Postgres
    AuditService -->|Forward Events| CloudLogs
    DocAI -->|Processed Results| DocService
    DocService -->|Store OCR Output| Postgres
```

**Key Components**:

- **Client Layer**: Mobile application authenticates via OAuth and makes API requests
- **Authentication Layer**: Verifies OAuth tokens and issues JWT access tokens
- **API Layer**: Controllers handle HTTP requests, guards enforce authorization
- **Domain Layer**: Business logic services handle document operations, access control, and audit logging
- **Data Layer**: Repositories abstract database operations
- **Storage Layer**: PostgreSQL stores metadata and grants, GCS stores document files, Cloud Logging stores audit events

---

## Document Upload and Processing Flow

This diagram shows the complete flow when a user uploads a document, including origin manager assignment, access grant creation, and OCR processing.

![Document Upload and Processing Flow](./Document%20Upload%20and%20Processing%20Flow.png)

```mermaid
sequenceDiagram
    participant User as User (Mobile App)
    participant API as API Controller
    participant Auth as Auth Guard
    participant DocService as Document Service
    participant AccessService as AccessGrant Service
    participant ManagerService as Manager Service
    participant GCS as Google Cloud Storage
    participant DocAI as Document AI
    participant Audit as Audit Service
    participant DB as PostgreSQL

    User->>API: POST /v1/documents/upload<br/>(Bearer Token, File, originManagerId)
    API->>Auth: Validate JWT Token
    Auth->>API: Actor Type: User, ID: 123
    API->>DocService: uploadDocument(actor, file, originManagerId)
    
    DocService->>ManagerService: Verify Manager Exists & Verified
    ManagerService->>DB: Query Manager
    DB-->>ManagerService: Manager Entity
    ManagerService-->>DocService: Manager Verified
    
    DocService->>DB: Create Document Entity<br/>(originManagerId, originUserContextId)
    DB-->>DocService: Document Created (UUID)
    
    DocService->>GCS: Upload File<br/>(gs://bucket/origin/{managerId}/{docId})
    GCS-->>DocService: Upload Complete
    DocService->>DB: Update Status: STORED
    
    DocService->>AccessService: Create Default AccessGrant<br/>(User 123, Delegated)
    AccessService->>DB: Create AccessGrant
    DB-->>AccessService: Grant Created
    AccessService-->>DocService: Grant Created
    
    DocService->>Audit: Log DOCUMENT_INTAKE_BY_USER
    DocService->>Audit: Log ORIGIN_MANAGER_ASSIGNED
    DocService->>Audit: Log ACCESS_GRANTED
    Audit->>DB: Store Audit Events
    
    DocService-->>API: Document Entity
    API-->>User: 201 Created (Document Metadata)
    
    Note over User,DB: Origin Manager triggers OCR processing
    
    Manager->>API: POST /v1/documents/{id}/ocr/trigger<br/>(Bearer Token)
    API->>Auth: Validate JWT (Manager Role)
    Auth->>API: Actor Type: Manager, ID: 456
    API->>DocService: triggerOcr(documentId, managerId)
    
    DocService->>DB: Verify originManagerId = 456
    DB-->>DocService: Verified (Origin Manager)
    DocService->>DB: Update Status: PROCESSING
    DocService->>DocAI: Process Document
    DocAI->>DocAI: Extract Text & Fields
    DocAI-->>DocService: OCR Results (JSON)
    DocService->>DB: Update Status: PROCESSED<br/>Store OCR Output
    DocService->>Audit: Log DOCUMENT_PROCESSING_COMPLETED
    Audit->>DB: Store Audit Event
    
    DocService-->>API: 202 Accepted
    API-->>Manager: Processing Started
```

**Flow Summary**:

1. User uploads document with explicit origin manager selection
2. System validates manager is verified
3. Document is created with immutable origin manager assignment
4. File is uploaded to Google Cloud Storage
5. Default access grant is created for uploading user
6. Audit events are logged for all actions
7. Origin manager can later trigger OCR processing
8. OCR results are stored and document status updated

---

## Document Access Flow

This diagram illustrates how document access is resolved when different actors attempt to view a document.

![Document Access Flow](./Document%20Access%20Flow.png)

```mermaid
sequenceDiagram
    participant Actor as Actor (User/Manager/Admin)
    participant API as API Controller
    participant Guard as Authorization Guard
    participant DocService as Document Service
    participant AccessService as AccessGrant Service
    participant DB as PostgreSQL
    participant Audit as Audit Service

    Actor->>API: GET /v1/documents/{id}<br/>(Bearer Token)
    API->>Guard: Validate JWT & Extract Actor
    Guard->>Guard: Check Role
    
    alt Actor Role = Admin
        Guard-->>API: 403 Forbidden<br/>(Hard Deny)
        API-->>Actor: Admin has no document access
    else Actor Role = Manager or User
        Guard-->>API: Authorized (Actor Type, ID)
        API->>DocService: getDocument(documentId, actorType, actorId)
        
        DocService->>DB: Find Document by ID
        DB-->>DocService: Document Entity
        
        alt Actor is Origin Manager
            DocService->>DB: Check originManagerId == actorId
            DB-->>DocService: Match (Implicit Access)
            DocService->>Audit: Log DOCUMENT_VIEWED<br/>(Implicit Access)
        else Actor is NOT Origin Manager
            DocService->>AccessService: hasAccess(documentId, actorType, actorId)
            AccessService->>DB: Query AccessGrants<br/>(documentId, actorType, actorId, active)
            
            alt Active Grant Exists
                DB-->>AccessService: AccessGrant Found
                AccessService-->>DocService: Access Granted (Explicit)
                DocService->>Audit: Log DOCUMENT_VIEWED<br/>(Explicit Grant)
            else No Active Grant
                DB-->>AccessService: No Grant Found
                AccessService-->>DocService: Access Denied
                DocService->>Audit: Log UNAUTHORIZED_ACCESS_ATTEMPT
                DocService-->>API: 404 Not Found
                API-->>Actor: Document not found
            end
        end
        
        Audit->>DB: Store Audit Event
        DocService-->>API: Document Entity
        API-->>Actor: 200 OK (Document Metadata)
    end
```

**Access Resolution Logic**:

1. **Admin Exclusion**: Admins are hard-denied at guard level (no document access)
2. **Origin Manager Check**: If actor is manager, check if they are origin manager (implicit access)
3. **AccessGrant Resolution**: If not origin manager, query for active access grants
4. **Audit Logging**: All access attempts (successful or not) are logged
5. **Security**: No access returns 404 (not 403) to prevent information leakage

---

## Access Grant Creation and Cascade Flow

This diagram shows how access grants are created and how cascade revocation works when grants are revoked.

![Access Grant Creation and Cascade Flow](./Access%20Grant%20Creation%20and%20Cascade%20Flow.png)

```mermaid
graph TB
    subgraph "Initial State"
        Doc[Document<br/>originManagerId: 456]
        OriginMgr[Origin Manager 456]
        UserA[User A]
        Grant1[AccessGrant<br/>Owner<br/>Origin Mgr → User A]
    end

    subgraph "User A Delegates to User B"
        UserB[User B]
        Grant2[AccessGrant<br/>Delegated<br/>User A → User B]
    end

    subgraph "User B Delegates to Manager M"
        ManagerM[Manager M<br/>Secondary Manager]
        Grant3[AccessGrant<br/>Delegated<br/>User B → Manager M]
        Grant4[AccessGrant<br/>Derived<br/>Auto-created<br/>Manager M]
    end

    subgraph "Manager M Delegates to User C"
        UserC[User C]
        Grant5[AccessGrant<br/>Derived<br/>Manager M → User C]
    end

    subgraph "Cascade Revocation"
        Revoke[User A Revokes<br/>User B's Access]
        RevokeGrant2[Grant 2: Revoked]
        RevokeGrant3[Grant 3: Revoked<br/>Cascade]
        RevokeGrant4[Grant 4: Revoked<br/>Cascade]
        RevokeGrant5[Grant 5: Revoked<br/>Cascade]
    end

    Doc -->|Origin Authority| OriginMgr
    OriginMgr -->|Creates Owner Grant| Grant1
    Grant1 -->|Grants Access| UserA
    
    UserA -->|Has Access| Grant1
    UserA -->|Creates Delegated Grant| Grant2
    Grant2 -->|Grants Access| UserB
    
    UserB -->|Has Access| Grant2
    UserB -->|Creates Delegated Grant| Grant3
    Grant3 -->|Grants Access| ManagerM
    Grant3 -->|Auto-creates| Grant4
    Grant4 -->|Derived Access| ManagerM
    
    ManagerM -->|Has Access| Grant4
    ManagerM -->|Creates Derived Grant| Grant5
    Grant5 -->|Grants Access| UserC
    
    Revoke -->|Revokes| RevokeGrant2
    RevokeGrant2 -->|Cascade| RevokeGrant3
    RevokeGrant3 -->|Cascade| RevokeGrant4
    RevokeGrant4 -->|Cascade| RevokeGrant5
    
    style OriginMgr fill:#90EE90
    style Grant1 fill:#FFD700
    style Grant2 fill:#87CEEB
    style Grant3 fill:#87CEEB
    style Grant4 fill:#DDA0DD
    style Grant5 fill:#DDA0DD
    style RevokeGrant2 fill:#FFB6C1
    style RevokeGrant3 fill:#FFB6C1
    style RevokeGrant4 fill:#FFB6C1
    style RevokeGrant5 fill:#FFB6C1
```

**Legend**:

- **Green**: Origin Manager (custodial authority)
- **Gold**: Owner Grant (full access, created by origin manager)
- **Light Blue**: Delegated Grant (created by users with access)
- **Purple**: Derived Grant (auto-created when manager receives delegated grant)
- **Pink**: Revoked Grants (cascade effect)

**Key Concepts**:

- **Owner Grants**: Only origin manager can create these (full access)
- **Delegated Grants**: Users can share access they received
- **Derived Grants**: Automatically created when managers receive delegated grants
- **Cascade Revocation**: Revoking a delegated grant automatically revokes all derived grants

---

## Complete Use Case: User Upload with Manager Review

This diagram shows a complete end-to-end use case where a user uploads a document, the origin manager reviews it, triggers OCR, and grants access to another user.

![Complete Use Case: User Upload with Manager Review](./Complete%20Use%20Case:%20User%20Upload%20with%20Manager%20Review.png)

```mermaid
flowchart TD
    Start([User Wants to Upload Document]) --> Select[User Selects Origin Manager<br/>from Verified Directory]
    Select --> Upload[POST /v1/documents/upload<br/>File + originManagerId]
    Upload --> Validate{Manager<br/>Verified?}
    Validate -->|No| Error1[403 Forbidden<br/>Manager Not Verified]
    Validate -->|Yes| Create[Create Document<br/>originManagerId = Manager ID<br/>originUserContextId = User ID]
    
    Create --> Store[Upload to GCS<br/>Status: STORED]
    Store --> Grant1[Create Default<br/>AccessGrant for User]
    Grant1 --> Log1[Log Audit Events:<br/>DOCUMENT_INTAKE_BY_USER<br/>ORIGIN_MANAGER_ASSIGNED<br/>ACCESS_GRANTED]
    Log1 --> Notify1[Notify Origin Manager<br/>Document Received]
    Notify1 --> Complete1([Document Uploaded])
    
    Complete1 --> ManagerView[Manager Reviews Document]
    ManagerView --> Trigger[Manager Triggers OCR<br/>POST /v1/documents/{id}/ocr/trigger]
    Trigger --> CheckAuth{Is Origin<br/>Manager?}
    CheckAuth -->|No| Error2[403 Forbidden<br/>Not Origin Manager]
    CheckAuth -->|Yes| Process[Status: PROCESSING<br/>Send to Document AI]
    
    Process --> OCR[Document AI<br/>Extracts Text & Fields]
    OCR --> Complete2[Status: PROCESSED<br/>Store OCR Results]
    Complete2 --> Log2[Log Audit Event:<br/>DOCUMENT_PROCESSING_COMPLETED]
    
    Log2 --> ManagerShare[Manager Grants Access<br/>to Another User]
    ManagerShare --> CreateGrant[POST /v1/documents/{id}/access-grants<br/>Create Owner Grant]
    CreateGrant --> Grant2[AccessGrant Created<br/>User Can Now View Document]
    Grant2 --> Log3[Log Audit Event:<br/>ACCESS_GRANTED]
    Log3 --> Notify2[Notify User<br/>Access Granted]
    Notify2 --> End([Use Case Complete])
    
    Error1 --> End
    Error2 --> End
    
    style Start fill:#E6F3FF
    style Complete1 fill:#90EE90
    style Complete2 fill:#90EE90
    style End fill:#90EE90
    style Error1 fill:#FFB6C1
    style Error2 fill:#FFB6C1
```

**Use Case Steps**:

1. User selects verified origin manager from directory
2. Document is uploaded and assigned to manager (immutable)
3. Default access grant is created for uploading user
4. Origin manager is notified of new document
5. Manager reviews and triggers OCR processing
6. OCR extracts structured fields from document
7. Manager can grant access to other users
8. All actions are audited for HIPAA compliance

---

**Document Status**: Complete  
**Note**: These diagrams provide visual representations of the system architecture and key workflows. Refer to the main architecture report for detailed textual descriptions.
