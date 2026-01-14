---
name: Google Cloud Vision AI OCR Integration
overview: Implement Google Cloud Vision AI OCR integration as a primary OCR engine with Document AI as fallback, following the existing port/adapter pattern and maintaining HIPAA compliance.
todos:
  - id: install-vision-package
    content: Install @google-cloud/vision npm package
    status: pending
  - id: create-vision-adapter
    content: Create GcpVisionAiAdapter implementing OcrServicePort with DOCUMENT_TEXT_DETECTION feature
    status: pending
  - id: implement-text-extraction
    content: Implement text extraction from fullTextAnnotation.text with proper normalization
    status: pending
  - id: implement-entity-fallback
    content: Add regex-based entity extraction fallback using extractEntitiesFromText utility
    status: pending
  - id: update-domain-service-routing
    content: Update DocumentProcessingDomainService to try Vision AI first, fallback to Document AI
    status: pending
  - id: update-module-config
    content: Update DocumentProcessingModule to inject both OCR adapters
    status: pending
  - id: add-ocr-provider-field
    content: Add ocrProvider field to Document entity and create database migration
    status: pending
  - id: write-unit-tests
    content: Write unit tests for Vision AI adapter
    status: pending
  - id: update-integration-tests
    content: Update integration tests for new routing logic
    status: pending
  - id: update-documentation
    content: Update OCR implementation documentation with Vision AI details
    status: pending
---

# Google

Cloud Vision AI OCR Integration Plan

## Overview

Add Google Cloud Vision API with DOCUMENT_TEXT_DETECTION as a primary OCR engine in the document processing pipeline. Vision AI will be the first OCR option attempted after free text extraction methods (pdf2json/pdf-parse) fail, with Document AI serving as a fallback OCR provider.

## Architecture Changes

### Current Flow

```javascript
PDF → pdf2json → pdf-parse → Document AI OCR
```



### New Flow

```javascript
PDF → pdf2json → pdf-parse → Vision AI OCR → Document AI OCR (fallback)
```



## Implementation Tasks

### 1. Add Google Cloud Vision API Package

**File**: `package.json`Add dependency:

```json
"@google-cloud/vision": "^4.0.0"
```

Run `npm install @google-cloud/vision`

### 2. Create Vision AI Adapter

**File**: `src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts`Create new adapter implementing `OcrServicePort` interface:

- **Constructor**: Initialize ImageAnnotatorClient from `@google-cloud/vision`
- **processDocument method**: 
- Accepts `gcsUri`, `mimeType`, `pageCount?` parameters (matching interface)
- Builds Vision API request with explicit `features: [{ type: "DOCUMENT_TEXT_DETECTION" }]`
- Uses `imageSource.gcsImageUri` for GCS-based input
- Extracts `fullTextAnnotation.text` as primary output
- Normalizes response to `OcrResult` interface format
- **Text Extraction**: 
- Extract `fullTextAnnotation.text` (full document text)
- Preserve document structure if available (pages, blocks, paragraphs)
- Normalize whitespace while maintaining paragraph boundaries
- **Entity Extraction**: 
- Vision API doesn't extract entities - use regex fallback via `extractEntitiesFromText()` utility
- Same pattern as Document AI adapter when entities are missing
- **Error Handling**: 
- Typed errors with explicit error messages
- Log errors without PHI (document IDs only)
- Proper error propagation for routing logic
- **HIPAA Compliance**:
- Vision API is HIPAA-eligible (requires BAA with Google)
- No PHI in logs
- Encryption in transit handled by GCP SDK
- Add TODO comments for BAA requirement

### 3. Configuration Updates

**File**: `src/document-processing/config/document-processing.config.ts`Add Vision API configuration options (optional - Vision can use same GCP project/auth):

- Consider adding feature flag: `DOC_PROCESSING_VISION_AI_ENABLED` (default: true)
- Vision API uses same GCP project/credentials as Document AI, so minimal config needed

**File**: `src/document-processing/config/document-processing-config.type.ts`Update type definition if adding new config fields.

