---
name: Parallel OCR Merge Architecture
overview: Implement parallel execution of Vision AI and Document AI OCR with hierarchical alignment and evidence-based voting to produce higher-accuracy merged OCR results.
todos:
  - id: install-vision-package
    content: Install @google-cloud/vision npm package
    status: pending
  - id: create-vision-adapter
    content: Create GcpVisionAiAdapter with DOCUMENT_TEXT_DETECTION feature and async batch support
    status: pending
  - id: create-alignment-utils
    content: Create ocr-alignment.ts with canonical line extraction and bounding box normalization
    status: pending
  - id: create-merge-service
    content: Create OcrMergeService with hierarchical alignment, voting, and merge logic
    status: pending
  - id: create-post-processor
    content: Create OcrPostProcessorService for optional post-processing
    status: pending
  - id: update-domain-service-parallel
    content: Update DocumentProcessingDomainService to run both OCRs in parallel using Promise.allSettled
    status: pending
  - id: add-merge-processing-methods
    content: Add OCR_MERGED and OCR_VISION_SYNC to ProcessingMethod enum
    status: pending
  - id: update-module-config
    content: Update DocumentProcessingModule to inject both OCR adapters and merge service
    status: pending
  - id: implement-error-handling
    content: Implement graceful degradation when one or both OCRs fail
    status: pending
  - id: add-merge-config
    content: Add configuration for merge mode, thresholds, and post-processing flags
    status: pending
  - id: write-merge-unit-tests
    content: Write comprehensive unit tests for merge service and alignment algorithms
    status: pending
  - id: write-vision-adapter-tests
    content: Write unit tests for Vision AI adapter (sync and async)
    status: pending
  - id: update-integration-tests
    content: Update integration tests for parallel OCR execution and merge
    status: pending
  - id: update-documentation
    content: Update OCR documentation with parallel merge architecture details
    status: pending
  - id: add-monitoring-metrics
    content: Add monitoring and metrics for merge performance and quality
    status: pending
---

# Parallel OCR Merge Architecture - Design Specification

## Overview

This design specifies a **Parallel OCR Merge Architecture** that replaces the sequential fallback OCR strategy with a parallel execution + hierarchical merge system. The system runs both Google Vision AI (DOCUMENT_TEXT_DETECTION) and Google Document AI OCR simultaneously, aligns their outputs hierarchically, applies evidence-based voting with validation heuristics, computes confidence scores, and returns a merged OCR result with comprehensive metadata and optional post-processing.

**Goal**: Produce higher-quality OCR results than either engine alone by leveraging complementary strengths and using research-validated multi-engine OCR fusion techniques.

## Architecture Principles

### Best Practice 6-Step Architecture

The implementation follows research-validated best practices for multi-engine OCR fusion:

1. **Parallel Execution**: Run both OCR engines simultaneously
2. **Hierarchical Alignment**: Page → Line → Word → Character (within mismatched words only)
3. **Evidence-Based Voting**: Structural bounding boxes + text similarity + validation heuristics
4. **Confidence Scoring**: Line-level agreement + overall document score
5. **Optional Post-Processing**: Language model scoring + regex corrections
6. **Final Output with Metadata**: Merged text + agreement scores + per-line engine contributions

### Design Constraints

- **No full-document character alignment**: Too expensive O(n*m) complexity
- **Normalized bounding boxes**: All coordinates in [0, 1] space for consistent comparison
- **Deterministic voting**: All decisions must be explainable and reproducible
- **PHI safety**: Full source texts stored only under debug flag
- **Graceful degradation**: System must handle partial failures robustly

---

## 1. Constants and Thresholds

### Alignment and Voting Constants

The following constants define the merge algorithm behavior:

```typescript
// Line pairing thresholds
LINE_VERTICAL_OVERLAP_MIN = 0.5;        // Minimum vertical overlap (50%) to pair lines
SIMILARITY_WINDOW = 5;                  // Number of nearby lines to check for similarity fallback
SIMILARITY_MIN = 0.7;                   // Minimum similarity score (0-1) to pair lines via text similarity

// Merge decision thresholds
LINE_MIX_THRESHOLD = 0.55;              // Minimum line agreement to mix character-by-character (prevent Frankenstein lines)
DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT = 0.7;  // Minimum document-level agreement to consider merge successful
```

