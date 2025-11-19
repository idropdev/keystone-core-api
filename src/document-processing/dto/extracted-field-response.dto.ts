import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class ExtractedFieldResponseDto {
  @ApiProperty()
  @Expose()
  fieldKey: string;

  @ApiProperty()
  @Expose()
  fieldValue: string;

  @ApiProperty()
  @Expose()
  fieldType: string;

  @ApiProperty({ required: false })
  @Expose()
  confidence?: number;
}
