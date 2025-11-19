# PDF2JSON Quick Test Guide

## Quick Verification

After deploying the pdf2json integration, follow these steps to verify it's working correctly.

## Prerequisites

1. ✅ pdf2json installed: `npm list pdf2json`
2. ✅ Build successful: `npm run build`
3. ✅ Server running: `npm run start:dev`

## Test 1: Upload a Text-Based PDF

### Upload via API

```bash
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@sample-lab-results.pdf" \
  -F "documentType=lab_result"
```

### Expected Response

```json
{
  "id": "abc-123-def-456",
  "status": "STORED",
  "fileName": "sample-lab-results.pdf",
  "mimeType": "application/pdf"
}
```

### Check Logs

Look for these log lines (in order):

```
[PDF PROCESSING] Starting processing for document abc-123-def-456
[PDF PROCESSING] MimeType: application/pdf, Has buffer: true
[PDF2JSON] Starting pdf2json extraction for document abc-123-def-456...
[PDF2JSON] Extraction complete: 3 chunks from 1 pages
[PDF2JSON] Chunk sample: Patient Name: John Doe...
[PDF2JSON] Full text length: 1543
[PDF2JSON] Extracted 8 entities from text
[PDF PROCESSING] Processing method determined: direct_extraction
```

### Check Document Status

```bash
curl -X GET http://localhost:3000/v1/documents/abc-123-def-456 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected fields:**
- `status: "PROCESSED"`
- `processingMethod: "DIRECT_EXTRACTION"`
- `confidence: 1.0`
- `ocrJsonOutput.method: "pdf2json_extraction"`
- `ocrJsonOutput.chunks: [ { id: "page_1", content: "..." }, ... ]`

## Test 2: Upload a Scanned (Image-Based) PDF

### Upload

```bash
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@scanned-document.pdf" \
  -F "documentType=medical_record"
```

### Expected Logs (Fallback to OCR)

```
[PDF2JSON] Starting pdf2json extraction for document xyz-789...
[PDF2JSON] Extraction complete: 1 chunks from 1 pages
[PDF2JSON] Chunk sample: (empty or minimal text)
[PDF2JSON] pdf2json failed for xyz-789, falling back to OCR: Insufficient text
[PDF PROCESSING] Fallback OCR completed. Result has entities: true, count: 12
[PDF PROCESSING] Processing method determined: ocr_sync
```

### Check Document Status

**Expected fields:**
- `status: "PROCESSED"`
- `processingMethod: "OCR_SYNC"` or `"OCR_BATCH"`
- `confidence: 0.85-0.95` (varies)
- `ocrJsonOutput.method: "gcp_document_ai"`

## Test 3: Check Extracted Fields

### Get Extracted Fields

```bash
curl -X GET http://localhost:3000/v1/documents/abc-123-def-456/fields \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Expected Response

```json
{
  "data": [
    {
      "id": "field-uuid-1",
      "documentId": "abc-123-def-456",
      "fieldKey": "patient_name",
      "fieldValue": "John Doe",
      "fieldType": "string",
      "confidence": 1.0,
      "startIndex": 15,
      "endIndex": 23
    },
    {
      "id": "field-uuid-2",
      "documentId": "abc-123-def-456",
      "fieldKey": "test_date",
      "fieldValue": "2024-01-15",
      "fieldType": "date",
      "confidence": 1.0,
      "startIndex": 45,
      "endIndex": 55
    }
  ]
}
```

## Test 4: Verify Cost Savings

### Check Processing Method Distribution

Query your database:

```sql
SELECT 
  processing_method,
  COUNT(*) as document_count,
  AVG(confidence) as avg_confidence
FROM documents
WHERE created_at > NOW() - INTERVAL '7 days'
  AND mime_type = 'application/pdf'
GROUP BY processing_method;
```

### Expected Results

For typical healthcare documents (mostly text-based PDFs):

```
processing_method     | document_count | avg_confidence
----------------------|----------------|---------------
DIRECT_EXTRACTION     | 150            | 1.00
OCR_SYNC              | 20             | 0.87
OCR_BATCH             | 5              | 0.89
```

**Cost Impact:**
- Before: 175 documents × $0.0015/page × avg 2 pages = **$0.525**
- After: 20+5 documents × $0.0015/page × avg 2 pages = **$0.075**
- **Savings: $0.45 (86% reduction)**

## Troubleshooting

### Issue: No [PDF2JSON] logs

**Check:**
1. Is `Pdf2JsonService` in the module providers?
2. Is it injected in the domain service constructor?
3. Is the uploaded file actually a PDF? (`mimeType === 'application/pdf'`)

### Issue: All PDFs fall back to OCR

**Check:**
1. Are the PDFs text-based or scanned?
2. Run a quick test with a known text-based PDF (like one exported from Word)
3. Check pdf2json installation: `npm list pdf2json`

### Issue: Build fails

**Check tsconfig.json:**
```json
{
  "compilerOptions": {
    "esModuleInterop": true  // ← Must be true
  }
}
```

## Sample Test Files

### Generate Test PDFs

**Text-based PDF** (for testing pdf2json):
```bash
# Create a simple PDF with text using any tool
# Examples:
# - Export from Google Docs/Word
# - Use online HTML-to-PDF converter
# - Use any electronic lab result from a LIMS system
```

**Image-based PDF** (for testing OCR fallback):
```bash
# Scan a document or convert an image to PDF
# Examples:
# - Use scanner/phone camera → PDF
# - Convert JPG to PDF using ImageMagick:
convert scanned-doc.jpg scanned-doc.pdf
```

## Performance Benchmarks

### Expected Processing Times

| PDF Type | Pages | pdf2json Time | OCR Time | Speedup |
|----------|-------|---------------|----------|---------|
| Text-based | 1 | 50ms | 2s | **40x** |
| Text-based | 5 | 200ms | 8s | **40x** |
| Text-based | 10 | 400ms | 15s | **37x** |
| Scanned | 1 | N/A (fallback) | 2s | N/A |

## Success Criteria

✅ **All passing:**
- [x] Text-based PDFs use `DIRECT_EXTRACTION`
- [x] Confidence = 1.0 for direct extraction
- [x] Logs show `[PDF2JSON]` activity
- [x] Structured chunks in `ocrJsonOutput.chunks`
- [x] Form fields extracted (if present in PDF)
- [x] Entities extracted from text
- [x] Image-based PDFs fall back to OCR gracefully
- [x] No errors in logs
- [x] Processing time < 1 second for text PDFs
- [x] Build succeeds: `npm run build`

## Next Steps

After verification:

1. **Deploy to staging** environment
2. **Run integration tests** with real healthcare PDFs
3. **Monitor logs** for first 24 hours
4. **Check cost reduction** in GCP console (Document AI usage)
5. **Gather performance metrics** (processing time distribution)
6. **Document findings** for production deployment

## Rollback Plan

If issues arise:

1. **Revert git commit**:
   ```bash
   git revert HEAD
   ```

2. **Or disable pdf2json temporarily**:
   ```typescript
   // In document-processing.domain.service.ts
   // Comment out pdf2json logic, uncomment old analyzePdf logic
   ```

3. **Redeploy previous version**

4. **Investigate logs** to determine root cause

## Contact

For questions or issues:
- Slack: #keystone-core-api
- Email: devops@healthatlas.com
- JIRA: ATLAS-PDF-EXTRACTION

---

**Last Updated**: November 13, 2025  
**Version**: 1.0  
**Author**: Keystone Core API Team

