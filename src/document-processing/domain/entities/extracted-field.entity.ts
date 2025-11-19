export class ExtractedField {
  id: string;
  documentId: string;

  // Field data
  fieldKey: string; // e.g., "patient_name", "test_date"
  fieldValue: string; // Extracted value
  fieldType: string; // e.g., "string", "date", "number"
  confidence?: number; // Field-level confidence (0-1)

  // Metadata
  startIndex?: number; // Position in original text
  endIndex?: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
