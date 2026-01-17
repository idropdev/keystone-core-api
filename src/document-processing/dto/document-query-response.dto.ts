import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { DocumentResponseDto } from './document-response.dto';
import { InfinityPaginationResponseDto } from '../../utils/dto/infinity-pagination-response.dto';

/**
 * Document query response item with ownership context
 */
export class DocumentQueryItemDto extends DocumentResponseDto {
  @ApiProperty({
    description:
      'Ownership context indicating how the actor has access to this document',
    enum: ['own', 'assigned_user', 'granted'],
    example: 'own',
  })
  @Expose()
  ownershipContext: 'own' | 'assigned_user' | 'granted';
}

/**
 * Document query response with pagination
 */
export class DocumentQueryResponseDto extends InfinityPaginationResponseDto<DocumentQueryItemDto> {
  @ApiProperty({
    description: 'Array of documents matching the query',
    type: [DocumentQueryItemDto],
  })
  @Expose()
  data: DocumentQueryItemDto[];

  @ApiProperty({
    description: 'Whether there are more results available',
    example: true,
  })
  @Expose()
  hasNextPage: boolean;
}
