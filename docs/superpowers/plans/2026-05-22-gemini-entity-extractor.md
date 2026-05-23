# Gemini Entity Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the regex entity extractor with a Vertex AI Gemini structured-output extractor so the at-a-glance dashboard populates for real uploads.

**Architecture:** A new `GeminiEntityExtractorService` calls Vertex AI Gemini once on the OCR text, wired in at a single chokepoint inside `extractAndSaveFields`. The regex `text-entity-extractor.ts` and its 5 call sites are removed.

**Tech Stack:** NestJS · TypeScript · Jest · `@google-cloud/vertexai` (new) · Vertex AI Gemini `gemini-2.5-flash` · GCP Application Default Credentials.

**Spec:** [`../specs/2026-05-21-gemini-entity-extractor-design.md`](../specs/2026-05-21-gemini-entity-extractor-design.md)

---

## File map

**Create:**
- `src/document-processing/infrastructure/extraction/gemini-entity-extractor.types.ts`
- `src/document-processing/infrastructure/extraction/gemini-response-mapper.ts`
- `src/document-processing/infrastructure/extraction/gemini-response-mapper.spec.ts`
- `src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.ts`
- `src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.spec.ts`

**Modify:**
- `package.json` — add `@google-cloud/vertexai` dependency
- `src/document-processing/config/document-processing-config.type.ts` — extend `gcp` with `vertexAi` section
- `src/document-processing/config/document-processing.config.ts` — validate + read the new env vars
- `env-example-relational` — document the new env vars
- `src/document-processing/document-processing.module.ts` — register the new provider
- `src/document-processing/domain/services/document-processing.domain.service.ts` — inject the service, replace the entities source inside `extractAndSaveFields`, drop the regex import + the 2 direct calls
- `src/document-processing/infrastructure/ocr/gcp-document-ai.adapter.ts` — drop the regex import + 1 call
- `src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts` — drop the regex import + 2 calls

**Delete:**
- `src/document-processing/utils/text-entity-extractor.ts`

---

## Task 1: Add Vertex AI SDK + config plumbing

Adds the new dependency, two env vars, the config-type entry, the validator, and an env-example block. No application logic yet; just plumbing so later tasks can inject config.

**Files:**
- Modify: `package.json`
- Modify: `src/document-processing/config/document-processing-config.type.ts`
- Modify: `src/document-processing/config/document-processing.config.ts`
- Modify: `env-example-relational`

- [ ] **Step 1: Install the Vertex AI SDK**

Run from the repo root:

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
npm install @google-cloud/vertexai
```

Expected: `package.json` and `package-lock.json` updated, no install errors. `@google-cloud/vertexai` appears in `dependencies` (npm will pin a recent 1.x version with `^` semver in package.json).

- [ ] **Step 2: Extend the document-processing config type**

In `src/document-processing/config/document-processing-config.type.ts`, find the `gcp:` block (currently has `projectId`, `documentAi`, `visionAi`, `storage`). Add a `vertexAi` sibling:

```ts
  gcp: {
    projectId: string;
    documentAi: {
      location: string;
      processorId: string;
      outputBucket: string;
    };
    visionAi: {
      asyncOutputPrefix: string;
    };
    vertexAi: {
      location: string;
      modelName: string;
    };
    storage: {
      bucket: string;
      rawPrefix: string;
      processedPrefix: string;
    };
  };
```

- [ ] **Step 3: Add the env-var validator fields**

In `src/document-processing/config/document-processing.config.ts`, inside `class EnvironmentVariablesValidator`, add the two fields next to the existing GCP entries:

```ts
  @IsString()
  DOC_PROCESSING_VERTEX_AI_LOCATION: string = 'us-central1';

  @IsString()
  DOC_PROCESSING_GEMINI_MODEL: string = 'gemini-2.5-flash';
```

- [ ] **Step 4: Read the env vars in the `plainToClass` block**

In the same file, find the `plainToClass(EnvironmentVariablesValidator, {...})` literal. Add these two keys next to the existing `DOC_PROCESSING_GCP_*` entries:

```ts
        DOC_PROCESSING_VERTEX_AI_LOCATION:
          process.env.DOC_PROCESSING_VERTEX_AI_LOCATION || 'us-central1',
        DOC_PROCESSING_GEMINI_MODEL:
          process.env.DOC_PROCESSING_GEMINI_MODEL || 'gemini-2.5-flash',
```

- [ ] **Step 5: Map the validated values onto the returned `gcp.vertexAi` section**

In the same file, find the `return { ... gcp: { ... } ... }` literal. Add a `vertexAi` block next to `documentAi` / `visionAi`:

```ts
        vertexAi: {
          location: validatedConfig.DOC_PROCESSING_VERTEX_AI_LOCATION,
          modelName: validatedConfig.DOC_PROCESSING_GEMINI_MODEL,
        },
