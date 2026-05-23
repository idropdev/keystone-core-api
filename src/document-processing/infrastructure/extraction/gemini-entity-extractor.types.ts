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