### 4. Update Processing Method Enum (Optional)

**File**: `src/document-processing/domain/enums/processing-method.enum.ts`Based on user preference, we'll add a separate field rather than extending enum. However, for backward compatibility, consider adding:

- `OCR_VISION_SYNC` (optional, if tracking Vision separately)

Alternatively, add `ocrProvider` field to document entity to track provider independently.

### 5. Add OCR Provider Tracking

**Option A**: Add to Document Entity**File**: `src/document-processing/domain/entities/document.entity.ts`Add optional field:

```typescript
ocrProvider?: 'document-ai' | 'vision-ai';
```

**Option B**: Store in Processing MetadataStore provider info in `fullResponse` or processing metadata without schema change.

### 6. Create OCR Router/Composite Service (Optional)

**File**: `src/document-processing/infrastructure/ocr/ocr-router.adapter.ts` (optional)If we want to keep routing logic separate:

- Implements `OcrServicePort`
- Contains routing logic: try Vision AI first, fallback to Document AI
- Delegates to underlying adapters
- Tracks which provider succeeded

**Alternative**: Integrate routing directly into domain service (simpler, follows current pattern).

### 7. Update Domain Service Routing Logic

**File**: `src/document-processing/domain/services/document-processing.domain.service.ts`Modify OCR fallback section (around lines 326-375):**Current logic**:

```typescript
ocrResult = await this.ocrService.processDocument(gcsUri, mimeType, pageCount);
```

**New logic**:

```typescript
// Try Vision AI first (primary OCR)
try {
  ocrResult = await this.visionOcrService.processDocument(gcsUri, mimeType, pageCount);
  ocrProvider = 'vision-ai';
  processingMethod = ProcessingMethod.OCR_SYNC; // or OCR_VISION_SYNC if enum extended
} catch (visionError) {
  this.logger.warn(`Vision AI OCR failed, falling back to Document AI: ${visionError.message}`);
  // Fallback to Document AI
  ocrResult = await this.documentAiOcrService.processDocument(gcsUri, mimeType, pageCount);
  ocrProvider = 'document-ai';
  processingMethod = pageCount && pageCount <= 15 
    ? ProcessingMethod.OCR_SYNC 
    : ProcessingMethod.OCR_BATCH;
}
```

**Dependency Injection**: Update constructor to inject both OCR services:

```typescript
constructor(
  // ... existing dependencies
  @Inject('VisionOcrServicePort')
  private readonly visionOcrService: OcrServicePort,
  @Inject('DocumentAiOcrServicePort') 
  private readonly documentAiOcrService: OcrServicePort,
  // OR use a router adapter that handles routing internally
)
```



### 8. Update Module Configuration

**File**: `src/document-processing/document-processing.module.ts`**Option A**: Dual Injection (if routing in domain service)

```typescript
providers: [
  // ... existing providers
  {
    provide: 'VisionOcrServicePort',
    useClass: GcpVisionAiAdapter,
  },
  {
    provide: 'DocumentAiOcrServicePort',
    useClass: GcpDocumentAiAdapter,
  },
  // Keep OcrServicePort for backward compatibility or remove if using explicit providers
  GcpVisionAiAdapter,
  GcpDocumentAiAdapter,
]
```

**Option B**: Router Pattern (if using router adapter)

```typescript
providers: [
  // ... existing providers
  GcpVisionAiAdapter,
  GcpDocumentAiAdapter,
  {
    provide: 'OcrServicePort',
    useFactory: (visionAdapter, docAiAdapter, configService) => {
      return new OcrRouterAdapter(visionAdapter, docAiAdapter, configService);
    },
    inject: [GcpVisionAiAdapter, GcpDocumentAiAdapter, ConfigService],
  },
]
```



### 9. Database Migration (if adding ocrProvider field)

**File**: `src/database/migrations/[timestamp]-AddOcrProviderToDocuments.ts`If adding `ocrProvider` field to document entity:

```typescript
export class AddOcrProviderToDocuments1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents" 
      ADD COLUMN "ocr_provider" VARCHAR(50) NULL;
      
      COMMENT ON COLUMN "documents"."ocr_provider" IS 
        'OCR provider used: document-ai or vision-ai';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "ocr_provider";`);
  }
}
```



### 10. Entity Extraction Fallback

**File**: `src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts`Vision API doesn't extract structured entities, so implement fallback:

```typescript
// After extracting text
let entities: any[] = [];

// Vision API doesn't provide entities, use regex fallback
const textEntities = extractEntitiesFromText(fullText);
entities = textEntities;

// Calculate confidence from text quality or default
const confidence = 0.85; // Vision DOCUMENT_TEXT_DETECTION typically high confidence
```



### 11. Response Normalization

**File**: `src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts`Normalize Vision API response to `OcrResult` interface:

```typescript
return {
  text: fullTextAnnotation.text, // Extracted text
  confidence: 0.85, // Default or calculated
  pageCount: fullTextAnnotation.pages?.length || 1,
  entities: entities, // From regex extraction
  fullResponse: {
    engine: 'google-vision',
    mode: 'DOCUMENT_TEXT_DETECTION',
    fullTextAnnotation: fullTextAnnotation,
    // ... other Vision API response data
  },
};
```



### 12. Update Environment Configuration

**File**: `env-example-relational` or relevant env exampleAdd optional Vision API configuration:

```bash
# Vision AI OCR (optional, uses same GCP project/auth as Document AI)
DOC_PROCESSING_VISION_AI_ENABLED=true
```



### 13. Error Handling and Logging

**File**: `src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts`

- Explicit error types (no silent failures)
- Log errors with context (document ID, error type) but NO PHI
- Proper error propagation for routing logic
- Retry logic if needed (Vision API can have transient failures)

### 14. Testing

**Files**:

- `src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.spec.ts` (unit tests)
- Update existing integration tests

**Test Cases**:

- Successful text extraction from GCS URI
- DOCUMENT_TEXT_DETECTION feature usage verification
- Entity extraction fallback (regex)
- Error handling and propagation
- Response normalization
- HIPAA compliance (no PHI in logs)
- Integration with domain service routing

### 15. Documentation Updates

**Files**:

- `docs/ocr-implementation-description.md` - Add Vision AI section
- Update processing flow diagrams
- Add Vision API setup instructions
- Document routing logic and fallback strategy

## Implementation Order

1. Install package dependency
2. Create Vision AI adapter with basic structure
3. Implement `processDocument` method with DOCUMENT_TEXT_DETECTION
4. Implement response normalization to `OcrResult`
5. Add entity extraction fallback (regex)
6. Update domain service routing logic
7. Update module configuration
8. Add database migration (if adding ocrProvider field)
9. Write unit tests
10. Update integration tests
11. Update documentation

## Key Design Decisions

1. **Routing Strategy**: Vision AI as primary OCR, Document AI as fallback (after pdf2json/pdf-parse)
2. **Provider Tracking**: Separate `ocrProvider` field in document entity (not enum extension)
3. **Interface Compliance**: Vision adapter implements same `OcrServicePort` interface
4. **Entity Extraction**: Regex fallback since Vision API doesn't provide entities
5. **Error Handling**: Explicit errors, proper propagation for routing
6. **HIPAA Compliance**: Follow same patterns as Document AI adapter

## Considerations

- **Cost**: Vision API pricing (~$1.50 per 1,000 images for DOCUMENT_TEXT_DETECTION) vs Document AI
- **Performance**: Vision API typically faster for images, Document AI better for complex documents
- **Accuracy**: Both are high-accuracy, Vision optimized for document-style images
- **BAA**: Both require Business Associate Agreement with Google for HIPAA
- **GCP Credentials**: Vision API uses same GCP authentication (service account)
- **Batch Processing**: Vision API supports batch processing via async operations if needed

## Risk Mitigation

- **Vision API failures**: Automatic fallback to Document AI
- **Cost overruns**: Monitor usage, consider rate limiting