```

- [ ] **Step 6: Add env-example entries**

In `env-example-relational`, find the `DOC_PROCESSING_GCP_LOCATION=us...` line. Below the existing GCP block, add a new section:

```
# Vertex AI (entity extraction over OCR text)
DOC_PROCESSING_VERTEX_AI_LOCATION=us-central1
# ^ Region for Vertex AI Gemini calls. Common: us-central1, us-east4, europe-west4.
DOC_PROCESSING_GEMINI_MODEL=gemini-2.5-flash
# ^ Vertex AI model. gemini-2.5-flash is the default — fast, cheap, sufficient for entity extraction.
```

- [ ] **Step 7: Verify the build still compiles**

Run:

```bash
npm run build
```

Expected: `nest build` succeeds with no TypeScript errors. The new fields are type-checked.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json \
  src/document-processing/config/document-processing-config.type.ts \
  src/document-processing/config/document-processing.config.ts \
  env-example-relational
git commit -m "feat(extraction): add @google-cloud/vertexai dep and config plumbing"
```

---

## Task 2: Define types for the new extractor module

A small types file that future tasks import from. Defines the `ExtractedEntity` shape returned by the new service, the at-a-glance `field_key` literal, and the Gemini response JSON shape.

**Files:**
- Create: `src/document-processing/infrastructure/extraction/gemini-entity-extractor.types.ts`

- [ ] **Step 1: Create the types file**

```ts
/**
 * Types for the Gemini entity extractor.
 *
 * The Gemini call returns JSON shaped by `GeminiExtractionResponse`. The mapper
 * flattens that into `ExtractedEntity[]` whose `type` values match keys in
 * `at-a-glance/utils/field-category-map.ts`. The extracted_fields rows the
 * domain service writes from these entities therefore land in real at-a-glance
 * categories instead of the previous regex extractor's UNCATEGORIZED bucket.
 */

/** field_key values the extractor emits. Each matches an at-a-glance category map key. */
export type ExtractedEntityType =
  | 'medication'
  | 'allergy'
  | 'condition'
  | 'doctor'
  | 'pharmacy'
  | 'insurance'
  | 'policy_number'
  | 'emergency_contact'
  | 'blood_type';

/** Shape consumed by `extractAndSaveFields` in the domain service. */
export interface ExtractedEntity {
  type: ExtractedEntityType;
  mentionText: string;
  confidence: number;
  startOffset?: number;
  endOffset?: number;
}

/** Raw JSON Gemini returns when given the response schema in the extractor service. */
export interface GeminiExtractionResponse {
  medications: string[];
  allergies: string[];
  conditions: string[];
  doctors: string[];
  pharmacies: string[];
  insurance_providers: string[];
  policy_numbers: string[];
  emergency_contacts: string[];
  blood_type: string | null;
}
```

- [ ] **Step 2: Verify the file compiles in isolation**

Run:

```bash
npm run build
```

Expected: succeeds. The file is not imported anywhere yet; we are just confirming syntax.

- [ ] **Step 3: Commit**

```bash
git add src/document-processing/infrastructure/extraction/gemini-entity-extractor.types.ts
git commit -m "feat(extraction): add Gemini extractor type definitions"
```

---

## Task 3: Pure mapper from Gemini JSON to ExtractedEntity[] (TDD)

The deterministic core of the service. Pure function, fully unit-testable. Built test-first.

**Files:**
- Create: `src/document-processing/infrastructure/extraction/gemini-response-mapper.spec.ts`
- Create: `src/document-processing/infrastructure/extraction/gemini-response-mapper.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/document-processing/infrastructure/extraction/gemini-response-mapper.spec.ts`:

```ts
import { mapGeminiResponseToEntities } from './gemini-response-mapper';
import { GeminiExtractionResponse } from './gemini-entity-extractor.types';

const empty: GeminiExtractionResponse = {
  medications: [],
  allergies: [],
  conditions: [],
  doctors: [],
  pharmacies: [],
  insurance_providers: [],
  policy_numbers: [],
  emergency_contacts: [],
  blood_type: null,
};

describe('mapGeminiResponseToEntities', () => {
  it('returns an empty array for an all-empty response', () => {
    expect(mapGeminiResponseToEntities(empty)).toEqual([]);
  });

  it('maps medications to type "medication" with confidence 0.9', () => {
    const result = mapGeminiResponseToEntities({
      ...empty,
      medications: ['Lisinopril 10mg daily', 'Metformin 500mg'],
    });
    expect(result).toEqual([
      { type: 'medication', mentionText: 'Lisinopril 10mg daily', confidence: 0.9 },
      { type: 'medication', mentionText: 'Metformin 500mg', confidence: 0.9 },
    ]);
  });

  it('maps every populated category to its corresponding entity type', () => {
    const result = mapGeminiResponseToEntities({
      medications: ['med1'],
      allergies: ['Penicillin'],
      conditions: ['Hypertension'],
      doctors: ['Dr. Smith'],
      pharmacies: ['CVS'],
      insurance_providers: ['BCBS'],
      policy_numbers: ['BCBS-12345'],
      emergency_contacts: ['John Doe 555-0123'],
      blood_type: 'O+',
    });
    const types = result.map((e) => e.type).sort();
    expect(types).toEqual([
      'allergy',
      'blood_type',
      'condition',
      'doctor',
      'emergency_contact',
      'insurance',
      'medication',
      'pharmacy',
      'policy_number',
    ]);
  });

  it('emits a single blood_type entity when blood_type is non-null', () => {
    const result = mapGeminiResponseToEntities({ ...empty, blood_type: 'A-' });
    expect(result).toEqual([
      { type: 'blood_type', mentionText: 'A-', confidence: 0.9 },
    ]);
  });

  it('emits no blood_type entity when blood_type is null', () => {
    const result = mapGeminiResponseToEntities({ ...empty, blood_type: null });
    expect(result.find((e) => e.type === 'blood_type')).toBeUndefined();
  });

  it('skips empty strings and trims whitespace in array values', () => {
    const result = mapGeminiResponseToEntities({
      ...empty,
      medications: ['  Lisinopril  ', '', '   '],
    });
    expect(result).toEqual([
      { type: 'medication', mentionText: 'Lisinopril', confidence: 0.9 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx jest src/document-processing/infrastructure/extraction/gemini-response-mapper.spec.ts
```

