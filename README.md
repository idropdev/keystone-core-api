# 🚀 Keystone Core API – HealthAtlas

> `keystone-core-api` is the central API gateway and application backend for **HealthAtlas**, a secure personal health record platform. Built with NestJS and forked from the [Brocoders REST API boilerplate](https://github.com/brocoders/nestjs-boilerplate), this service acts as the entrypoint and controller for structured data, authentication, document ingestion, and patient experience APIs.

![CI](https://github.com/brocoders/nestjs-boilerplate/actions/workflows/docker-e2e.yml/badge.svg)
[![Renovate](https://img.shields.io/badge/renovate-enabled-%231A1F6C?logo=renovatebot)](https://app.renovatebot.com/dashboard)

---

## 📦 What is Keystone Core API?

Keystone Core API is the **heart of the HealthAtlas backend**. It’s responsible for:

### ✅ Primary Responsibilities

* 🌐 **API Gateway / BFF**
  Handles all external requests from the Flutter app, enforces JWT/MFA, applies rate-limiting, logs audits, and routes data securely.

* 🔐 **Authentication Service**
  Email-based sign-up and login, with support for MFA (TOTP or SMS), session handling, role-based access control, and token issuance.

* 🧾 **User Data Service**
  CRUD endpoints for managing structured health data like:

    * Medications
    * Conditions
    * Providers
    * Insurance details
    * Pharmacies

* 📂 **Document Management**

    * Secure upload via signed GCS URLs
    * Stores metadata in Firestore or Mongo
    * Emits ingestion events to trigger OCR pipelines

* 📄 **Data Exports & Summaries**

    * Prepares “At-a-Glance” summaries
    * Bundles user records for export and download

* 🛡️ **Security & Privacy**

    * Rate limiting
    * Request/response DTO validation
    * Logging for HIPAA-aligned observability

---

## 🧠 Technologies

* **NestJS** – Modular and type-safe Node.js framework
* **TypeORM & PostgreSQL** – For structured health records
* **Firestore (or Mongo)** – For unstructured document metadata and extracted text
* **Cloud Storage (GCS)** – For file uploads
* **Redis (Memorystore)** – For caching AAGs and throttling
* **Swagger / OpenAPI** – For auto-generated docs
* **Docker** – For deployment consistency
* **GitHub Actions** – CI/CD workflows

---

## 🏗️ Architecture

Keystone Core API is designed to work alongside:

* `keystone-doc-intel` (OCR & entity extraction)
* `keystone-anythingllm-service` (RAG hybrid retrieval and LLM Q\&A)
* Flutter frontend client
* Optional `keystone-notify` microservice

Each service can scale independently, while Core ensures consistent authentication, session management, and user data ownership.

---

## 📁 Key Modules

* `auth/` – Local and social login, MFA, password flows
* `users/` – User profile management
* `healthdata/` – Medications, conditions, etc.
* `documents/` – Uploads, metadata, ingestion triggers
* `exports/` – PDF/bundle generation for user downloads
* `common/` – Guards, interceptors, middleware, DTOs

---

## 📌 Status

✅ MVP development started
🧪 MFA support planned (TOTP or phone)
📤 Integrates with Cloud Storage (GCS)
📨 Pub/Sub publishing to OCR pipeline
📋 Swagger live docs available after launch

---

## 🛠️ Setup

### Quick Start

```bash
git clone https://github.com/YOUR_TEAM/keystone-core-api
cd keystone-core-api
cp .env.sample .env
npm install
npm run start:dev
```

### GCP Credentials Setup (Required for Document Processing)

The document download endpoint requires GCP service account credentials for generating signed URLs. Follow these steps:

#### Option 1: Automated Setup Script

```bash
# Run the setup script (creates service account, grants permissions, generates key)
./SETUP_SERVICE_ACCOUNT.sh

# Add to your .env file (the script will show you the exact path)
GOOGLE_APPLICATION_CREDENTIALS=.secrets/keystone-sa-key.json
```

#### Option 2: Manual Setup

1. **Create Service Account:**
   ```bash
   gcloud iam service-accounts create keystone-doc-processing \
     --display-name="Keystone Document Processing" \
     --project=YOUR_PROJECT_ID
   ```

2. **Grant Permissions:**
   ```bash
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:keystone-doc-processing@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/storage.objectAdmin"
   ```

3. **Create Key File:**
   ```bash
   gcloud iam service-accounts keys create .secrets/keystone-sa-key.json \
     --iam-account=keystone-doc-processing@YOUR_PROJECT_ID.iam.gserviceaccount.com
   ```

4. **Add to .env:**
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=.secrets/keystone-sa-key.json
   ```

5. **Restart Application**

**Security Note:** The `.secrets/` directory is excluded from git via `.gitignore`. Never commit service account keys to version control.

For more details, see:
- [`docs/gcp-authentication-setup.md`](/docs/gcp-authentication-setup.md) - Complete GCP authentication guide
- [`VERIFY_GCP_CREDENTIALS.md`](/VERIFY_GCP_CREDENTIALS.md) - Troubleshooting guide

Docker + CI setup also available.

---

## 📚 Full Documentation

Refer to [`/docs/readme.md`](/docs/readme.md) for complete documentation.

### 🚀 Hosting Guides

- **[MVP Hosting Guide](/docs/mvp-hosting-guide.md)** ⭐ - Quick start guide for MVP deployment ($0-15/month)
- **[Production Hosting Guide](/docs/hosting-deployment.md)** - Complete 60+ page guide for production deployment
- **[Hosting Executive Summary](/docs/hosting-executive-summary.md)** - Quick overview for stakeholders
- **[HIPAA Authentication](/docs/hipaa-authentication.md)** - Security controls and compliance
- **[Document Processing](/docs/document-processing.md)** - PHI handling and OCR

---

## 👥 Contributors

This project is developed by the HealthAtlas Core Team:

* Joel Martínez – Fullstack + Security
* Joel Martínez – OCR & Document NLP
* \[Name] – AI Assistant Integration + Flutter

---
