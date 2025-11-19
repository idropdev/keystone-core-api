# PDF2JSON Debug Guide

## 🔧 Constructor Fix Applied

### Issue Identified
The original code was incorrectly trying to use `PDFParserModule` directly as a constructor, but pdf2json exports a **class constructor** that must be accessed correctly.

### What Was Fixed

#### Before (BROKEN)
```typescript
import * as PDFParserModule from 'pdf2json';
const pdfParser: any = new (PDFParserModule as any)();
// ❌ Error: PDFParserModule is not a constructor
```

#### After (FIXED) ✅
```typescript
// Use require to get the correct constructor reference
const PDFParserModule = require('pdf2json');

// Get constructor: may be PDFParserModule.PDFParser or PDFParserModule directly
const PDFParserCtor = PDFParserModule.PDFParser || PDFParserModule;

// Verify it's a function/constructor
if (typeof PDFParserCtor !== 'function') {
  throw new Error('pdf2json PDFParser constructor not found');
}

// Create instance
const pdfParser = new PDFParserCtor();
```

## 📊 Expected Debug Output

When you upload a PDF now, you should see these logs (in order):

### 1. Initial Processing
```
[PDF PROCESSING] Starting processing for document abc-123-def-456
[PDF PROCESSING] MimeType: application/pdf, Has buffer: true
```

### 2. pdf2json Initialization
```
[PDF2JSON] Starting pdf2json extraction for document abc-123-def-456...
[PDF2JSON] Buffer size: 245678 bytes, MimeType: application/pdf
```

### 3. Buffer Validation (DEBUG level)
```
[PDF2JSON] Buffer size: 245678 bytes, First 10 bytes (hex): 255044462d312e37
[PDF2JSON] PDFParserCtor type: function
```

**Valid PDF hex signature:**
- Should start with `25 50 44 46` = `%PDF` in ASCII
- Full example: `25 50 44 46 2d 31 2e 37` = `%PDF-1.7`

**If you see something else:**
- `89 50 4e 47` = PNG image (not PDF!)
- `ff d8 ff e0` = JPEG image (not PDF!)
- Buffer is corrupted or wrong file type

### 4. Parse Success
```
[PDF2JSON] parse done: pages=1
[PDF2JSON] Mapped to 3 chunks from 1 pages
[PDF2JSON] Extraction complete: 3 chunks from 1 pages
[PDF2JSON] Chunk sample: Patient Name: John Doe Test Date: 2024-01-15...
[PDF2JSON] Full text length: 1543
[PDF2JSON] Extracted 8 entities from text
[PDF PROCESSING] Processing method determined: direct_extraction
```

### 5. Parse Failure (Fallback to OCR)
```
[PDF2JSON] parse error: [error details]
[PDF2JSON] falling back due to error [error object]
[PDF2JSON] pdf2json failed for abc-123, falling back to OCR
[PDF2JSON] Error details: [specific error message]
[PDF2JSON] Error stack: [stack trace]
[PDF PROCESSING] Fallback OCR completed. Result has entities: true, count: 12
[PDF PROCESSING] Processing method determined: ocr_sync
```

## 🐛 Common Error Scenarios

### Error 1: "PDFParserCtor is not a constructor"

**Log Output:**
```
[PDF2JSON] PDFParserCtor type: object
[PDF2JSON] PDFParserCtor is not a constructor! Type: object
Error: pdf2json PDFParser constructor not found - check import
```

**Cause:**
- Import resolution issue
- Module not installed correctly
- Version mismatch

**Fix:**
```bash
# Reinstall pdf2json
rm -rf node_modules/pdf2json
npm install pdf2json

# Verify installation
npm list pdf2json
# Should show: pdf2json@3.1.3 (or similar)

# Check what the module exports
node -e "const m = require('pdf2json'); console.log('Type:', typeof m); console.log('Keys:', Object.keys(m));"
```

### Error 2: "Insufficient text content"

**Log Output:**
```
[PDF2JSON] Extraction complete: 1 chunks from 1 pages
[PDF2JSON] Chunk sample: 
[PDF2JSON] Full text length: 0
[PDF2JSON] Insufficient text extracted (0 chars), falling back to OCR
```

**Cause:**
- PDF is image-based (scanned document)
- PDF has no text layer
- Text is in non-extractable format

**Expected Behavior:**
✅ This is **normal** and the system will gracefully fall back to OCR.

