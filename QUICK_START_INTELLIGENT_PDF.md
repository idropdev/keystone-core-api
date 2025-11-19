# Quick Start: Intelligent PDF Processing

## ✅ What's New?

Your document processing system now **automatically detects** whether a PDF contains extractable text or is image-based, and routes it to the **fastest, cheapest** processing method.

---

## 🚀 Quick Test

### 1. Start Your Server

```bash
# Authenticate with GCP (one-time setup)
gcloud auth application-default login

# Start server
npm run start:dev
```

### 2. Upload a Text-Based PDF

```bash
curl -X POST http://localhost:3000/api/v1/documents/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@digital-lab-result.pdf" \
  -F "documentType=LAB_RESULT"
```

**Expected Response:**
```json
{
  "id": "abc-123",
  "status": "PROCESSED",
  "processingMethod": "DIRECT_EXTRACTION",  // ⚡ NEW!
  "confidence": 1.0,
  "processedAt": "2025-11-13T10:00:01Z"
}
```

✅ **Fast** (~500ms)  
✅ **Free** (no OCR cost)  
✅ **100% accurate** (native text)

### 3. Upload a Scanned PDF

```bash
curl -X POST http://localhost:3000/api/v1/documents/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@scanned-document.pdf" \
  -F "documentType=LAB_RESULT"
```

**Expected Response:**
```json
{
  "id": "xyz-789",
  "status": "PROCESSED",
  "processingMethod": "OCR_SYNC",  // 📷 Uses OCR
  "confidence": 0.92,
  "processedAt": "2025-11-13T10:00:05Z"
}
```

⚙️ **Standard** (2-5 seconds)  
💰 **Standard cost** (Document AI pricing)  
📊 **85-95% confidence** (OCR dependent)

---

## 📊 Processing Methods Explained

| Method | When Used | Speed | Cost | Confidence |
|--------|-----------|-------|------|------------|
| `DIRECT_EXTRACTION` | Text-based PDFs | ⚡ 100-500ms | 💚 FREE | ✅ 100% |
| `OCR_SYNC` | Small scanned docs (≤15 pages) | ⚙️  2-5s | 💸 $$ | 📊 85-95% |
| `OCR_BATCH` | Large scanned docs (>15 pages) | 🐢 10-30s | 💸 $$ | 📊 85-95% |
| `NONE` | Not yet processed | - | - | - |

---

## 🔍 Check Logs

When a document is uploaded, look for these log messages:

```bash
# Text-based PDF (fast path)
[DocumentProcessingDomainService] Analyzing PDF 123... for text content...
[DocumentProcessingDomainService] Document 123 is text-based PDF - using direct extraction (fast path)
[DocumentProcessingDomainService] Processing complete for document 123

# Image-based PDF (standard path)
[DocumentProcessingDomainService] Analyzing PDF 456... for text content...
[DocumentProcessingDomainService] Document 456 is image-based PDF - using OCR
[GcpDocumentAiAdapter] Using synchronous processing for gs://...
```

---

## 💡 How It Works

```
📄 PDF Upload
    ↓
🔍 Analyze PDF
    ↓
    ├─→ Text-based? → ⚡ Direct Extraction (FAST & FREE)
    │
    └─→ Image-based? → 📷 OCR Processing (Standard)
```

**Detection Logic:**
- **Text-based**: >100 characters, >50 chars/page
- **Image-based**: ≤100 characters, <50 chars/page

---

## 📈 Expected Results

If 60% of your PDFs are text-based:

- **Speed**: 50% faster average processing
- **Cost**: 60% reduction in OCR API calls
- **Savings**: ~$90/month (at 1000 docs/month)

---

## 🛡️ Safety Features

✅ **Automatic Fallback**: If analysis fails → uses OCR (safe default)  
✅ **No Breaking Changes**: Existing functionality unchanged  
✅ **Backward Compatible**: Old documents unaffected  
✅ **HIPAA Compliant**: No additional PHI exposure  

---

## 🐛 Troubleshooting

### All PDFs Using OCR (No Direct Extraction)

**Check logs for:**
```bash
grep "Analyzing PDF" logs/app.log
grep "text-based PDF" logs/app.log
grep "image-based PDF" logs/app.log
```

**Possible causes:**
1. PDFs are actually scanned documents
2. PDF analysis is failing (check error logs)
3. GCP authentication issues

### Direct Extraction Producing Gibberish

**Solution:** The PDF might use unusual encoding. OCR will be used automatically on retry.

### No `processingMethod` in Response

**Check:**
1. Migration applied? `npm run migration:run`
2. Server restarted after migration?
3. Using latest API response?

---

## 📚 Full Documentation

- **Feature Details**: `docs/intelligent-pdf-processing.md`
- **GCP Setup**: `docs/gcp-authentication-setup.md`
- **Implementation Summary**: `INTELLIGENT_PDF_PROCESSING_IMPLEMENTATION_SUMMARY.md`

---

## 🎯 Next Steps

1. ✅ Upload test PDFs
2. ✅ Verify `processingMethod` in responses
3. ✅ Check processing times
4. ✅ Monitor cost savings
5. ✅ Deploy to staging/production

---

**Questions?** Check the full documentation or ask for help!

---

**Feature Version:** 1.0.0  
**Last Updated:** November 13, 2025

