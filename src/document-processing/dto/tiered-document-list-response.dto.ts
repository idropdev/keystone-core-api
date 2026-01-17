import { ApiProperty } from '@nestjs/swagger';
import { DocumentResponseDto } from './document-response.dto';
import { LimitedDocumentDto } from './limited-document.dto';

/**
 * Tiered Document List Response DTO
 *
 * SYSTEM-100: Tiered Document Visibility
 *
 * Returns documents in two tiers:
 * - fullAccess: Documents where user has full access (origin manager, AccessGrant)
 * - limitedView: Documents user can see but has limited access (metadata only)
 */
export class TieredDocumentListResponseDto {
  @ApiProperty({
    description:
      'Documents with full access (origin manager, or has AccessGrant)',
    type: [DocumentResponseDto],
  })
  fullAccess: DocumentResponseDto[];

  @ApiProperty({
    description:
      'Documents with limited view (can see metadata, no download/OCR)',
    type: [LimitedDocumentDto],
  })
  limitedView: LimitedDocumentDto[];
}
