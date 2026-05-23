# Gemini Entity Extractor — Design

**Date:** 2026-05-21
**Status:** Approved design, ready for implementation plan
**Context:** Known Issue #10 in `dropdev/PHASE2A_NOTES.md`

## Problem

The current medical entity extractor (`src/document-processing/utils/text-entity-extractor.ts`)
is a regex fallback that labels arbitrary sentence fragments as `lab_test_name` /
`lab_test_value` / `result_status` / `medical_test`. On free-text clinical documents it
produces prose chunks ("Rogers is a", "45 minutes"), not structured entities. Worse, the
`field_key` vocabulary it emits has zero overlap with the at-a-glance category map
(`src/at-a-glance/utils/field-category-map.ts`), so every extracted row maps to
`UNCATEGORIZED` and the at-a-glance dashboard shows `documents_analyzed: 0` for any real
upload.

The Document AI processor currently in use is a plain `OCR_PROCESSOR` (text only, no
entity extraction) — which is why the regex fallback exists at all.

## Goal

Replace the regex extractor with a real medical entity extractor that produces structured
`field_key`/`field_value` pairs aligned to the 8 at-a-glance categories: medications,
allergies, conditions, doctors, pharmacies, insurance, emergency_contact, blood_type.

## Decisions (from brainstorming)

- **Quality bar:** demo-grade — works on typical medical documents (lab reports,
  discharge summaries, prescriptions, visit notes). Ship-able for external beta. Not
  required to handle every messy edge case (poor scans, handwriting, multi-language).
- **HIPAA posture:** HIPAA-eligible GCP service from the start. This rules out the
  AI Studio Gemini key (non-HIPAA, personal account — Known Issue #2).
- **Category scope:** all 8 at-a-glance categories must be attempted. Leaving 4 cards
  permanently empty looks broken.
- **Chosen approach:** Vertex AI Gemini with structured output. The only single-
  integration option that covers all 8 categories and is HIPAA-eligible.

### Rejected alternatives

- **Document AI medical-specialist processor** — Document AI's healthcare processors are
  form-specific (CMS-1500 claims, etc.), not general medical-record entity extractors.
  Dead end for free-text records.
- **Healthcare Natural Language API only** — purpose-built for clinical concepts
  (medications, conditions with RxNorm/SNOMED codes) but structurally cannot extract
  administrative data (doctors, pharmacies, insurance, emergency contacts). Would leave
  4 of 8 categories permanently empty.
- **Healthcare NL API + Gemini hybrid** — higher clinical accuracy with coded entities,
  but two integrations and two failure modes. The coded-entity advantage surfaces
  nowhere in the current at-a-glance UI. Deferred to Phase II if a future feature ever
  needs RxNorm/SNOMED codes.

## Architecture

### Component boundary

New component: `GeminiEntityExtractorService` — a NestJS injectable in
`src/document-processing/infrastructure/extraction/` (new folder, peer to the existing
`ocr/` adapters; this is also an external-API adapter).

One public method:

```
extractEntities(ocrText: string): Promise<ExtractedEntity[]>
```

It returns the same `ExtractedEntity[]` type the old regex extractor returned, so the
data shape flowing into `extracted_fields` is unchanged. It is wired in at a single
chokepoint rather than swapped at scattered call sites — see Pipeline integration below.

### `ExtractedEntity` shape

The existing interface is unchanged:

```
interface ExtractedEntity {
  type: string;
  mentionText: string;
  confidence: number;
  startOffset?: number;
  endOffset?: number;
}
```

Behavior differences vs. the regex extractor:

- `type` is now an at-a-glance-aligned key directly: one of `medication`, `allergy`,
  `condition`, `doctor`, `pharmacy`, `insurance`, `policy_number`, `emergency_contact`,
  `blood_type`. These map cleanly onto `field-category-map.ts`. The existing
  `normalizeEntityType` in the domain service becomes a near-passthrough.
- `startOffset` / `endOffset` are `undefined` — Gemini does not return reliable
  character offsets. The `extracted_fields.start_index` / `end_index` DB columns are
  already nullable.
- `confidence` is a fixed value (`0.9`) for all LLM-extracted entities. Structured-output
  LLMs do not emit meaningful per-field confidence, and the at-a-glance service does not
  filter on confidence. A fixed honest value is preferred over a faked precise one.

### The regex extractor is removed

`src/document-processing/utils/text-entity-extractor.ts` is deleted, along with its
tests. It is currently imported in three files (5 call sites total):
`document-processing.domain.service.ts` (lines ~351, ~490), `gcp-document-ai.adapter.ts`
(~187), and `gcp-vision-ai.adapter.ts` (~221, ~533). All of these populate an
`OcrResult.entities` field that, after this change, nothing reads — so the calls are
removed as dead code and `entities` is no longer set by the OCR paths.

Keeping a known-garbage fallback is worse than returning empty: if Gemini fails,
`extractEntities` returns `[]`, which the pipeline already handles gracefully (the
document still reaches `PROCESSED`).

## The Gemini call

### Authentication

Vertex AI authenticates via the Cloud Run service account (Application Default
Credentials). No new API key, no new Secret Manager secret. Required one-time setup:

- Enable the Vertex AI API (`aiplatform.googleapis.com`) in `healthatlas-dev-vp`.
- Grant the `keystone-doc-processor@healthatlas-dev-vp.iam.gserviceaccount.com` service
  account the `roles/aiplatform.user` role.

### Client and model

- npm package: `@google-cloud/vertexai` (new dependency).
- Model: `gemini-2.5-flash`.

### Structured output

The call uses `responseMimeType: 'application/json'` plus a `responseSchema` so Gemini
returns schema-valid JSON. Schema:

```json
{
  "medications":         ["string"],
  "allergies":           ["string"],
  "conditions":          ["string"],
  "doctors":             ["string"],
  "pharmacies":          ["string"],
  "insurance_providers": ["string"],
  "policy_numbers":      ["string"],
  "emergency_contacts":  ["string"],
  "blood_type":          "string | null"
}
```

The service flattens this JSON into `ExtractedEntity[]`:

- each `medications[]` item → `{ type: 'medication', mentionText: <item> }`
- each `allergies[]` item → `{ type: 'allergy', ... }`
- each `conditions[]` item → `{ type: 'condition', ... }`
- each `doctors[]` item → `{ type: 'doctor', ... }`
- each `pharmacies[]` item → `{ type: 'pharmacy', ... }`
- each `insurance_providers[]` item → `{ type: 'insurance', ... }`
- each `policy_numbers[]` item → `{ type: 'policy_number', ... }`
- each `emergency_contacts[]` item → `{ type: 'emergency_contact', ... }`
- `blood_type` (if non-null) → one `{ type: 'blood_type', ... }` entity

Every produced entity gets `confidence: 0.9` and no offsets.

### Prompt strategy

Anti-hallucination is the priority:

- "Extract structured medical information only if explicitly present in the document
  text. Never infer, guess, or invent."
- "If a category has no information in the text, return an empty array (or null for
  blood_type)."
