import { ApiProperty } from '@nestjs/swagger';

/**
 * A single category sample (e.g. one medication, one allergy).
 * Free-form shape — keys vary by category, but all are user-displayable strings.
 */
export class CategorySampleDto {
  [key: string]: string | number | undefined;
}

/**
 * For most categories (medications, allergies, conditions, doctors, pharmacies,
 * insurance, emergency_contact): a count of distinct values + up to 3 most-recent
 * unique samples.
 */
export class CategoryDataDto {
  @ApiProperty({
    description: 'Distinct value count for this category',
    example: 3,
  })
  count!: number;

  @ApiProperty({
    description: 'Up to 3 most-recent unique samples',
    type: [Object],
    example: [{ name: 'Lisinopril', dose: '10mg' }],
  })
  samples!: CategorySampleDto[];
}

/**
 * Special-case singleton for `blood_type` — there is only one current value,
 * not a list.
 */
export class BloodTypeDataDto {
  @ApiProperty({
    description: 'Most recently extracted blood type value',
    example: 'O+',
    nullable: true,
  })
  value!: string | null;

  @ApiProperty({
    description: 'ID of the document this value was extracted from',
    example: '550e8400-e29b-41d4-a716-446655440000',
    nullable: true,
  })
  source_document_id!: string | null;
}