Expected: FAIL with `Cannot find module './gemini-response-mapper'` — the implementation does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `src/document-processing/infrastructure/extraction/gemini-response-mapper.ts`:

```ts
import {
  ExtractedEntity,
  ExtractedEntityType,
  GeminiExtractionResponse,
} from './gemini-entity-extractor.types';

const FIXED_CONFIDENCE = 0.9;

interface ArrayCategory {
  field: keyof Omit<GeminiExtractionResponse, 'blood_type'>;
  type: ExtractedEntityType;
}

const ARRAY_CATEGORIES: ArrayCategory[] = [
  { field: 'medications', type: 'medication' },
  { field: 'allergies', type: 'allergy' },
  { field: 'conditions', type: 'condition' },
  { field: 'doctors', type: 'doctor' },
  { field: 'pharmacies', type: 'pharmacy' },
  { field: 'insurance_providers', type: 'insurance' },
  { field: 'policy_numbers', type: 'policy_number' },
  { field: 'emergency_contacts', type: 'emergency_contact' },
];

/**
 * Flatten the Gemini structured response into the ExtractedEntity[] shape that
 * `extractAndSaveFields` consumes. Pure function — no I/O, no side effects.
 *
 * Empty strings (and whitespace-only strings) are dropped so the database is
 * not polluted with blank field_value rows.
 */
export function mapGeminiResponseToEntities(
  response: GeminiExtractionResponse,
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  for (const { field, type } of ARRAY_CATEGORIES) {
    for (const raw of response[field] ?? []) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      entities.push({ type, mentionText: trimmed, confidence: FIXED_CONFIDENCE });
    }
  }

  if (response.blood_type !== null && response.blood_type !== undefined) {
    const trimmed = response.blood_type.trim();
    if (trimmed.length > 0) {
      entities.push({
        type: 'blood_type',
        mentionText: trimmed,
        confidence: FIXED_CONFIDENCE,
      });
    }
  }

  return entities;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx jest src/document-processing/infrastructure/extraction/gemini-response-mapper.spec.ts
```

Expected: PASS, 6/6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/document-processing/infrastructure/extraction/gemini-response-mapper.ts \
  src/document-processing/infrastructure/extraction/gemini-response-mapper.spec.ts
git commit -m "feat(extraction): add Gemini response mapper with tests"
```

---

## Task 4: GeminiEntityExtractorService (TDD)

Wraps the Vertex AI client, sends the prompt + schema, parses the JSON, calls the mapper, and handles failures. Tested with a mocked Vertex client.

**Files:**
- Create: `src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.spec.ts`
- Create: `src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiEntityExtractorService } from './gemini-entity-extractor.service';

// Mock the Vertex AI SDK before importing anything that uses it.
const generateContentMock = jest.fn();
jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: generateContentMock,
    }),
  })),
  SchemaType: {
    OBJECT: 'object',
    ARRAY: 'array',
    STRING: 'string',
  },
}));

function geminiResponse(json: object) {
  return {
    response: {
      candidates: [
        { content: { parts: [{ text: JSON.stringify(json) }] } },
      ],
    },
  };
}

