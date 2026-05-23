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
  it('should return an empty array for an all-empty response', () => {
    expect(mapGeminiResponseToEntities(empty)).toEqual([]);
  });

  it('should map medications to type "medication" with confidence 0.9', () => {
    const result = mapGeminiResponseToEntities({
      ...empty,
      medications: ['Lisinopril 10mg daily', 'Metformin 500mg'],
    });
    expect(result).toEqual([
      {
        type: 'medication',
        mentionText: 'Lisinopril 10mg daily',
        confidence: 0.9,
      },
      { type: 'medication', mentionText: 'Metformin 500mg', confidence: 0.9 },
    ]);
  });

  it('should map every populated category to its corresponding entity type', () => {
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

  it('should emit a single blood_type entity when blood_type is non-null', () => {
    const result = mapGeminiResponseToEntities({ ...empty, blood_type: 'A-' });
    expect(result).toEqual([
      { type: 'blood_type', mentionText: 'A-', confidence: 0.9 },
    ]);
  });

  it('should emit no blood_type entity when blood_type is null', () => {
    const result = mapGeminiResponseToEntities({ ...empty, blood_type: null });
    expect(result.find((e) => e.type === 'blood_type')).toBeUndefined();
  });

  it('should skip empty strings and trim whitespace in array values', () => {
    const result = mapGeminiResponseToEntities({
      ...empty,
      medications: ['  Lisinopril  ', '', '   '],
    });
    expect(result).toEqual([
      { type: 'medication', mentionText: 'Lisinopril', confidence: 0.9 },
    ]);
  });
});
