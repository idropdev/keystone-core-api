# PDF Processing Flow - Visual Reference

## 🔄 Complete Flow Diagram (Multi-Tier Fallback)

```
┌─────────────────────────────────────────────────────────────────┐
│                     1. CLIENT UPLOADS PDF                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              2. DocumentProcessingController                     │
│                    POST /v1/documents/upload                     │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│             3. DocumentProcessingService                         │
│                  (Application Layer)                             │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│         4. DocumentProcessingDomainService                       │
│              uploadDocument(buffer, fileName, ...)               │
│                                                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  4a. Create Document Entity (status: UPLOADED)          │   │
│   │  4b. Save to Database (get UUID)                        │   │
│   │  4c. Upload to GCS (status: STORED)                     │   │
│   │  4d. Trigger Async Processing → startProcessing()       │   │
│   └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│         5. ASYNC: startProcessing(docId, gcsUri, buffer)         │
│              (status: PROCESSING)                                │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Is PDF && has buffer? │
                    └───────┬───────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │ YES                                │ NO
          ▼                                    ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│  6. TIER 1: pdf2json    │         │  9. Use Standard OCR    │
│                         │         │                         │
│  Pdf2JsonService        │         │  GcpDocumentAiAdapter   │
│  .parseBuffer(buffer)   │         │  .processDocument()     │
└──────────┬──────────────┘         └─────────────────────────┘
           │
           ▼
    ┌──────────────┐
    │  Success?    │
    └──────┬───────┘
           │
  ┌────────┴────────┐
  │ YES             │ NO (Error)
  ▼                 ▼
┌─────────────────────────┐         ┌──────────────────────────┐
│  7a. Success Path       │         │  7b. Check Error Type    │
│                         │         └──────────┬───────────────┘
│  Extract chunks:        │                    │
│  - page_1, page_2, ...  │         ┌──────────┴──────────┐
│  - field_1_name, ...    │         │                     │
│                         │    XRef Error           Other Error
│  Combine → fullText     │         │                     │
│  Extract entities       │         ▼                     ▼
│                         │  ┌──────────────────┐  ┌──────────────┐
│  processingMethod:      │  │  TIER 2:         │  │  TIER 3:     │
│  DIRECT_EXTRACTION      │  │  pdf-parse       │  │  OCR         │
└─────────────────────────┘  │  (XRef resilient)│  │  (Direct)    │
                             └────────┬─────────┘  └──────────────┘
                                      │
                          ┌───────────┴───────────┐
                          │                       │
                       SUCCESS                 FAILURE
                          │                       │
                          ▼                       ▼
                   ┌──────────────┐      ┌──────────────┐
                   │ Return Text  │      │  TIER 3:     │
                   │              │      │  OCR         │
                   │ method:      │      │  (Final)     │
                   │ pdf_parse_   │      └──────────────┘
                   │ extraction   │
                   └──────────────┘
                          │
           ┌──────────────┴────────────────┬─────────────────┐
           │                               │                 │
           ▼                               ▼                 ▼
┌────────────────────────┐    ┌────────────────────────┐    │
│  8. Extract Entities   │    │  8. Extract Entities   │    │
│     from Text          │    │     from Text          │    │
└────────────┬───────────┘    └────────────┬───────────┘    │
             │                              │                 │
             └──────────────┬───────────────┘                 │
                            ▼                                 │
                  ┌────────────────────────┐                 │
                  │  10. Store Results     │◀────────────────┘
                  │                        │
                  │  - Upload processed    │
                  │    JSON to GCS         │
                  │                        │
                  │  - Extract & save      │
                  │    fields to DB        │
                  │                        │
                  │  - Update document:    │
                  │    status: PROCESSED   │
                  │    processingMethod    │
                  │    confidence          │
                  │    extractedText       │
                  │    ocrJsonOutput       │
                  │                        │
                  │  - Audit log           │
                  └────────────────────────┘
```

## 🎯 Decision Points

### Point 1: PDF Check
```
if (mimeType === 'application/pdf' && fileBuffer) {
  → Try pdf2json
} else {
  → Use OCR
}
```

### Point 2: pdf2json Success
```
try {
  const { chunks, meta } = await pdf2JsonService.parseBuffer(buffer);
  
  if (fullText.length >= 50) {
    → SUCCESS: Use direct extraction
  } else {
    → FALLBACK: Text too short, use OCR
  }
} catch (error) {
  → FALLBACK: Parse failed, use OCR
}
```

## 📊 Processing Methods

| Method | Trigger | Speed | Cost | Confidence |
|--------|---------|-------|------|------------|
| **DIRECT_EXTRACTION** | pdf2json success | ⚡ 50-500ms | 💰 $0 | ✅ 1.0 (100%) |
| **OCR_SYNC** | ≤15 pages | ⚙️ 2-5s | 💸 ~$0.0015/page | ✅ 0.85-0.95 |
| **OCR_BATCH** | >15 pages | 🐢 10-30s | 💸 ~$0.0015/page | ✅ 0.85-0.95 |

## 🔍 Key Files & Line Numbers

### 1. Controller Entry Point
```
src/document-processing/document-processing.controller.ts
├─ Line ~50-80: uploadDocument() endpoint
└─ Validates multipart/form-data
```

