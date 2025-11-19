# Bug Fix: Empty Array from GET /documents/:documentId/fields

## Issue
The endpoint `GET /v1/documents/:documentId/fields` was returning a 200 status with an empty array `[]` instead of the extracted fields, even when fields existed in the database.

## Root Causes

### 1. Missing @Expose() Decorators in DTO
**File**: `src/document-processing/dto/extracted-field-response.dto.ts`

**Problem**: The `ExtractedFieldResponseDto` was missing `@Expose()` decorators from `class-transformer`. When the service used `plainToClass()` with `excludeExtraneousValues: true`, it was stripping out ALL properties that didn't have the `@Expose()` decorator, resulting in empty objects.

**Code Location**:
```typescript
// In document-processing.service.ts, line 112-116
return fields.map((field) =>
  plainToClass(ExtractedFieldResponseDto, field, {
    excludeExtraneousValues: true,  // This was the killer
  }),
);
```

### 2. Inefficient Database Query
**File**: `src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts`

**Problem**: The repository was querying extracted fields using a relation-based where clause `{ document: { id: documentId } }`, which can be unreliable in TypeORM depending on configuration and doesn't directly use the foreign key column.

**Original Code**:
```typescript
const entities = await this.extractedFieldRepository.find({
  where: { document: { id: documentId } },
});
```

## Fixes Applied

### 1. Added @Expose() Decorators to DTO
**File**: `src/document-processing/dto/extracted-field-response.dto.ts`

Added `@Expose()` decorator to all fields that should be included in the response:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class ExtractedFieldResponseDto {
  @ApiProperty()
  @Expose()  // ← Added
  fieldKey: string;

  @ApiProperty()
  @Expose()  // ← Added
  fieldValue: string;

  @ApiProperty()
  @Expose()  // ← Added
  fieldType: string;

  @ApiProperty({ required: false })
  @Expose()  // ← Added
  confidence?: number;
}
```

### 2. Added documentId Column to Entity
**File**: `src/document-processing/infrastructure/persistence/relational/entities/extracted-field.entity.ts`

Explicitly added the `documentId` column alongside the relation for more reliable querying:

```typescript
@ManyToOne(() => DocumentEntity, (doc) => doc.extractedFields, {
  nullable: false,
})
@JoinColumn({ name: 'document_id' })
@Index()
document: DocumentEntity;

@Column({ name: 'document_id' })  // ← Added explicit column
documentId: string;
```

### 3. Updated Repository Query
**File**: `src/document-processing/infrastructure/persistence/relational/repositories/document.repository.ts`

Changed to query directly by the foreign key column:

```typescript
async findExtractedFieldsByDocumentId(
  documentId: string,
): Promise<ExtractedField[]> {
  const entities = await this.extractedFieldRepository.find({
    where: { documentId },  // ← Direct column query
  });
  return entities.map(ExtractedFieldMapper.toDomain);
}
```

### 4. Updated Mapper
**File**: `src/document-processing/infrastructure/persistence/relational/mappers/extracted-field.mapper.ts`

Updated both `toDomain()` and `toPersistence()` methods to handle the new `documentId` field:

```typescript
// toDomain - now prefers the direct column
domain.documentId = entity.documentId || entity.document?.id;

// toPersistence - sets both relation and column
entity.document = doc;
entity.documentId = domain.documentId;  // ← Added
```

## Impact

### Before
- Endpoint returned: `[]` (empty array)
- No errors in logs
- Fields existed in database but were not serialized

### After
- Endpoint returns: Array of `ExtractedFieldResponseDto` objects with all fields populated
- More efficient database query (no relation join needed)
- Consistent behavior with other DTOs in the codebase

## Testing Recommendations

1. **Upload a document** via `POST /v1/documents/upload`
2. **Wait for processing** to complete (check status endpoint)
3. **Retrieve extracted fields** via `GET /v1/documents/:documentId/fields`
4. **Verify response** contains:
   - `fieldKey` (e.g., "patient_name", "test_date")
   - `fieldValue` (extracted text)
   - `fieldType` (e.g., "string", "date")
   - `confidence` (0-1 float, optional)

## Related Files
- Controller: `src/document-processing/document-processing.controller.ts` (lines 192-209)
- Service: `src/document-processing/document-processing.service.ts` (lines 103-117)
- Domain Service: `src/document-processing/domain/services/document-processing.domain.service.ts` (lines 515-521)

## Notes

- Fields are only extracted from OCR results where `entity.confidence >= 0.7`
- The extraction happens in `extractAndSaveFields()` method (domain service, lines 299-333)
- If no entities are found or all have low confidence, the endpoint will legitimately return an empty array
- To debug field extraction, check logs for: "Saved X extracted fields for document {documentId}"