**Behavior Rules**:

- If `lineAgreement < LINE_MIX_THRESHOLD`: Choose whole best line (no mixing)
- If `docAgreement < DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT`: Use best single-engine result (unless config overrides)

---

## 2. Canonical Line Extraction Contract

### Purpose

A common utility function that extracts lines with normalized bounding boxes from both Vision AI and Document AI OCR results, providing a unified interface for alignment operations.

### Interface Definition

**File**: `src/document-processing/utils/ocr-alignment.ts`

```typescript
interface LineWithBoundingBox {
  text: string;                                    // Line text content
  boundingBox: {                                   // Normalized bounding box [0, 1]
    x0: number;                                    // Left edge (0 = leftmost, 1 = rightmost)
    y0: number;                                    // Top edge (0 = top, 1 = bottom)
    x1: number;                                    // Right edge
    y1: number;                                    // Bottom edge
  };
  pageIndex: number;                               // Zero-based page index
  lineIndex: number;                               // Zero-based line index within page
  confidence?: number;                             // Line-level confidence (0-1) if available
}
```

### Function Contract

```typescript
function extractLinesWithBoundingBoxes(ocrResult: OcrResult): LineWithBoundingBox[];
```

**Requirements**:

- **Works for both engines**: Must handle Vision AI and Document AI response structures
- **Normalized coordinates**: All bounding boxes in range [0, 1] regardless of source coordinate system
- **Preserves structure**: Maintains page and line ordering from original document
- **Handles missing boxes**: Returns empty bounding box {0, 0, 1, 1} if coordinates unavailable

### Bounding Box Normalization Rules

**From Vision AI**:

- Vision API provides bounding boxes in absolute pixel coordinates within a page
- Normalize: `x0 = box.vertices[0].x / pageWidth`, `y0 = box.vertices[0].y / pageHeight`
- Extract `x1`, `y1` from bottom-right vertex

**From Document AI**:

- Document AI provides normalized coordinates directly in most cases
- Verify range [0, 1], clamp if necessary
- If absolute coordinates provided, normalize using page dimensions

**Edge Cases**:

- Missing bounding box: Use default {0, 0, 1, 1} (covers entire page)
- Invalid coordinates: Clamp to [0, 1] range
- Zero-area boxes: Preserve but flag for alignment logic to handle

---

## 3. Vision AI Adapter Specification

### File

`src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts`

### Class Definition

```typescript
class GcpVisionAiAdapter implements OcrServicePort
```

### Behavior Specification

**Request Routing by MIME Type**:

1. **Images (PNG, JPG, WEBP)** - Synchronous processing:

   - Use `ImageAnnotatorClient.annotateImage()`
   - Request: `{ image: { source: { gcsImageUri } }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }`
   - Extract `fullTextAnnotation.text` and structure

2. **PDF/TIFF** - Asynchronous batch processing:

   - Use `ImageAnnotatorClient.asyncBatchAnnotateFiles()`
   - Input config: `{ gcsSource: { uri }, mimeType }`
   - Output config: `{ gcsDestination: { uri: outputGcsUri } }`
   - Request: `{ inputConfigs, outputConfig, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }`
   - Poll operation until complete
   - Read results from GCS output location

### Vision Async Output Contract

**Configuration**:

- `DOC_PROCESSING_VISION_ASYNC_OUTPUT_BUCKET`: GCS bucket name
- `DOC_PROCESSING_VISION_ASYNC_OUTPUT_PREFIX`: Path prefix (default: 'vision-ocr-output/')

**Output Location Pattern**:

```
gs://{bucket}/{prefix}/{documentId}/{runId}/
```

Where:

- `documentId`: Extracted from input GCS URI or passed as parameter
- `runId`: Timestamp or UUID for uniqueness

**File Reading Rules**:

- Look for JSON files in output directory (pattern: `*.json`, exclude `operation.json`)
- Parse first result file found
- Extract `fullTextAnnotation` from parsed JSON
- Map to `OcrResult` interface

**Error Handling**:

- No silent failures: All errors must be typed and thrown
- Timeout handling: Set maximum wait time for batch operations
- GCS read failures: Provide clear error messages
- HIPAA compliance: No PHI in error logs

---

## 4. Hierarchical Alignment and Merge Service

### File

`src/document-processing/utils/ocr-merge.service.ts`

### Service Interface

```typescript
class OcrMergeService {
  async mergeOcrResults(
    visionResult: OcrResult,
    documentAiResult: OcrResult,
    options?: { 
      enablePostProcessing?: boolean;
      minAgreement?: number;  // Override default MIN_AGREEMENT if needed
    }
  ): Promise<OcrResult>;  // Returns standard OcrResult, text field contains merged result
}
```

### Merge Algorithm Specification

#### Step 1: Page-Level Segmentation

- Extract pages from both OCR results
- Match pages by index (page 0 ↔ page 0, page 1 ↔ page 1, etc.)
- Process each page pair independently

#### Step 2: Line Extraction and Pairing

For each page:

1. **Extract lines** using `extractLinesWithBoundingBoxes()`:

   - Document AI: Use layout structure (pages → paragraphs → lines) with bounding boxes
   - Vision AI: Reconstruct lines from words/blocks using bounding boxes + Y-coordinate sorting

2. **Pair lines** using two methods in order:

**Method 1: Bounding Box Overlap (Primary)**

   - Calculate vertical overlap: `overlap = min(y1_end, y2_end) - max(y1_start, y2_start)`
   - Calculate overlap ratio: `overlapRatio = overlap / max(line1_height, line2_height)`
   - If `overlapRatio >= LINE_VERTICAL_OVERLAP_MIN` (0.5): Pair lines

**Method 2: Text Similarity (Fallback)**

   - For unmatched lines, calculate edit distance to nearby lines (within `SIMILARITY_WINDOW` of 5 lines)
   - Calculate similarity: `similarity = 1 - (editDistance / max(len1, len2))`
   - If `similarity >= SIMILARITY_MIN` (0.7): Pair lines

3. **Track pairing metadata**:

   - Which method succeeded (bounding box or similarity)
   - Similarity score if using fallback method

#### Step 3: Word/Character Alignment (within matched lines only)

For each paired line:

1. **Word-level alignment** (fast, handles most cases):

   - Split line into words (whitespace-separated)
   - Align words using greedy matching or edit distance
   - Handle word insertions/deletions

2. **Character-level alignment** (only for mismatched word pairs):

   - Perform character-level alignment ONLY within word pairs that don't match
   - Use edit distance or simple character-by-character comparison
   - **DO NOT** perform character-level alignment on entire document or entire line

#### Step 4: Evidence-Based Voting

**Line Agreement Calculation**:

```typescript
lineAgreement = 1 - normalizedEditDistance(lineA, lineB)
// where normalizedEditDistance = editDistance(lineA, lineB) / max(lineA.length, lineB.length)
```

**Deterministic Line Winner Rule** (prevents Frankenstein lines):

If `lineAgreement < LINE_MIX_THRESHOLD` (0.55):

- **DO NOT mix** lines character-by-character
- Choose the single best whole line (Vision or Document AI) based on scoring:
  ```typescript
  lineScore = validationScore(text) + ocrNoiseScore(text) + (lineConfidence || 0.5)
  ```

  - `validationScore`: Format validation (dates, phone numbers, medical codes)
  - `ocrNoiseScore`: Penalize weird characters, OCR confusion patterns (I/l/1, O/0, rn/m)
  - `lineConfidence`: Engine-provided confidence if available
- Winner: Engine with higher `lineScore`
- Set `wholeLineChosen: true` in metadata

If `lineAgreement >= LINE_MIX_THRESHOLD` (0.55):

- Proceed with per-word/character voting (below)

**Per-Word/Character Voting** (for high-agreement lines):

