/**
 * Simple Text Entity Extractor
 *
 * Extracts common medical entities from plain text using regex patterns.
 * Used as fallback when Document AI processor doesn't support entity extraction.
 *
 * HIPAA Compliance:
 * - This is processing PHI - handle with care
 * - Never log extracted values, only field types
 * - All extracted data stays within HIPAA-compliant infrastructure
 */

export interface ExtractedEntity {
  type: string;
  mentionText: string;
  confidence: number;
  startOffset?: number;
  endOffset?: number;
}

/**
 * Extract common medical entities from text
 */
export function extractEntitiesFromText(text: string): ExtractedEntity[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const entities: ExtractedEntity[] = [];

  // Pattern: Patient Name: John Doe
  const patientNamePattern =
    /Patient\s+Name:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi;
  let match;
  while ((match = patientNamePattern.exec(text)) !== null) {
    entities.push({
      type: 'patient_name',
      mentionText: match[1].trim(),
      confidence: 0.9,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Pattern: Date of Birth: YYYY-MM-DD or MM/DD/YYYY or variations
  const dobPattern =
    /(?:Date\s+of\s+Birth|DOB|Birth\s*Date):?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4})/gi;
  patientNamePattern.lastIndex = 0;
  while ((match = dobPattern.exec(text)) !== null) {
    entities.push({
      type: 'date_of_birth',
      mentionText: match[1].trim(),
      confidence: 0.95,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Pattern: Test Date: YYYY-MM-DD
  const testDatePattern =
    /(?:Test\s+Date|Date\s+of\s+Test|Collection\s+Date):?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi;
  dobPattern.lastIndex = 0;
  while ((match = testDatePattern.exec(text)) !== null) {
    entities.push({
      type: 'test_date',
      mentionText: match[1].trim(),
      confidence: 0.95,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Pattern: Physician: Dr. Smith
  const physicianPattern =
    /(?:Physician|Doctor|Provider):?\s*(Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;
  testDatePattern.lastIndex = 0;
  while ((match = physicianPattern.exec(text)) !== null) {
    entities.push({
      type: 'physician',
      mentionText: match[1].trim(),
      confidence: 0.85,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Pattern: Lab test results with values and units
  // Example: Hemoglobin 14.2 g/dL 13.0 - 17.0
  const labResultPattern =
    /([A-Z][a-zA-Z\s\(\)]+?)\s+(\d+\.?\d*)\s+([a-zA-Z0-9\/\^]+)/gm;
  physicianPattern.lastIndex = 0;
  while ((match = labResultPattern.exec(text)) !== null) {
    const testName = match[1].trim();
    const value = match[2].trim();
    const unit = match[3].trim();

    // Only extract if test name looks valid (not too long, has letters)
    if (
      testName.length < 50 &&
      testName.length > 3 &&
      /[A-Za-z]{3,}/.test(testName)
    ) {
      entities.push({
        type: 'lab_test_name',
        mentionText: testName,
        confidence: 0.85,
        startOffset: match.index,
        endOffset: match.index + testName.length,
      });

      entities.push({
        type: 'lab_test_value',
        mentionText: `${value} ${unit}`,
        confidence: 0.85,
        startOffset: match.index + testName.length,
        endOffset: match.index + match[0].length,
      });
    }
  }

  // Pattern: Reference ranges
  // Example: 13.0 - 17.0 or < 200 or 150 - 400
  const referenceRangePattern =
    /(?:REFERENCE RANGE|Reference|Range):?\s*([<>]?\s*\d+\.?\d*\s*-?\s*\d*\.?\d*)/gi;
  labResultPattern.lastIndex = 0;
  while ((match = referenceRangePattern.exec(text)) !== null) {
    entities.push({
      type: 'reference_range',
      mentionText: match[1].trim(),
      confidence: 0.8,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Pattern: Common medical test names in headers
  const medicalTestHeaders =
    /(?:TEST NAME|LABORATORY RESULTS|VITAL SIGNS|BLOOD WORK|IMAGING REPORT|PRESCRIPTION|DIAGNOSIS)/gi;
  labResultPattern.lastIndex = 0;
  while ((match = medicalTestHeaders.exec(text)) !== null) {
    entities.push({
      type: 'document_section',
      mentionText: match[0].trim(),
      confidence: 0.95,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Pattern: Notes or remarks
  const notesPattern =
    /(?:Notes?|Remarks?|Comments?):?\s*([A-Z][^.\n]{10,200}\.)/gi;
  medicalTestHeaders.lastIndex = 0;
  while ((match = notesPattern.exec(text)) !== null) {
    entities.push({
      type: 'notes',
      mentionText: match[1].trim(),
      confidence: 0.7,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Pattern: Common medical test names (more specific)
  const commonTestsPattern =
    /\b(Hemoglobin|White Blood Cells|Platelet Count|Glucose|Cholesterol|Triglycerides|HDL|LDL|Creatinine|Blood Urea Nitrogen|BUN|A1C|HbA1c|TSH|T3|T4|Vitamin D|Iron|Ferritin|Calcium|Sodium|Potassium)\b/gi;
  notesPattern.lastIndex = 0;
  while ((match = commonTestsPattern.exec(text)) !== null) {
    // Check if we haven't already added this as a lab_test_name
    const alreadyExists = entities.some(
      (e) =>
        e.type === 'lab_test_name' &&
        e.startOffset !== undefined &&
        e.endOffset !== undefined &&
        e.startOffset <= match.index &&
        e.endOffset >= match.index,
    );
    if (!alreadyExists) {
      entities.push({
        type: 'medical_test',
        mentionText: match[1].trim(),
        confidence: 0.9,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
      });
    }
  }

  // Pattern: Result status indicators
  const statusPattern =
    /\b(Normal|Abnormal|High|Low|Critical|Within Range)\b/gi;
  commonTestsPattern.lastIndex = 0;
  while ((match = statusPattern.exec(text)) !== null) {
    entities.push({
      type: 'result_status',
      mentionText: match[1].trim(),
      confidence: 0.75,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  return entities;
}
