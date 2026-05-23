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
      entities.push({
        type,
        mentionText: trimmed,
        confidence: FIXED_CONFIDENCE,
      });
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