For each aligned position, apply rules in order:

1. **Agreement Wins**: If both engines agree → keep character (highest confidence)

2. **If Disagreement**:

   - Apply validation heuristics:
     - Fewer weird characters (, excessive punctuation)
     - Fewer OCR-likely confusions (I|l|1, O|0, rn|m)
     - Dictionary/regex validation for patterns (dates: `/\d{1,2}\/\d{1,2}\/\d{4}/`, phones: `/\d{3}-\d{3}-\d{4}/`, medical codes)
   - If both plausible: Prefer engine with better line-level confidence (if available)
   - Else: Choose based on validation heuristic score

#### Step 5: Confidence Scoring

**Document Agreement Score** (precisely defined):

```typescript
docAgreement = weightedAverage(
  lineAgreement for each line,
  weight = max(lineA.length, lineB.length)
)
```

**Per-Line Confidence**:

- If whole line chosen: `lineConfidence = validationScore + ocrNoiseScore + (engineConfidence || 0.5)`
- If line mixed: `lineConfidence = lineAgreement * 0.7 + validationScore * 0.3`

**Overall Confidence**:

```typescript
overallConfidence = sum(lineConfidence * lineLength) / sum(lineLength)
```

#### Step 6: Merge Threshold Behavior

**Low Agreement Handling**:

If `docAgreement < DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT` (0.7):

- **Default behavior**: Return best single-engine result
  - Compare Vision and Document AI results
  - Choose based on: overall confidence, validation scores, OCR noise scores
  - Set `processingMethod = OCR_VISION_SYNC` or `OCR_SYNC`/`OCR_BATCH`
  - Log warning with agreement rate

- **Configurable override**: If `DOC_PROCESSING_OCR_MERGE_FORCE_MERGE_ON_LOW_AGREEMENT = true`:
  - Still return merged result
  - Set `lowAgreementFlag = true` in metadata
  - Log warning with agreement rate

**Output**: Standard `OcrResult` with:

- `text`: Merged final text (primary field)
- `confidence`: Overall confidence score
- `fullResponse`: Merge metadata (see below)

---

## 5. Merged Result Output Contract

### Output Structure

The merged result must implement the standard `OcrResult` interface with the following structure:

```typescript
interface MergedOcrResult extends OcrResult {
  text: string;                    // Merged final text (PRIMARY OUTPUT - consumers use this)
  confidence: number;              // Overall confidence (weighted by line length)
  pageCount: number;
  entities?: ExtractedEntity[];    // Merged/extracted entities
  fullResponse: {
    engine: 'merged';
    sources: {
      vision?: {
        text?: string;             // Only if DEBUG_OCR_STORE_SOURCES=true
        textHash?: string;         // SHA256 hash of source text
        textExcerpt?: string;      // First 100 characters for debugging
        confidence?: number;
        agreementScore?: number;
      };
      documentAi?: {
        text?: string;             // Only if DEBUG_OCR_STORE_SOURCES=true
        textHash?: string;         // SHA256 hash of source text
        textExcerpt?: string;      // First 100 characters for debugging
        confidence?: number;
        agreementScore?: number;
      };
    };
    mergeMetadata: {
      docAgreement: number;        // Document-level agreement (weighted average)
      lineAgreementThreshold: number;  // LINE_MIX_THRESHOLD used
      linePairingSuccessRate: number;  // % of lines successfully paired
      averageLineConfidence: number;   // Average confidence across all lines
      lowAgreementFlag: boolean;       // True if docAgreement < MIN_AGREEMENT
      perLineConfidence: Array<{
        lineIndex: number;
        confidence: number;
        lineAgreement: number;         // Line-level agreement score
        winningEngine?: 'vision' | 'documentAi' | 'merged';  // Which engine won
        wholeLineChosen?: boolean;     // True if entire line chosen (low agreement)
        engineContributions?: {        // Contribution percentages
          vision?: number;
          documentAi?: number;
        };
      }>;
      postProcessingCorrections?: Array<{  // Step 5 results (if enabled)
        original: string;
        corrected: string;
        confidence: number;
        correctionType: 'lexical' | 'regex' | 'format' | 'context';
        position: { start: number; end: number };
      }>;
      qualityImprovementScore?: number;  // Overall quality improvement from post-processing
    };
  };
}
```

