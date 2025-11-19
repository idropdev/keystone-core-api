# Keystone Core API Documentation

**HIPAA-Compliant Healthcare Backend for HealthAtlas**

---

## Table of Contents

### Getting Started
- [Introduction](introduction.md)
- [Installing and Running](installing-and-running.md)
- [Architecture](architecture.md)
- [Command Line Interface](cli.md)

### Core Functionality
- [Database](database.md)
- [Auth](auth.md)
- [HIPAA Authentication](hipaa-authentication.md) ⭐ **Security Critical**
- [Document Processing API](document-processing.md) ⭐ **PHI Handling**
- [Serialization](serialization.md)
- [File uploading](file-uploading.md)

### Development & Operations
- [Tests](tests.md)
- [Benchmarking](benchmarking.md)
- [Automatic update of dependencies](automatic-update-dependencies.md)
- [Translations](translations.md)

### Production Deployment
- **[Hosting & Deployment Guide](hosting-deployment.md)** ⭐ **Complete production hosting guide**
- **[Hosting Executive Summary](hosting-executive-summary.md)** ⭐ **For stakeholders**
- **[GCP Authentication Setup](gcp-authentication-setup.md)** - Google Cloud configuration

---

## Hosting & Deployment

Complete guides for deploying Keystone Core API to production:

- **[Hosting & Deployment Guide](hosting-deployment.md)**
  - Comprehensive 60+ page guide covering:
    - Infrastructure options (Cloud Run, GKE, VMs)
    - HIPAA compliance requirements
    - Security implementation
    - Cost analysis
    - Monitoring & observability
    - Disaster recovery
  
- **[Hosting Executive Summary](hosting-executive-summary.md)**
  - Quick 10-page overview for stakeholders:
    - Technology stack
    - Architecture diagrams
    - Security highlights
    - Cost estimates
    - Compliance status
    - Go-live checklist

---

## Document Processing Module

Complete HIPAA-compliant document processing with OCR:

- **[Document Processing API](document-processing.md)** - Complete API reference, setup, and usage guide
- **[Quick Start Guide](document-processing-quick-start.md)** - Get started in 5 minutes
- **[HIPAA Compliance Checklist](document-processing-hipaa-checklist.md)** - Production deployment requirements
- **[Intelligent PDF Processing](intelligent-pdf-processing.md)** - Advanced OCR features

---

## Quick Links by Role

### For DevOps / Platform Engineers
1. [Hosting & Deployment Guide](hosting-deployment.md) - Infrastructure setup
2. [GCP Authentication Setup](gcp-authentication-setup.md) - Cloud configuration
3. [Database](database.md) - Database management

### For Backend Engineers
1. [Architecture](architecture.md) - System design
2. [HIPAA Authentication](hipaa-authentication.md) - Auth implementation
3. [Document Processing API](document-processing.md) - Document features
4. [Tests](tests.md) - Testing strategy

### For Security / Compliance
1. [HIPAA Authentication](hipaa-authentication.md) - Security controls
2. [Hosting Executive Summary](hosting-executive-summary.md) - Compliance status
3. [Document Processing HIPAA Checklist](document-processing-hipaa-checklist.md) - PHI safeguards

### For Product / Management
1. [Hosting Executive Summary](hosting-executive-summary.md) - High-level overview
2. [Introduction](introduction.md) - Project overview
3. Cost estimates in [Hosting Guide](hosting-deployment.md#cost-estimation)
