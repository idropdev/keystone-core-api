import { ApiProperty } from '@nestjs/swagger';
import { BloodTypeDataDto, CategoryDataDto } from './category-data.dto';

export class AtAGlanceCategoriesDto {
  @ApiProperty({ type: CategoryDataDto }) medications!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) allergies!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) conditions!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) doctors!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) pharmacies!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) insurance!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) emergency_contact!: CategoryDataDto;
  @ApiProperty({ type: BloodTypeDataDto }) blood_type!: BloodTypeDataDto;
}

export class AtAGlanceSummaryDto {
  @ApiProperty({ type: AtAGlanceCategoriesDto })
  categories!: AtAGlanceCategoriesDto;

  @ApiProperty({
    description:
      'ISO-8601 timestamp of the most recent extracted field across all documents, or null if none',
    example: '2026-05-05T10:23:00Z',
    nullable: true,
  })
  last_updated!: string | null;

  @ApiProperty({
    description:
      'Number of PROCESSED documents that contributed to this summary',
    example: 7,
  })
  documents_analyzed!: number;
}