### PHI-Safe Source Storage Rule

**Default Behavior** (HIPAA-compliant):

- Store source texts: **NO** (full texts not stored)
- Store text hashes: **YES** (SHA256 hashes for verification)
- Store text excerpts: **YES** (first 100 characters for debugging)

**Debug Mode** (`DEBUG_OCR_STORE_SOURCES = true`):

- Store source texts: **YES** (full texts stored in `sources.vision.text` and `sources.documentAi.text`)
- **Warning**: Only enable in development/debugging environments
- **Production**: Always keep `DEBUG_OCR_STORE_SOURCES = false`

**Rationale**: Storing full source texts expands PHI surface area and increases storage costs. Hashes + excerpts provide debugging capability without exposing full PHI.

---

## 6. Post-Processing Service Specification

### File

`src/document-processing/utils/ocr-post-processor.service.ts`

### Service Interface

```typescript
class OcrPostProcessorService {
  async postProcessMergedText(
    text: string,
    metadata: MergeMetadata
  ): Promise<PostProcessedResult>;
}
```

### Input

- `text`: Merged text to post-process
- `metadata`: Merge metadata (agreement rates, line confidences, etc.)

### Processing Components

1. **Language Model Scoring / Lexical Filtering** (optional):

   - Use lightweight language model or dictionary lookup
   - Score word/phrase likelihood
   - Flag suspicious OCR artifacts (nonsense words, excessive punctuation)
   - Only if `DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM = true`

2. **Regex Corrections**:

   - Fix common OCR character confusions (I→l, O→0, rn→m)
   - Validate and correct formats:
     - Dates: Normalize date formats
     - Phone numbers: Standardize phone number formats
     - Medical codes: Validate ICD/MRN patterns
     - Addresses: Standardize address formats
   - Only if `DOC_PROCESSING_OCR_POST_PROCESSING_USE_REGEX = true`

3. **Grammar/Context Validation**:

   - Fix common OCR errors using context (e.g., "teh" → "the")
   - Use context-aware corrections (nearby words help disambiguate)
   - Only if `DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM = true`

### Output

```typescript
interface PostProcessedResult {
  text: string;                    // Corrected text
  corrections: Array<{
    original: string;
    corrected: string;
    confidence: number;            // Confidence in correction (0-1)
    correctionType: 'lexical' | 'regex' | 'format' | 'context';
    position: { start: number; end: number };
  }>;
  qualityScore: number;            // Overall quality improvement score (0-1)
}
```

### Configuration Flags

- `DOC_PROCESSING_OCR_POST_PROCESSING_ENABLED`: Enable/disable post-processing (default: false)
- `DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM`: Enable language model scoring (default: false)
- `DOC_PROCESSING_OCR_POST_PROCESSING_USE_REGEX`: Enable regex corrections (default: true)
- `DOC_PROCESSING_OCR_POST_PROCESSING_CONFIDENCE_THRESHOLD`: Only apply corrections above threshold (default: 0.8)

### Integration

Post-processing is **optional** and applied only if:

1. `DOC_PROCESSING_OCR_POST_PROCESSING_ENABLED = true`
2. Called from merge service after merge completes
3. Results appended to `mergeMetadata.postProcessingCorrections`

---

## 7. Failure and Fallback Rules

### OCR Engine Failures

**One OCR fails completely**:

- Use the other OCR result
- Set `processingMethod` to single-engine method (`OCR_VISION_SYNC` or `OCR_SYNC`/`OCR_BATCH`)
- Log warning with error details (no PHI)

**Both OCRs fail**:

- Throw error: `new Error('Both OCR engines failed')`
- Document processing fails, status set to `FAILED`
- Error message sanitized (no PHI)

### Merge Operation Failures

**Line pairing fails** (no lines can be paired):

- Use better single-engine result based on confidence scores
- Log warning with pairing failure rate
- Set `processingMethod` to single-engine method