**Verify:**
```bash
# Test the PDF manually with pdf2json CLI (if available)
npm install -g pdf2json
pdf2json input.pdf output.json
cat output.json | jq '.Pages[0].Texts | length'
# If 0 or very small, it's an image-based PDF
```

### Error 3: "Invalid PDF buffer"

**Log Output:**
```
[PDF2JSON] Buffer size: 245678 bytes, First 10 bytes (hex): 89504e470d0a1a0a
[PDF2JSON] parse error: Invalid PDF
```

**Cause:**
- File is not a PDF (hex signature doesn't match `%PDF`)
- Buffer is corrupted
- Incorrect MIME type detection

**Verify Buffer:**
```typescript
// Add to domain service before calling pdf2json
const bufferHex = fileBuffer.slice(0, 10).toString('hex');
const bufferAscii = fileBuffer.slice(0, 10).toString('ascii');
this.logger.debug(`[DEBUG] Buffer hex: ${bufferHex}`);
this.logger.debug(`[DEBUG] Buffer ASCII: ${bufferAscii}`);
// Should show: %PDF-1.4 (or 1.5, 1.6, 1.7)
```

### Error 4: "Garbled text / encoding issues"

**Log Output:**
```
[PDF2JSON] Chunk sample: Patient%20Name%3A%20John%20Doe
```

**Cause:**
- `decodeURIComponent()` not applied
- Wrong text encoding in PDF

**Verify:**
Check `mapPdfData()` in pdf2json.service.ts:
```typescript
const pageText = (page.Texts ?? [])
  .map((t: any) => decodeURIComponent(t.R.map((r: any) => r.T).join('')))
  .join(' ');
// ✅ decodeURIComponent must be called!
```

## 🧪 Testing Checklist

### Quick Verification Script

```bash
#!/bin/bash
# Save as test-pdf2json.sh

echo "🧪 Testing pdf2json integration..."

# 1. Check installation
echo "1️⃣ Checking pdf2json installation..."
npm list pdf2json || echo "❌ pdf2json not installed!"

# 2. Test require
echo "2️⃣ Testing module import..."
node -e "
const PDFParser = require('pdf2json');
console.log('✅ Module type:', typeof PDFParser);
console.log('✅ Constructor:', typeof PDFParser.PDFParser || typeof PDFParser);
" || echo "❌ Module import failed!"

# 3. Build
echo "3️⃣ Building project..."
npm run build || echo "❌ Build failed!"

# 4. Start server (in background)
echo "4️⃣ Starting server..."
npm run start:dev &
SERVER_PID=$!
sleep 10

# 5. Upload test PDF
echo "5️⃣ Uploading test PDF..."
curl -X POST http://localhost:3000/v1/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@sample.pdf" \
  -F "documentType=lab_result"

# 6. Check logs
echo "6️⃣ Checking logs for [PDF2JSON] activity..."
tail -n 100 logs/app.log | grep PDF2JSON

# Cleanup
kill $SERVER_PID

echo "✅ Test complete!"
```

### Manual Test Steps

1. **Start server with debug logging:**
   ```bash
   LOG_LEVEL=debug npm run start:dev
   ```

2. **Upload a text-based PDF:**
   ```bash
   curl -X POST http://localhost:3000/v1/documents/upload \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -F "file=@test-document.pdf" \
     -F "documentType=lab_result"
   ```

3. **Watch logs in real-time:**
   ```bash
   tail -f logs/app.log | grep -E '\[PDF|DEBUG\]'
   ```

4. **Verify success indicators:**
   - [x] `[PDF2JSON] PDFParserCtor type: function`
   - [x] `[PDF2JSON] Buffer size: X bytes, First 10 bytes (hex): 255044462d...`
   - [x] `[PDF2JSON] parse done: pages=N`
   - [x] `[PDF2JSON] Extraction complete: M chunks from N pages`
   - [x] `[PDF2JSON] Full text length: X` (X > 50)
   - [x] `[PDF PROCESSING] Processing method determined: direct_extraction`

5. **Query document:**
   ```bash
   curl -X GET http://localhost:3000/v1/documents/{documentId} \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
   ```

6. **Verify response:**
   ```json
   {
     "status": "PROCESSED",
     "processingMethod": "DIRECT_EXTRACTION",
     "confidence": 1.0,
     "ocrJsonOutput": {
       "method": "pdf2json_extraction",
       "chunks": [
         { "id": "page_1", "content": "..." },
         { "id": "field_1_patientName", "content": "Field patientName: ..." }
       ]
     }
   }
   ```

## 🔍 Deep Debug Mode

### Enable Maximum Logging

Add this to your `main.ts` or environment config:

```typescript
// main.ts
app.useLogger(['log', 'error', 'warn', 'debug', 'verbose']);
```

### Add Extra Debug Points

In `pdf2json.service.ts`, add:

```typescript
// After getting constructor
console.log('[DEBUG] PDFParserModule keys:', Object.keys(PDFParserModule));
console.log('[DEBUG] PDFParserModule.PDFParser:', PDFParserModule.PDFParser);
console.log('[DEBUG] PDFParserCtor:', PDFParserCtor);
console.log('[DEBUG] typeof PDFParserCtor:', typeof PDFParserCtor);

// After creating instance
console.log('[DEBUG] pdfParser instance:', pdfParser);
console.log('[DEBUG] pdfParser.parseBuffer exists:', typeof pdfParser.parseBuffer);

// In event handlers
pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
  console.log('[DEBUG] pdfData keys:', Object.keys(pdfData));
  console.log('[DEBUG] Pages count:', pdfData.Pages?.length);
  console.log('[DEBUG] First page keys:', Object.keys(pdfData.Pages?.[0] || {}));
  console.log('[DEBUG] First page Texts count:', pdfData.Pages?.[0]?.Texts?.length);
});
```

### Capture Full PDF Data

For deep inspection, save the parsed PDF data:

```typescript
// In mapPdfData()
import * as fs from 'fs';
fs.writeFileSync(
  `/tmp/pdf-debug-${Date.now()}.json`,
  JSON.stringify(pdfData, null, 2)
);
```

## 📈 Performance Monitoring

### Add Timing Metrics

```typescript
// In parseBuffer()
const startTime = Date.now();

return new Promise<any>((resolve, reject) => {
  pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
    const duration = Date.now() - startTime;
    this.logger.log(`[PDF2JSON] parse done in ${duration}ms: pages=${pdfData.Pages?.length}`);
    resolve(pdfData);
  });
  // ...
});
```

### Expected Timings

| PDF Size | Pages | Expected Time |
|----------|-------|---------------|
| Small (<1 MB) | 1-5 | 50-200ms |
| Medium (1-5 MB) | 5-10 | 200-500ms |
| Large (>5 MB) | 10+ | 500-2000ms |

**If slower than expected:**
- Check CPU usage
- Check memory usage
- Consider if PDF has complex structures

## 🚨 When to Fall Back to OCR

The system automatically falls back to OCR when:

1. **Constructor not found** → Critical error
2. **Parse error** → PDF corrupted/encrypted
3. **Insufficient text** → Image-based PDF (< 50 chars)
4. **Timeout** → PDF too complex

**This is expected behavior and ensures documents are always processed!**

## 📞 Getting Help

If you're still seeing issues after following this guide:

1. **Collect these artifacts:**
   - Full log output (last 200 lines)
   - Sample PDF file (if possible to share)
   - `npm list pdf2json` output
   - Node version: `node --version`
   - Build output

2. **Run diagnostic:**
   ```bash
   # Quick diagnostic
   echo "Node: $(node --version)"
   echo "pdf2json: $(npm list pdf2json | grep pdf2json)"
   node -e "const m=require('pdf2json'); console.log('Type:', typeof m, 'Has PDFParser:', !!m.PDFParser);"
   ```

3. **Share with team:**
   - Slack: #keystone-core-api
   - JIRA: ATLAS-PDF-EXTRACTION
   - Tag: @pdf-processing-team

## ✅ Success Checklist

After deploying this fix, verify:

- [ ] Build passes: `npm run build`
- [ ] Server starts: `npm run start:dev`
- [ ] Constructor logs show `type: function`
- [ ] Text-based PDFs extract successfully
- [ ] Chunk samples show decoded text (not percent-encoded)
- [ ] Image-based PDFs fall back to OCR gracefully
- [ ] No errors in logs for valid PDFs
- [ ] Processing time < 1 second for text PDFs
- [ ] `processingMethod: "DIRECT_EXTRACTION"` in API response

---

**Last Updated**: November 13, 2025  
**Fix Applied**: Constructor resolution using `require('pdf2json')`  
**Status**: ✅ Ready for Testing