- "Preserve the original wording — for example, a medication with its dose as written."
- The full OCR text is the content. `gemini-2.5-flash`'s context window handles long
  multi-page records in a single call — no chunking needed.

### Generation config

- `temperature: 0` — deterministic extraction; the same input should yield the same
  output.

## Pipeline integration

### Single chokepoint

Every document-processing path converges on one method:
`extractAndSaveFields(documentId, ocrResult)` in
`src/document-processing/domain/services/document-processing.domain.service.ts`
(definition ~line 1165, called once ~line 1075). It is the only place that reads
`ocrResult.entities` and writes `extracted_fields` rows.

Gemini is wired in here: `extractAndSaveFields` calls
`await this.geminiEntityExtractor.extractEntities(ocrResult.text)` and uses the result,
instead of reading the upstream-populated `ocrResult.entities`. This is one integration
point rather than five. The service is constructor-injected like the existing OCR
adapters (`documentAiOcrService`, `visionOcrService`).

The 5 now-dead `extractEntitiesFromText` calls (2 in the domain service, 3 in the OCR
adapters) are removed along with the `text-entity-extractor.ts` file. The OCR paths
stop populating `OcrResult.entities` — nothing reads it anymore.

### Module wiring

Register `GeminiEntityExtractorService` as a provider in the document-processing module.
Add config via the existing config pattern: `GCP_PROJECT_ID` (already available),
`VERTEX_AI_LOCATION` (e.g. `us-central1`), `GEMINI_MODEL` (`gemini-2.5-flash`).

### Failure modes

| Failure | Behavior |
|---|---|
| Gemini call fails (network, 5xx, quota) | Retry once inline for transient errors. If still failing, log a sanitized error and return `[]`. Document still completes to `PROCESSED` with zero entities. |
| Gemini returns malformed JSON | Parse defensively in try/catch; treat as `[]`. |
| OCR text empty or too short | Skip the Gemini call entirely, return `[]`. |
| Document genuinely has no medical entities | Gemini returns all-empty arrays → `[]`. Normal, not an error. |

The pipeline already handles `ocrResult.entities` being empty (logs a warning, document
still reaches `PROCESSED`), so a Gemini failure never breaks document processing — it
only means no at-a-glance data for that one document. The existing document-level 3×
retry still wraps everything.

### HIPAA-safe logging

Consistent with the current code: log entity counts and types, never `field_value`
contents. The existing extractor file header already mandates this.

## Testing

- **Unit test the flatten/map logic** — a pure function `(geminiJson) → ExtractedEntity[]`.
  Cover: all 8 categories populated; empty arrays; `blood_type` null vs present;
  malformed JSON → `[]`.
- **Unit test the service with a mocked Vertex AI client** — inject a fake returning a
  known JSON payload; assert the resulting `ExtractedEntity[]`. Cover failure paths
  (client throws → retry → `[]`).
- **LLM output quality is not unit-testable** (non-deterministic) — verified via manual
  QA: upload 2-3 real sample docs (lab report, discharge summary, prescription) and
  confirm at-a-glance populates sensibly.
- **Existing document-processing tests must still pass.** Removing
  `text-entity-extractor.ts` means deleting its tests; any test importing it is updated.

## Rollout

1. One-time GCP setup (explicit `gcloud` commands in the implementation plan): enable
   the Vertex AI API, grant the `keystone-doc-processor` SA `roles/aiplatform.user`.
2. Deploy via the existing Cloud Build → Cloud Run flow.
3. Re-process existing docs: the 4 `STORED` docs and the seeded demo doc can be re-OCR'd
   to get real Gemini-extracted entities. The 15 hand-seeded rows on doc
   `4f795b5b-25d9-483f-bc7f-b24ef17f2bf4` are deleted as part of this (otherwise they
   double up with real extraction). Quick SQL, noted in the plan.
4. Manual QA on the simulator: upload a fresh document, confirm at-a-glance shows real
   categories.

## Out of scope (YAGNI)

- Confidence thresholds / low-confidence review UI.
- RxNorm/SNOMED coded entities (Approach B territory — Phase II if ever needed).
- Document chunking (flash's context window is large enough).
- The OCR auto-trigger fix — separate Phase I work item, not this design.
- Backfilling beyond the handful of existing test documents.