**Alignment fails** (within a line):

- Use better result for that line (based on validation scores)
- Continue processing other lines
- Track failed lines in metadata

**Low overall agreement** (`docAgreement < MIN_AGREEMENT`):

- **Default**: Return best single-engine result (see Step 6 above)
- **Override**: If `DOC_PROCESSING_OCR_MERGE_FORCE_MERGE_ON_LOW_AGREEMENT = true`, return merged result with `lowAgreementFlag = true`

### Post-Processing Failures

**Post-processing fails**:

- Log warning
- Return original merged text (without corrections)
- Do not fail entire merge operation

---

## 8. Configuration Contract

### Environment Variables

**Merge Configuration**:

```typescript
DOC_PROCESSING_OCR_MERGE_ENABLED: boolean = true;              // Enable/disable merge mode
DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT: number = 0.7;          // Minimum docAgreement to consider merge successful
DOC_PROCESSING_OCR_MERGE_FORCE_MERGE_ON_LOW_AGREEMENT: boolean = false;  // Force merge even if agreement < MIN_AGREEMENT
```

**Vision AI Configuration**:

```typescript
DOC_PROCESSING_VISION_ASYNC_OUTPUT_BUCKET: string;            // GCS bucket for async batch output (required)
DOC_PROCESSING_VISION_ASYNC_OUTPUT_PREFIX: string = 'vision-ocr-output/';  // Path prefix
```

**Post-Processing Configuration**:

```typescript
DOC_PROCESSING_OCR_POST_PROCESSING_ENABLED: boolean = false;   // Enable post-processing (default: disabled)
DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM: boolean = false;    // Enable language model scoring
DOC_PROCESSING_OCR_POST_PROCESSING_USE_REGEX: boolean = true;  // Enable regex corrections
DOC_PROCESSING_OCR_POST_PROCESSING_CONFIDENCE_THRESHOLD: number = 0.8;  // Minimum confidence for corrections
```

**Debug/Security Configuration**:

```typescript
DEBUG_OCR_STORE_SOURCES: boolean = false;  // Store full source texts in fullResponse (default: false for PHI safety)
```

### Configuration Validation

- All numeric thresholds must be in range [0, 1]
- Bucket names must be valid GCS bucket identifiers
- Prefixes must end with `/` if non-empty
- Boolean flags must be valid boolean values

### Configuration Structure

Update `DocumentProcessingConfig` type:

```typescript
export type DocumentProcessingConfig = {
  // ... existing fields
  ocrMerge: {
    enabled: boolean;
    minAgreement: number;
    forceMergeOnLowAgreement: boolean;
    lineMixThreshold: number;  // LINE_MIX_THRESHOLD
  };
  ocrPostProcessing: {
    enabled: boolean;
    useLanguageModel: boolean;
    useRegex: boolean;
    confidenceThreshold: number;
  };
  gcp: {
    // ... existing fields
    visionAi: {
      asyncOutputBucket: string;
      asyncOutputPrefix: string;
    };
  };
  debug: {
    storeOcrSources: boolean;  // DEBUG_OCR_STORE_SOURCES
  };
};
```

---

## 9. Domain Service Integration

### File

`src/document-processing/domain/services/document-processing.domain.service.ts`

### Integration Logic

**Parallel Execution**:

```typescript
// Run both OCRs in parallel
const [visionResult, documentAiResult] = await Promise.allSettled([
  this.visionOcrService.processDocument(gcsUri, mimeType, pageCount),
  this.documentAiOcrService.processDocument(gcsUri, mimeType, pageCount),
]);
```

**Result Handling**:

- Extract fulfilled results from `Promise.allSettled` responses
- Handle rejections with warnings (no PHI in logs)

**Merge Execution**:

