import { mapToCategory, AT_A_GLANCE_CATEGORIES } from './field-category-map';

describe('field-category-map', () => {
  describe('AT_A_GLANCE_CATEGORIES', () => {
    it('should declare exactly the 8 known categories', () => {
      expect(AT_A_GLANCE_CATEGORIES).toEqual([
        'medications',
        'allergies',
        'conditions',
        'doctors',
        'pharmacies',
        'insurance',
        'emergency_contact',
        'blood_type',
      ]);
    });
  });

  describe('mapToCategory', () => {
    it.each<[string, string]>([
      ['medication', 'medications'],
      ['drug_name', 'medications'],
      ['prescription_name', 'medications'],
      ['allergy', 'allergies'],
      ['allergen', 'allergies'],
      ['condition', 'conditions'],
      ['diagnosis', 'conditions'],
      ['medical_condition', 'conditions'],
      ['physician', 'doctors'],
      ['provider', 'doctors'],
      ['doctor', 'doctors'],
      ['pharmacy', 'pharmacies'],
      ['dispensing_pharmacy', 'pharmacies'],
      ['insurance', 'insurance'],
      ['policy_number', 'insurance'],
      ['insurer', 'insurance'],
      ['emergency_contact', 'emergency_contact'],
      ['blood_type', 'blood_type'],
    ])('maps fieldType "%s" to category "%s"', (input, expected) => {
      expect(mapToCategory(input)).toBe(expected);
    });

    it('should map unknown fieldType to "uncategorized"', () => {
      expect(mapToCategory('something_we_dont_know')).toBe('uncategorized');
    });

    it('should treat matching case-insensitively', () => {
      expect(mapToCategory('MEDICATION')).toBe('medications');
      expect(mapToCategory('Allergy')).toBe('allergies');
    });
  });
});
