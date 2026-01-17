import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Review Access Request DTO
 *
 * SYSTEM-100: Access Request Workflow
 */
export class ReviewAccessRequestDto {
  @ApiPropertyOptional({
    description: 'Notes for the review decision',
    example: 'Approved for care coordination',
  })
  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