```typescript
if (visionOcrResult && documentAiOcrResult && mergeEnabled) {
  ocrResult = await this.ocrMergeService.mergeOcrResults(
    visionOcrResult,
    documentAiOcrResult,
    { enablePostProcessing: postProcessingEnabled }
  );
  processingMethod = ProcessingMethod.OCR_MERGED;
} else if (visionOcrResult) {
  ocrResult = visionOcrResult;
  processingMethod = ProcessingMethod.OCR_VISION_SYNC;
} else if (documentAiOcrResult) {
  ocrResult = documentAiOcrResult;
  processingMethod = pageCount && pageCount <= 15 ? ProcessingMethod.OCR_SYNC : ProcessingMethod.OCR_BATCH;
} else {
  throw new Error('Both OCR engines failed');
}
```

**Dependency Injection**:

```typescript
constructor(
  // ... existing dependencies
  @Inject('VisionOcrServicePort')
  private readonly visionOcrService: OcrServicePort,
  @Inject('DocumentAiOcrServicePort')
  private readonly documentAiOcrService: OcrServicePort,
  private readonly ocrMergeService: OcrMergeService,
  private readonly ocrPostProcessorService?: OcrPostProcessorService,  // Optional
)
```

---

## 10. Processing Method Enum Updates

### File

`src/document-processing/domain/enums/processing-method.enum.ts`

### Updated Enum

```typescript
export enum ProcessingMethod {
  NONE = 'NONE',
  DIRECT_EXTRACTION = 'DIRECT_EXTRACTION',
  OCR_SYNC = 'OCR_SYNC',              // Document AI sync (existing)
  OCR_BATCH = 'OCR_BATCH',            // Document AI batch (existing)
  OCR_VISION_SYNC = 'OCR_VISION_SYNC', // Vision AI only (fallback)
  OCR_MERGED = 'OCR_MERGED',          // Merged Vision + Document AI (new)
}
```

---

## 11. Quality Metrics Requirements

### Required Metrics in Output

All merged results must include the following metrics in `mergeMetadata`:

1. **agreementRate** (same as `docAgreement`): Document-level agreement score
2. **linePairingSuccessRate**: Percentage of lines successfully paired (bounding box or similarity)
3. **averageLineConfidence**: Average confidence across all lines (weighted by line length)
4. **lowAgreementFlag**: Boolean indicating if `docAgreement < MIN_AGREEMENT`

### Metric Calculation

```typescript
// Line pairing success rate
linePairingSuccessRate = (successfullyPairedLines / totalLines) * 100

// Average line confidence
averageLineConfidence = sum(lineConfidence * lineLength) / sum(lineLength)

// Low agreement flag
lowAgreementFlag = docAgreement < DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT
```

### Monitoring Integration

These metrics should be:

- Logged (without PHI) for monitoring
- Stored in database (if metadata stored)
- Exposed via API response (in `fullResponse.mergeMetadata`)
- Tracked for alerting (if `lowAgreementFlag = true` frequently)

---

## 12. Module Configuration Updates

### File

`src/document-processing/document-processing.module.ts`

### Provider Updates

```typescript
providers: [
  // ... existing providers
  
  // OCR adapters
  GcpVisionAiAdapter,
  GcpDocumentAiAdapter,
  
  // OCR service ports
  {
    provide: 'VisionOcrServicePort',
    useClass: GcpVisionAiAdapter,
  },
  {
    provide: 'DocumentAiOcrServicePort',
    useClass: GcpDocumentAiAdapter,
  },
  
  // Merge and post-processing services
  OcrMergeService,
  OcrPostProcessorService,  // Optional, only if post-processing enabled
  
  // Keep backward compatibility
  {
    provide: 'OcrServicePort',
    useClass: GcpDocumentAiAdapter,  // Default for backward compat
  },
]
```

---

## 13. Testing Requirements

### Unit Tests

**Vision Adapter Tests** (`gcp-vision-ai.adapter.spec.ts`):

- Test sync processing for images (PNG, JPG, WEBP)
- Test async batch processing for PDF/TIFF
- Test MIME type routing
- Test error handling (API failures, GCS read failures)
- Mock Vision API responses

**Line Extraction Tests** (`ocr-alignment.spec.ts`):

- Test line extraction from Vision AI response
- Test line extraction from Document AI response
- Test bounding box normalization (absolute → normalized)
- Test handling of missing bounding boxes
- Test coordinate clamping to [0, 1]