describe('GeminiEntityExtractorService', () => {
  let service: GeminiEntityExtractorService;

  beforeEach(async () => {
    generateContentMock.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiEntityExtractorService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const map: Record<string, string> = {
                'documentProcessing.gcp.projectId': 'test-project',
                'documentProcessing.gcp.vertexAi.location': 'us-central1',
                'documentProcessing.gcp.vertexAi.modelName': 'gemini-2.5-flash',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(GeminiEntityExtractorService);
  });

  it('returns an empty array when OCR text is empty', async () => {
    const result = await service.extractEntities('');
    expect(result).toEqual([]);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('returns an empty array when OCR text is whitespace only', async () => {
    const result = await service.extractEntities('   \n  ');
    expect(result).toEqual([]);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('maps a successful Gemini response into ExtractedEntity[]', async () => {
    generateContentMock.mockResolvedValueOnce(
      geminiResponse({
        medications: ['Lisinopril 10mg'],
        allergies: [],
        conditions: ['Hypertension'],
        doctors: [],
        pharmacies: [],
        insurance_providers: [],
        policy_numbers: [],
        emergency_contacts: [],
        blood_type: 'O+',
      }),
    );

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([
      { type: 'medication', mentionText: 'Lisinopril 10mg', confidence: 0.9 },
      { type: 'condition', mentionText: 'Hypertension', confidence: 0.9 },
      { type: 'blood_type', mentionText: 'O+', confidence: 0.9 },
    ]);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on transient failure then returns mapped entities', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce(
        geminiResponse({
          medications: ['Metformin'],
          allergies: [],
          conditions: [],
          doctors: [],
          pharmacies: [],
          insurance_providers: [],
          policy_numbers: [],
          emergency_contacts: [],
          blood_type: null,
        }),
      );

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([
      { type: 'medication', mentionText: 'Metformin', confidence: 0.9 },
    ]);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array when Gemini keeps failing after retry', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([]);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array when Gemini returns malformed JSON', async () => {
    generateContentMock.mockResolvedValueOnce({
      response: {
        candidates: [
          { content: { parts: [{ text: 'this is not json {{{' }] } },
        ],
      },
    });

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx jest src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.spec.ts
```

Expected: FAIL with `Cannot find module './gemini-entity-extractor.service'`.

- [ ] **Step 3: Write the implementation**

Create `src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VertexAI,
  SchemaType,
  GenerativeModel,
} from '@google-cloud/vertexai';
import { AllConfigType } from '../../../config/config.type';
import { mapGeminiResponseToEntities } from './gemini-response-mapper';
import {
  ExtractedEntity,
  GeminiExtractionResponse,
} from './gemini-entity-extractor.types';

const MIN_OCR_LENGTH = 1; // skip the LLM call below this; >0 means non-empty after trim.
const FIXED_TEMPERATURE = 0;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    medications: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    allergies: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    conditions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    doctors: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    pharmacies: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    insurance_providers: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    policy_numbers: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    emergency_contacts: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    blood_type: { type: SchemaType.STRING, nullable: true },
  },
  required: [
    'medications',
    'allergies',
    'conditions',
    'doctors',
    'pharmacies',
    'insurance_providers',
    'policy_numbers',
    'emergency_contacts',
  ],
};

const SYSTEM_PROMPT = `You extract structured medical information from the text of a medical document.

Rules:
- Extract only information explicitly present in the document text. Never infer, guess, or invent.
- If a category has no information in the text, return an empty array (or null for blood_type).
- Preserve original wording — for example, a medication with its dose as written.
- Doctors should be returned with title and name as written (e.g. "Dr. Sarah Smith, MD").
- Insurance providers are the carriers (e.g. "Blue Cross Blue Shield"). Policy numbers are the identifiers (e.g. "BCBS-12345-67890").
- Emergency contacts should include name, relationship if available, and phone number.
- Blood type should be a single short string like "O+" or "A-" if explicitly stated, otherwise null.

Return JSON matching the provided schema.`;

/**
 * Calls Vertex AI Gemini to extract structured medical entities from OCR text.
 *
 * Authentication uses the Cloud Run service account via Application Default
 * Credentials — no API key is required. The service account needs
 * `roles/aiplatform.user` on the project.
 *
 * Failure modes (see spec section "Failure modes"):
 *   - Empty/whitespace OCR text → return [] without calling Gemini.
 *   - Network/quota failure → retry once, then return [] on continued failure.
 *   - Malformed JSON → catch parse error, return [].
 *
 * In every failure mode the caller still completes successfully with zero
 * extracted entities; the document reaches PROCESSED with an empty
 * at-a-glance for that doc.
 *
 * HIPAA-safe logging: counts and types only, never field_value contents.
 */
@Injectable()
export class GeminiEntityExtractorService {
  private readonly logger = new Logger(GeminiEntityExtractorService.name);
  private readonly model: GenerativeModel;
  private readonly modelName: string;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    const projectId = this.configService.getOrThrow(
      'documentProcessing.gcp.projectId',
      { infer: true },
    );
    const location = this.configService.getOrThrow(
      'documentProcessing.gcp.vertexAi.location',
      { infer: true },
    );
    this.modelName = this.configService.getOrThrow(
      'documentProcessing.gcp.vertexAi.modelName',
      { infer: true },
    );

    const vertexAi = new VertexAI({ project: projectId, location });
    this.model = vertexAi.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: FIXED_TEMPERATURE,
      },
    });

    this.logger.log(
      `Gemini entity extractor initialized (model=${this.modelName}, location=${location})`,
    );
  }

  async extractEntities(ocrText: string): Promise<ExtractedEntity[]> {
    const trimmed = ocrText?.trim() ?? '';
    if (trimmed.length < MIN_OCR_LENGTH) {
      this.logger.debug(
        '[GEMINI EXTRACTOR] OCR text is empty; skipping Gemini call',
      );
      return [];
    }

    const json = await this.callGeminiWithRetry(trimmed);
    if (json === null) return [];

    const entities = mapGeminiResponseToEntities(json);
    this.logger.log(
      `[GEMINI EXTRACTOR] Extracted ${entities.length} entities (${this.summarizeTypes(entities)})`,
    );
    return entities;
  }

  private async callGeminiWithRetry(
    ocrText: string,
  ): Promise<GeminiExtractionResponse | null> {
    try {
      return await this.callGemini(ocrText);
    } catch (firstError) {
      this.logger.warn(
        `[GEMINI EXTRACTOR] First attempt failed (${this.sanitize(firstError)}); retrying once`,
      );
      try {
        return await this.callGemini(ocrText);
      } catch (secondError) {
        this.logger.error(
          `[GEMINI EXTRACTOR] Retry also failed (${this.sanitize(secondError)}); returning empty entities`,
        );
        return null;
      }
    }
  }

  private async callGemini(
    ocrText: string,
  ): Promise<GeminiExtractionResponse | null> {
    const result = await this.model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT },
            { text: `Document text:\n\n${ocrText}` },
          ],
        },
      ],
    });

    const raw = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      this.logger.warn('[GEMINI EXTRACTOR] Response had no text payload');
      return null;
    }

    try {
      return JSON.parse(raw) as GeminiExtractionResponse;
    } catch (parseError) {
      this.logger.warn(
        `[GEMINI EXTRACTOR] Failed to parse JSON response (${this.sanitize(parseError)})`,
      );
      return null;
    }
  }

  private summarizeTypes(entities: ExtractedEntity[]): string {
    const counts: Record<string, number> = {};
    for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return Object.entries(counts)
      .map(([t, c]) => `${t}:${c}`)
      .join(', ');
  }

  private sanitize(error: unknown): string {
    const message = (error as Error)?.message ?? String(error);
    return message.substring(0, 200);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx jest src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.spec.ts
```

Expected: PASS, 6/6 tests green.

- [ ] **Step 5: Verify build still compiles**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.ts \
  src/document-processing/infrastructure/extraction/gemini-entity-extractor.service.spec.ts
git commit -m "feat(extraction): add GeminiEntityExtractorService"
```

---

## Task 5: Register the service in the document-processing module

Makes the service injectable from the domain service.

**Files:**
- Modify: `src/document-processing/document-processing.module.ts`

- [ ] **Step 1: Add the import**

In `src/document-processing/document-processing.module.ts`, after the existing OCR adapter imports, add:

```ts
import { GeminiEntityExtractorService } from './infrastructure/extraction/gemini-entity-extractor.service';
```

- [ ] **Step 2: Register as a provider**

In the same file, find the `providers: [...]` array (the section that includes `GcpDocumentAiAdapter`, `GcpVisionAiAdapter`). Add `GeminiEntityExtractorService` to that list, next to the existing adapter classes:

```ts
    GcpDocumentAiAdapter,
    GcpVisionAiAdapter,
    GeminiEntityExtractorService,
```

- [ ] **Step 3: Verify the module compiles**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/document-processing/document-processing.module.ts
git commit -m "feat(extraction): register GeminiEntityExtractorService provider"
```

---

## Task 6: Wire the extractor into `extractAndSaveFields`

Single integration point. The domain service constructor gets the new dependency, and `extractAndSaveFields` switches from reading `ocrResult.entities` to calling Gemini on `ocrResult.text`. The two now-dead direct calls to `extractEntitiesFromText` (lines ~351, ~490) and the file's import are removed.

**Files:**
- Modify: `src/document-processing/domain/services/document-processing.domain.service.ts`

- [ ] **Step 1: Add the import + remove the old one**

Open `src/document-processing/domain/services/document-processing.domain.service.ts`. Replace:

```ts
import { extractEntitiesFromText } from '../../utils/text-entity-extractor';
```

with:

```ts
import { GeminiEntityExtractorService } from '../../infrastructure/extraction/gemini-entity-extractor.service';
```

- [ ] **Step 2: Add the constructor parameter**

In the `constructor(...)` parameter list, add `geminiEntityExtractor` next to the existing infrastructure services. The full updated constructor signature is:

```ts
  constructor(
    @Inject('DocumentRepositoryPort')
    private readonly documentRepository: DocumentRepositoryPort,
    @Inject('StorageServicePort')
    private readonly storageService: StorageServicePort,
    @Inject('OcrServicePort')
    private readonly ocrService: OcrServicePort,
    @Inject('VisionOcrServicePort')
    private readonly visionOcrService: OcrServicePort,
    @Inject('DocumentAiOcrServicePort')
    private readonly documentAiOcrService: OcrServicePort,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly pdf2JsonService: Pdf2JsonService,
    private readonly ocrMergeService: OcrMergeService,
    private readonly ocrPostProcessorService: OcrPostProcessorService,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
    private readonly geminiEntityExtractor: GeminiEntityExtractorService,
  ) {
```

- [ ] **Step 3: Remove the direct extractEntitiesFromText call near line 351**

In the same file, find:

```ts
          // Extract entities from combined text using regex patterns
          const entities = extractEntitiesFromText(fullText);
          this.logger.log(
            `[PDF2JSON] Extracted ${entities.length} entities from text`,
          );

          ocrResult = {
            text: fullText,
            confidence: 1.0, // Native text = 100% confidence
            pageCount: meta.Pages?.length || chunks.length,
            entities, // Use regex-based entity extraction
            fullResponse: {
```

Replace with:

```ts
          // Entities are extracted later by GeminiEntityExtractorService inside
          // extractAndSaveFields. The OCR paths no longer populate entities.
          ocrResult = {
            text: fullText,
            confidence: 1.0, // Native text = 100% confidence
            pageCount: meta.Pages?.length || chunks.length,
            fullResponse: {
```

- [ ] **Step 4: Remove the direct extractEntitiesFromText call near line 490**

Find this exact block (around lines 487-500 of the current file):

```ts
              // Check if we got meaningful text
              if (extractedText.trim().length >= 50) {
                // Success with pdf-parse!
                const entities = extractEntitiesFromText(extractedText);
                this.logger.log(
                  `[PDF-PARSE] Extracted ${entities.length} entities from text`,
                );

                ocrResult = {
                  text: extractedText,
                  confidence: 1.0, // Native text = 100% confidence
                  pageCount: pdfData.numpages || 1,
                  entities,
                  fullResponse: {
```

Replace with:

```ts
              // Check if we got meaningful text
              if (extractedText.trim().length >= 50) {
                // Success with pdf-parse! Entities will be extracted later by
                // GeminiEntityExtractorService inside extractAndSaveFields.
                ocrResult = {
                  text: extractedText,
                  confidence: 1.0, // Native text = 100% confidence
                  pageCount: pdfData.numpages || 1,
                  fullResponse: {
```

- [ ] **Step 5: Replace the entities source inside `extractAndSaveFields`**

Find the method definition (around line 1165). The current body starts:

```ts
  private async extractAndSaveFields(
    documentId: string,
    ocrResult: any,
  ): Promise<void> {
    this.logger.log(
      `[FIELD EXTRACTION] Starting field extraction for document ${documentId}`,
    );
    this.logger.log(
      `[FIELD EXTRACTION] OCR result structure: ${JSON.stringify({
        hasEntities: !!ocrResult.entities,
        entitiesCount: ocrResult.entities?.length || 0,
        hasFullResponse: !!ocrResult.fullResponse,
        keys: Object.keys(ocrResult),
      })}`,
    );

    if (!ocrResult.entities || ocrResult.entities.length === 0) {
      this.logger.warn(
        `[FIELD EXTRACTION] No entities found in OCR result for document ${documentId}`,
      );
      return;
    }

    const fields: ExtractedField[] = [];
    let lowConfidenceCount = 0;

    for (const entity of ocrResult.entities) {
```

Replace the block starting at `this.logger.log(...OCR result structure...)` through the `for (const entity of ocrResult.entities)` line with:

```ts
    const ocrText: string = ocrResult?.text ?? '';
    this.logger.log(
      `[FIELD EXTRACTION] OCR text length: ${ocrText.length} chars`,
    );

    const entities = await this.geminiEntityExtractor.extractEntities(ocrText);

    if (entities.length === 0) {
      this.logger.warn(
        `[FIELD EXTRACTION] Gemini extractor returned no entities for document ${documentId}`,
      );
      return;
    }

    const fields: ExtractedField[] = [];
    let lowConfidenceCount = 0;

    for (const entity of entities) {
```

- [ ] **Step 6: Verify build still compiles**

```bash
npm run build
```

Expected: succeeds. Any `extractEntitiesFromText` calls left elsewhere in the project will still compile because the function file still exists — Tasks 7 and 8 remove the remaining call sites before Task 9 deletes the file.

- [ ] **Step 7: Run the document-processing tests to spot regressions**

```bash
npx jest src/document-processing/
```

Expected: green. If a test mocks `extractAndSaveFields` or constructs `DocumentProcessingDomainService`, the new constructor parameter must be supplied — fix any failing test by injecting a `GeminiEntityExtractorService` mock returning `Promise.resolve([])` by default.

- [ ] **Step 8: Commit**

```bash
git add src/document-processing/domain/services/document-processing.domain.service.ts
git commit -m "feat(extraction): route extractAndSaveFields through Gemini extractor"
```

---

## Task 7: Remove regex calls from `gcp-document-ai.adapter.ts`

The Document AI adapter still imports the regex extractor as a fallback when Document AI returns no entities. That fallback is now dead — the adapter no longer needs to populate `entities`. The path simply leaves `entities` undefined.

**Files:**
- Modify: `src/document-processing/infrastructure/ocr/gcp-document-ai.adapter.ts`

- [ ] **Step 1: Remove the import**

In `src/document-processing/infrastructure/ocr/gcp-document-ai.adapter.ts`, delete this line:

```ts
import { extractEntitiesFromText } from '../../utils/text-entity-extractor';
```

- [ ] **Step 2: Remove the fallback path that calls the extractor (around line 175-195)**

Find this block (the exact block around line 175 in the current file):

```ts
      let entities: any[] = [];

      if (!doc.entities || doc.entities.length === 0) {
        this.logger.log(
          `[GCP DOCUMENT AI] No entities in response (expected - entity extraction to be implemented later). Using regex-based extraction from text.`,
        );

        // Fallback: Extract entities from text using regex patterns
        const textEntities = extractEntitiesFromText(fullText);
        this.logger.log(
          `[GCP DOCUMENT AI] Regex extraction found ${textEntities.length} entities from text`,
        );
        entities = textEntities;
      } else {
        // Extract entities with high confidence from Document AI
        entities = (doc.entities || [])
```

Replace with:

```ts
      // Entities are no longer populated here. The domain service runs
      // GeminiEntityExtractorService on the OCR text inside extractAndSaveFields.
      let entities: any[] = [];

      if (doc.entities && doc.entities.length > 0) {
        // Document AI returned native entities (uncommon with OCR_PROCESSOR).
        // Keep them for downstream visibility, though extractAndSaveFields
        // ignores this field today.
        entities = (doc.entities || [])
```

- [ ] **Step 3: Check for the second adapter location (around line 488-510)**

In the same file, look for a similar block around line 488 (batch processing path). The grep in plan exploration noted `hasEntities: !!doc.entities` at line 491. Apply the same treatment: if that branch also called `extractEntitiesFromText`, remove the call and replace with the same "entities no longer populated here" comment + empty array.

Run this to check whether the batch path actually calls the extractor:

```bash
grep -n "extractEntitiesFromText" src/document-processing/infrastructure/ocr/gcp-document-ai.adapter.ts
```

Expected output: empty (every call should have been removed by Steps 1-2 since there is only one call to the extractor in this file).

If the grep returns any remaining lines, repeat the removal for each one — replace the regex-fallback block with `let entities: any[] = [];` and the "no longer populated here" comment.

- [ ] **Step 4: Verify build still compiles**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Run document-processing tests**

```bash
npx jest src/document-processing/
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/document-processing/infrastructure/ocr/gcp-document-ai.adapter.ts
git commit -m "refactor(extraction): drop regex fallback from Document AI adapter"
```

---

## Task 8: Remove regex calls from `gcp-vision-ai.adapter.ts`

Same cleanup for the Vision AI adapter. Two call sites (sync path around line 221, batch path around line 533) plus the import.

**Files:**
- Modify: `src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts`

- [ ] **Step 1: Remove the import**

Delete:

```ts
import { extractEntitiesFromText } from '../../utils/text-entity-extractor';
```

- [ ] **Step 2: Remove the sync-path call (around line 219-225)**

Find:

```ts
      // Extract entities using fallback regex (Vision AI doesn't provide structured entities)
      this.logger.debug(`[VISION AI SYNC] Extracting entities from text`);
      const entities = extractEntitiesFromText(fullText);
```

Replace with:

```ts
      // Entities are no longer extracted here. GeminiEntityExtractorService runs
      // on the OCR text downstream in extractAndSaveFields.
      const entities: any[] = [];
```

- [ ] **Step 3: Remove the batch-path call (around line 531-537)**

Find:

```ts
      // Extract entities using fallback regex
      this.logger.debug(`[VISION AI BATCH] Extracting entities from text`);
      const entities = extractEntitiesFromText(fullText);
```

Replace with:

```ts
      // Entities are no longer extracted here. GeminiEntityExtractorService runs
      // on the OCR text downstream in extractAndSaveFields.
      const entities: any[] = [];
```

- [ ] **Step 4: Confirm both call sites removed**

```bash
grep -n "extractEntitiesFromText" src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts
```

Expected output: empty.

- [ ] **Step 5: Verify build still compiles**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 6: Run document-processing tests**

```bash
npx jest src/document-processing/
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/document-processing/infrastructure/ocr/gcp-vision-ai.adapter.ts
git commit -m "refactor(extraction): drop regex fallback from Vision AI adapter"
```

---

## Task 9: Delete the regex extractor file + run full test suite

With all 5 call sites gone, the file is unreferenced and can be removed.

**Files:**
- Delete: `src/document-processing/utils/text-entity-extractor.ts`

- [ ] **Step 1: Confirm no remaining references**

```bash
grep -rn "extractEntitiesFromText\|text-entity-extractor" src --include="*.ts"
```

Expected output: empty. If anything still references it, stop and fix that file before deleting.

- [ ] **Step 2: Delete the file**

```bash
rm src/document-processing/utils/text-entity-extractor.ts
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all 174 existing tests + the new mapper and extractor tests pass. Total ~185 tests.

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: no errors. Fix any unused-import or any-type warnings the deletion may have surfaced in callers.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(extraction): delete regex text-entity-extractor"
```

---

## Task 10: One-time GCP setup (user runs these once)

Vertex AI requires the API enabled and the Cloud Run service account granted `roles/aiplatform.user`. These are one-time commands; no code change. Run them before deploying Task 11.

- [ ] **Step 1: Enable the Vertex AI API**

```bash
gcloud services enable aiplatform.googleapis.com --project=healthatlas-dev-vp
```

Expected: returns silently (or `Operation finished successfully`).

- [ ] **Step 2: Grant the runtime service account `aiplatform.user`**

```bash
gcloud projects add-iam-policy-binding healthatlas-dev-vp \
  --member="serviceAccount:keystone-doc-processor@healthatlas-dev-vp.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

Expected: returns the updated IAM policy with the new binding.

- [ ] **Step 3: Verify the binding**

```bash
gcloud projects get-iam-policy healthatlas-dev-vp \
  --flatten='bindings[].members' \
  --filter='bindings.members:keystone-doc-processor@healthatlas-dev-vp.iam.gserviceaccount.com' \
  --format='value(bindings.role)' | sort -u
```

Expected output includes a line `roles/aiplatform.user` alongside the existing roles (`roles/documentai.apiUser`, `roles/storage.objectAdmin`, etc.).

---

## Task 11: Deploy + post-deploy data cleanup + manual QA

Ship the new build, drop the 15 hand-seeded rows on the demo doc so they don't double up with real extraction, and verify a fresh upload populates real categories.

- [ ] **Step 1: Submit Cloud Build**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
gcloud builds submit --config=cloudbuild.yaml --project=healthatlas-dev-vp
```

Expected: `STATUS: SUCCESS` after ~2-3 minutes. New image pushed to Artifact Registry.

- [ ] **Step 2: Roll the image onto Cloud Run**

```bash
gcloud run services update keystone \
  --image=us-central1-docker.pkg.dev/healthatlas-dev-vp/keystone/keystone:latest \
  --region=us-central1 \
  --project=healthatlas-dev-vp
```

Expected: `Service [keystone] revision [keystone-NNNNN-xxx] has been deployed and is serving 100 percent of traffic.`

- [ ] **Step 3: Delete the 15 hand-seeded extracted_fields rows on the demo doc**

Start the Cloud SQL proxy in one terminal:

```bash
/opt/homebrew/share/google-cloud-sdk/bin/cloud-sql-proxy \
  healthatlas-dev-vp:us-central1:keystone-db --port 9479
```

In another, connect with psql and clean up the seeded rows:

```bash
DB_PASS=$(gcloud secrets versions access latest --secret=DATABASE_PASSWORD --project=healthatlas-dev-vp)
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p 9479 -U keystone -d keystone <<'SQL'
DELETE FROM extracted_fields
WHERE document_id = '4f795b5b-25d9-483f-bc7f-b24ef17f2bf4'
  AND field_key IN (
    'medication','allergy','condition','doctor','pharmacy',
    'insurance','policy_number','emergency_contact','blood_type'
  )
  AND confidence = 0.95;
SELECT COUNT(*) AS remaining_rows_for_demo_doc
FROM extracted_fields
WHERE document_id = '4f795b5b-25d9-483f-bc7f-b24ef17f2bf4';
SQL
```

Expected: `DELETE 15` and the remaining count is `205` (the original 220 minus the 15 seeded rows). Stop the proxy when done.

- [ ] **Step 4: Re-trigger OCR on the demo doc**

Open Swagger at `https://keystone-634361481663.us-central1.run.app/api/swagger`, get a JWT for `test9@test.com` via `/auth/email/login`, then `POST /api/v1/documents/4f795b5b-25d9-483f-bc7f-b24ef17f2bf4/ocr/trigger`.

Expected: `202 Accepted`. Cloud Run logs show `[GEMINI EXTRACTOR] Extracted N entities (medication:X, condition:Y, ...)` within seconds.

- [ ] **Step 5: Open the simulator and verify the at-a-glance screen**

Re-fetch the at-a-glance summary (pull-to-refresh or re-tap the eyeball tab).

Expected: real medications / conditions / etc. populated for `test9@test.com`. The values are now Gemini-extracted from the original `sample_med_doc.pdf` content (which is a clinical narrative — expect "Rogers" / patient-history content reshaped into the categories, not the hand-seeded "Lisinopril 10mg daily" values).

- [ ] **Step 6: Fresh-upload smoke test**

From the simulator, upload a fresh document (any PDF/JPG). Trigger OCR via Swagger. Wait ~30 seconds. Pull-to-refresh at-a-glance.

Expected: the new doc's `documents_analyzed` count increments and at-a-glance reflects the new entities.

- [ ] **Step 7: Update PHASE2A_NOTES.md to close Known Issue #10**

Open `/Users/vigneshponraj/Documents/github/dropdev/PHASE2A_NOTES.md`. In Known Issue #10's section, change the header to mark it FIXED with the date and the new Cloud Run revision id from Step 2. Add a one-paragraph note pointing to this plan and the design spec.

- [ ] **Step 8: Commit the notes update**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev
git add PHASE2A_NOTES.md
git commit -m "docs: close Known Issue #10 (Gemini entity extractor shipped)"
```

Note: `PHASE2A_NOTES.md` lives at the workspace root, not in any of the three repos.
