# Extracted Fields Debugging Guide

## Problem
The endpoint `GET /v1/documents/:documentId/fields` returns an empty array `[]` even though the document has processed successfully with confidence 0.8.

## Key Discovery: Direct PDF Extraction Issue

**CRITICAL**: If your PDF is text-based (has selectable/copyable text), the system uses **Direct Extraction** mode, which is fast but **does NOT extract structured fields/entities**.

From the code:
```typescript
if (analysis.isTextBased) {
  ocrResult = {
    text: analysis.extractedText,
    confidence: 1.0,
    pageCount: analysis.pageCount,
    entities: [],  // ← EMPTY! No entity extraction in direct mode
    fullResponse: { ... },
  };
}
```

This means:
- ✅ Text is extracted
- ✅ Document is marked as PROCESSED
- ✅ Confidence = 1.0 (100%)
- ❌ **No fields/entities are extracted**

## Comprehensive Logging Added

I've added detailed logging at every step of the pipeline. When you upload and process a document, look for these log markers:

### 1. PDF Processing Phase
```
[PDF PROCESSING] Starting processing for document {id}
[PDF PROCESSING] MimeType: application/pdf, Has buffer: true
[PDF PROCESSING] Analysis result: isTextBased=true, pageCount=X
[PDF PROCESSING] DIRECT EXTRACTION: No entities will be extracted! entities array is empty.
[PDF PROCESSING] Processing method determined: DIRECT_EXTRACTION
```

### 2. Field Extraction Phase
```
[FIELD EXTRACTION] Starting field extraction for document {id}
[FIELD EXTRACTION] OCR result structure: {"hasEntities":false,"entitiesCount":0,...}
[FIELD EXTRACTION] No entities found in OCR result for document {id}
```

### 3. Repository Save Phase (if fields exist)
```
[REPOSITORY] Saving X extracted fields to database
[REPOSITORY] Fields to save: [...]
[REPOSITORY] Successfully saved X extracted fields
```

### 4. Field Retrieval Phase
```
[FIELD RETRIEVAL] Getting extracted fields for document {id}
[REPOSITORY] Querying extracted fields for documentId: {id}
[REPOSITORY] Query returned X entities from database
[REPOSITORY] Mapped to X domain objects
[APP SERVICE] Received X fields from domain service
[APP SERVICE] Transformed to X DTOs
```

## How to Debug Your Issue

### Step 1: Upload a PDF
```bash
POST {{LocalBaseURL}}/documents/upload
```

### Step 2: Check Server Logs
Look for the log messages above to understand what path your PDF took:

#### Scenario A: Direct Extraction (Text-based PDF)
You'll see:
```
[PDF PROCESSING] Document {id} is text-based PDF - using direct extraction
[PDF PROCESSING] DIRECT EXTRACTION: No entities will be extracted!
[FIELD EXTRACTION] No entities found in OCR result
```

**Result**: Empty fields array is EXPECTED behavior.

#### Scenario B: OCR Processing (Image-based PDF or fallback)
You'll see:
```
[PDF PROCESSING] Document {id} is image-based PDF - using OCR
[PDF PROCESSING] OCR completed. Result has entities: true, count: X
[FIELD EXTRACTION] Extraction complete: X fields to save
[REPOSITORY] Successfully saved X extracted fields
```

**Result**: Fields should be extracted and saved.

### Step 3: Query Fields
```bash
GET {{LocalBaseURL}}/documents/:documentId/fields
```

Watch for:
```
[FIELD RETRIEVAL] Getting extracted fields for document {id}
[REPOSITORY] Query returned X entities from database
[APP SERVICE] Transformed to X DTOs
```

## Solution Options

### Option 1: Force OCR for All PDFs (Recommended for medical docs)
Modify the code to ALWAYS use OCR even for text-based PDFs to extract entities:

```typescript
// In document-processing.domain.service.ts, line ~199
if (analysis.isTextBased) {
  // Instead of direct extraction, force OCR to get entities
  this.logger.log(
    `Document ${documentId} is text-based but forcing OCR for entity extraction`,
  );
  ocrResult = await this.ocrService.processDocument(
    gcsUri,
    mimeType,
    document.pageCount,
  );
  processingMethod = ProcessingMethod.OCR_SYNC;
}
```

### Option 2: Add Entity Extraction to Direct Mode
Enhance the direct extraction to use NLP/regex to extract common medical entities from the plain text.

### Option 3: Document the Limitation
Accept that direct extraction mode doesn't extract structured fields and document this clearly in the API.

## Testing Recommendations

### Test with Image-based PDF
Create a PDF by scanning a paper document or taking a photo. This will force OCR mode and should extract entities.

### Test with Text-based PDF
Use a PDF generated from Word/Google Docs. This will use direct extraction and will NOT extract entities.

### Check Document Type
After upload, check the document details:
```bash
GET {{LocalBaseURL}}/documents/:documentId
```

Look at the `processingMethod` field:
- `DIRECT_EXTRACTION` → No entities extracted
- `OCR_SYNC` or `OCR_BATCH` → Entities should be extracted

## Log Locations

All logs will appear in your server console output. Search for:
- `[PDF PROCESSING]` - PDF analysis and routing decisions
- `[FIELD EXTRACTION]` - Entity extraction and saving
- `[REPOSITORY]` - Database operations
- `[FIELD RETRIEVAL]` - Retrieval and query operations
- `[APP SERVICE]` - DTO transformation

## Next Steps

1. **Upload a test PDF** and watch the logs
2. **Identify which processing path** your PDF takes
3. **If using DIRECT_EXTRACTION**, that's why you have no fields
4. **Decide on a solution** (force OCR, enhance direct extraction, or document limitation)

## Related Files
- Domain service: `src/document-processing/domain/services/document-processing.domain.service.ts`
- Repository: `src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts`
- App service: `src/document-processing/document-processing.service.ts`
- PDF analyzer: `src/document-processing/utils/pdf-analyzer.ts`