**Merge Service Tests** (`ocr-merge.service.spec.ts`):

- Test line pairing (bounding box overlap)
- Test line pairing fallback (text similarity)
- Test line winner rule (low agreement lines)
- Test per-word/character voting (high agreement lines)
- Test agreement score calculation (line and document level)
- Test low agreement fallback behavior
- Test graceful degradation when one OCR fails

**Post-Processor Tests** (`ocr-post-processor.service.spec.ts`):

- Test regex corrections (OCR confusion patterns)
- Test format validation (dates, phones, medical codes)
- Test language model scoring (if enabled)
- Test confidence threshold filtering

### Integration Tests

- End-to-end: Upload document → parallel OCR → merge → verify merged result
- Compare merged results against single OCR results (quality validation)
- Test graceful degradation scenarios (one OCR fails)
- Test low agreement scenarios (fallback to single engine)
- Test post-processing integration (if enabled)

### Performance Tests

- Measure merge processing time vs single OCR
- Validate that merge time < sequential fallback time
- Test with various document sizes (1 page, 10 pages, 100 pages)

---

## 14. Success Criteria

1. ✅ Both OCRs execute in parallel successfully
2. ✅ Merge produces higher-quality results than single OCR (validated via metrics)
3. ✅ Document agreement (`docAgreement`) > 0.7 on typical documents
4. ✅ Line winner rule prevents Frankenstein lines (low agreement lines chosen whole)
5. ✅ Processing time < sequential fallback time
6. ✅ Graceful degradation when one OCR fails
7. ✅ Source text storage secure by default (hashes + excerpts, not full texts)
8. ✅ Vision async output properly configured and accessible
9. ✅ HIPAA compliance maintained (no PHI in logs, secure storage)
10. ✅ Comprehensive test coverage (>80%)

---

## 15. Implementation Phases

### Phase 1: Foundation (Week 1)

1. Install dependencies (@google-cloud/vision)
2. Create Vision AI adapter (sync + async batch)
3. Create line extraction utility with bounding box normalization
4. Create merge service skeleton

### Phase 2: Merge Implementation (Week 1-2)

1. Implement hierarchical alignment (page → line → word)
2. Implement line pairing (bounding box + similarity fallback)
3. Implement line winner rule (prevent Frankenstein lines)
4. Implement evidence-based voting with validation heuristics
5. Implement confidence scoring (precise agreement formulas)
6. Implement low agreement fallback behavior
7. Unit tests for merge service

### Phase 3: Integration (Week 2)

1. Update domain service for parallel execution
2. Update module configuration
3. Add processing method enum values
4. Integration tests

### Phase 4: Post-Processing and Refinement (Week 2-3)

1. Implement post-processing service
2. Integrate post-processing with merge service
3. Error handling improvements
4. Performance optimization
5. Documentation

### Phase 5: Production Readiness (Week 3)

1. Monitoring and metrics implementation
2. Feature flag testing
3. Cost analysis and optimization
4. Final testing and validation
5. Production deployment plan

---

## 16. Key Design Decisions

1. **Hierarchical Alignment**: Page → Line → Word (NOT full-document character alignment)
2. **Line Winner Rule**: Prevents Frankenstein lines by choosing whole best line when agreement < 0.55
3. **Precise Agreement Metrics**: `lineAgreement = 1 - normalizedEditDistance`, `docAgreement = weightedAverage`
4. **PHI-Safe Storage**: Full source texts only under debug flag, hashes + excerpts by default
5. **Graceful Degradation**: Robust fallback to single-engine result when merge fails or agreement low
6. **Evidence-Based Voting**: Structural + similarity + validation heuristics (not just confidence)
7. **Optional Post-Processing**: Configurable refinement layer for additional quality improvement
8. **Backward Compatibility**: Keep existing `OcrServicePort` interface, add new adapters

---

This design specification provides a complete blueprint for implementing the Parallel OCR Merge Architecture with all required contracts, constants, behaviors, and quality metrics explicitly defined.