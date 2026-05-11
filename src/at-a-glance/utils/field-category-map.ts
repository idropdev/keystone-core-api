/**
 * Static lookup of OCR/extractor `field_type` values to at-a-glance dashboard
 * categories. This map is the single source of truth for category bucketing
 * and is edited in code (not stored in DB) so reviewers can audit it.
 */

export const AT_A_GLANCE_CATEGORIES = [
  'medications',
  'allergies',
  'conditions',
  'doctors',
  'pharmacies',
  'insurance',
  'emergency_contact',
  'blood_type',
] as const;

export type AtAGlanceCategory = (typeof AT_A_GLANCE_CATEGORIES)[number];

/** Field types that don't map to any known category. */
export const UNCATEGORIZED = 'uncategorized';

const FIELD_TYPE_TO_CATEGORY: Record<string, AtAGlanceCategory> = {
  medication: 'medications',
  drug_name: 'medications',
  prescription_name: 'medications',
  allergy: 'allergies',
  allergen: 'allergies',
  condition: 'conditions',
  diagnosis: 'conditions',
  medical_condition: 'conditions',
  physician: 'doctors',
  provider: 'doctors',
  doctor: 'doctors',
  pharmacy: 'pharmacies',
  dispensing_pharmacy: 'pharmacies',
  insurance: 'insurance',
  policy_number: 'insurance',
  insurer: 'insurance',
  emergency_contact: 'emergency_contact',
  blood_type: 'blood_type',
};

/**
 * Returns the at-a-glance category for the given `field_type`, or
 * `'uncategorized'` if the type is unknown. Match is case-insensitive.
 */
export function mapToCategory(
  fieldType: string,
): AtAGlanceCategory | typeof UNCATEGORIZED {
  const normalized = fieldType.toLowerCase();
  return FIELD_TYPE_TO_CATEGORY[normalized] ?? UNCATEGORIZED;
}
