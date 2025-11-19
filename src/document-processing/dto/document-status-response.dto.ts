import { ApiProperty } from '@nestjs/swagger';
import { DocumentStatus } from '../domain/enums/document-status.enum';

export class DocumentStatusResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: DocumentStatus })
  status: DocumentStatus;

  @ApiProperty({
    description: 'Processing progress percentage (0-100)',
    required: false,
  })
  progress?: number;

  @ApiProperty({ required: false })
  processingStartedAt?: Date;

  @ApiProperty({ required: false })
  processedAt?: Date;

  @ApiProperty({ required: false })
  errorMessage?: string;
}