### 2. Service Layer
```
src/document-processing/document-processing.service.ts
├─ Thin wrapper around domain service
└─ Handles DTOs
```

### 3. Domain Service (Main Logic)
```
src/document-processing/domain/services/document-processing.domain.service.ts
├─ Line 65-145: uploadDocument() - Creates entity, uploads to GCS
├─ Line 150-335: startProcessing() - Main processing logic
│  ├─ Line 190-271: pdf2json path (with fallback)
│  └─ Line 272-282: OCR path
├─ Line 340-415: extractAndSaveFields() - Save extracted entities
└─ Line 420-475: handleProcessingError() - Retry logic
```

### 4. pdf2json Service
```
src/document-processing/infrastructure/pdf-extraction/pdf2json.service.ts
├─ Line 5: require('pdf2json') - Constructor import
├─ Line 37-96: parseBuffer() - Main parsing method
│  ├─ Line 50: Get constructor (PDFParser or PDFParserModule)
│  ├─ Line 53-64: Validate constructor type
│  ├─ Line 67: Instantiate parser
│  ├─ Line 70-73: Error event handler
│  └─ Line 75-78: Success event handler
└─ Line 98-115: mapPdfData() - Convert to chunks
```

### 5. Module Configuration
```
src/document-processing/document-processing.module.ts
├─ Line 15: Import Pdf2JsonService
└─ Line 68: Add to providers
```

## 📝 Log Signatures

### Success Path (pdf2json)
```
[PDF PROCESSING] Starting processing for document {id}
[PDF PROCESSING] MimeType: application/pdf, Has buffer: true
[PDF2JSON] Starting pdf2json extraction...
[PDF2JSON] Buffer size: X bytes, MimeType: application/pdf
[PDF2JSON] Buffer size: X bytes, First 10 bytes (hex): 255044462d...
[PDF2JSON] PDFParserCtor type: function
[PDF2JSON] parse done: pages=N
[PDF2JSON] Mapped to M chunks from N pages
[PDF2JSON] Extraction complete: M chunks from N pages
[PDF2JSON] Chunk sample: [first 200 chars]
[PDF2JSON] Full text length: X
[PDF2JSON] Extracted Y entities from text
[PDF PROCESSING] Processing method determined: direct_extraction
[FIELD EXTRACTION] Starting field extraction...
[FIELD EXTRACTION] Extraction complete: Y fields to save
Processing complete for document {id}
```

### Fallback Path (OCR)
```
[PDF PROCESSING] Starting processing for document {id}
[PDF2JSON] Starting pdf2json extraction...
[PDF2JSON] parse error: [error]
[PDF2JSON] falling back due to error
[PDF2JSON] pdf2json failed, falling back to OCR
[PDF2JSON] Error details: [message]
[PDF2JSON] Error stack: [stack]
[PDF PROCESSING] Fallback OCR completed
[PDF PROCESSING] Processing method determined: ocr_sync
```

## 🐛 Debug Checkpoints

Add breakpoints or logging at these key points:

### Checkpoint 1: Buffer Validation
```typescript
// Line ~196 in domain service
this.logger.debug(`Buffer hex: ${fileBuffer.slice(0, 10).toString('hex')}`);
// Should be: 255044462d... (%PDF-)
```

### Checkpoint 2: Constructor Type
```typescript
// Line ~54 in pdf2json.service.ts
this.logger.debug(`PDFParserCtor type: ${typeof PDFParserCtor}`);
// Should be: function
```

### Checkpoint 3: Parse Result
```typescript
// Line ~75 in pdf2json.service.ts (success handler)
console.log('pdfData.Pages:', pdfData.Pages?.length);
console.log('First page Texts:', pdfData.Pages?.[0]?.Texts?.length);
```

### Checkpoint 4: Chunk Generation
```typescript
// Line ~105 in pdf2json.service.ts
console.log('Generated chunks:', chunks.length);
console.log('First chunk:', chunks[0]);
```

### Checkpoint 5: Text Validation
```typescript
// Line ~219 in domain service
this.logger.debug(`Full text length: ${fullText.length}, trimmed: ${fullText.trim().length}`);
// Should be: >= 50 for success path
```

## 🎬 Quick Start Commands

```bash
# 1. Install dependencies
npm install

# 2. Verify pdf2json
npm list pdf2json
node -e "const m=require('pdf2json'); console.log('Type:', typeof m);"

# 3. Build
npm run build

# 4. Start with debug logging
LOG_LEVEL=debug npm run start:dev

# 5. Upload test PDF (in another terminal)
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@sample.pdf" \
  -F "documentType=lab_result"

# 6. Watch logs
tail -f logs/app.log | grep -E '\[PDF|DEBUG\]'
```

## 📚 Related Documentation

- **`PDF2JSON_IMPLEMENTATION.md`** - Full technical spec
- **`PDF2JSON_CONSTRUCTOR_FIX.md`** - Explains the constructor fix
- **`PDF2JSON_DEBUG_GUIDE.md`** - Debugging procedures
- **`PDF2JSON_QUICK_TEST.md`** - Quick testing guide

---

**Quick Reference for Debugging Issues Faster! 🚀**

