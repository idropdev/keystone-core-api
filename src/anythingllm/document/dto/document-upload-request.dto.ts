import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Document upload request DTO
 * Supports multiple OCR data sources with priority: userEditField > visionFields > documentFields
 */
export class DocumentUploadRequestDto {
  @ApiPropertyOptional({
    type: 'string',
    description:
      'Comma-separated workspace slugs to embed document into post-upload',
    example: 'workspace1,workspace2',
  })
  @IsOptional()
  @IsString()
  addToWorkspaces?: string;

  @ApiPropertyOptional({
    type: 'string',
    description:
      'JSON string of Google Document AI OCR output. Entities include type, mentionText, confidence (0-1), startOffset, and endOffset. The fullResponse contains the complete Document AI response.',
    example:
      '{"entities":[{"type":"PERSON","mentionText":"John Doe","confidence":0.95,"startOffset":10,"endOffset":18}],"fullResponse":{}}',
  })
  @IsOptional()
  @IsString()
  documentFields?: string;

  @ApiPropertyOptional({
    type: 'string',
    description:
      'JSON string of Google Vision API OCR output. Same entity structure as documentFields. The fullResponse contains the complete Vision API response with fullTextAnnotation.',
    example:
      '{"entities":[{"type":"TEXT","mentionText":"Sample text","confidence":0.92,"startOffset":0,"endOffset":11}],"fullResponse":{"fullTextAnnotation":{}}}',
  })
  @IsOptional()
  @IsString()
  visionFields?: string;

  @ApiPropertyOptional({
    type: 'string',
    description:
      'JSON string of user-edited OCR data. HIGHEST PRIORITY - overrides documentFields and visionFields. Same structure. User-edited entities take priority over AI-generated ones during merging.',
    example:
      '{"entities":[{"type":"PERSON","mentionText":"Jane Doe","confidence":1.0,"startOffset":10,"endOffset":18}],"fullResponse":{}}',
  })
  @IsOptional()
  @IsString()
  userEditField?: string;
}
