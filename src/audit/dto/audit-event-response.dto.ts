import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthEventType } from '../audit.service';

export class AuditEventResponseDto {
  @ApiProperty({
    description: 'Audit event ID',
    type: Number,
    example: 1001,
  })
  id: number;

  @ApiProperty({
    description: 'Event type',
    enum: AuthEventType,
    example: AuthEventType.DOCUMENT_VIEWED,
  })
  eventType: AuthEventType;

  @ApiProperty({
    description: 'Event timestamp (ISO 8601)',
    type: String,
    example: '2025-01-20T10:30:00Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Actor type (who performed the action)',
    enum: ['user', 'manager', 'admin', 'system'],
    example: 'user',
  })
  actorType: 'user' | 'manager' | 'admin' | 'system';

  @ApiProperty({
    description: 'Actor ID',
    type: Number,
    example: 456,
  })
  actorId: number;

  @ApiPropertyOptional({
    description: 'Target type (what was acted upon)',
    enum: ['document', 'access_grant', 'revocation_request', 'user', 'manager'],
    example: 'document',
  })
  targetType?:
    | 'document'
    | 'access_grant'
    | 'revocation_request'
    | 'user'
    | 'manager';

  @ApiPropertyOptional({
    description: 'Target ID',
    type: String,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  targetId?: string | number;

  @ApiPropertyOptional({
    description: 'Document ID (if applicable)',
    type: String,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  documentId?: string;

  @ApiPropertyOptional({
    description: 'Origin manager ID (if applicable)',
    type: Number,
    example: 123,
  })
  originManagerId?: number;

  @ApiPropertyOptional({
    description: 'Access subject type (if applicable)',
    enum: ['user', 'manager'],
    example: 'user',
  })
  accessSubjectType?: 'user' | 'manager';

  @ApiPropertyOptional({
    description: 'Access subject ID (if applicable)',
    type: Number,
    example: 789,
  })
  accessSubjectId?: number;

  @ApiPropertyOptional({
    description: 'Grant type (if applicable)',
    enum: ['owner', 'delegated', 'derived'],
    example: 'delegated',
  })
  grantType?: 'owner' | 'delegated' | 'derived';

  @ApiProperty({
    description: 'Operation success status',
    type: Boolean,
    example: true,
  })
  success: boolean;

  @ApiPropertyOptional({
    description: 'Error type (sanitized, no PHI)',
    type: String,
    example: 'ACCESS_DENIED',
  })
  errorType?: string;

  @ApiPropertyOptional({
    description: 'Error message (sanitized, no PHI)',
    type: String,
    example: 'No active access grant found',
  })
  errorMessage?: string;

  @ApiPropertyOptional({
    description: 'Request IP address (for security monitoring)',
    type: String,
    example: '192.168.1.200',
  })
  ipAddress?: string;

  @ApiPropertyOptional({
    description: 'User agent (sanitized, truncated)',
    type: String,
    example: 'Mozilla/5.0...',
  })
  userAgent?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata (no PHI)',
    type: Object,
    example: { accessType: 'explicit_grant', fileSize: 1024 },
  })
  metadata?: Record<string, any>;
}
