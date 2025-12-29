import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
  ApiParam,
} from '@nestjs/swagger';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { AuditQueryService } from './audit-query.service';
import { ListAuditEventsDto } from './dto/list-audit-events.dto';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { extractActorFromRequest } from '../document-processing/utils/actor-extractor.util';

/**
 * Audit Controller
 *
 * Provides endpoints for querying audit events.
 *
 * HIPAA Compliance:
 * - All queries are logged (who accessed audit logs)
 * - Only admins and origin managers can query
 * - Users and secondary managers are denied
 * - No PHI in responses (only IDs and metadata)
 *
 * Authorization:
 * - GET /v1/audit/events: Admin or Origin Manager only
 * - GET /v1/audit/events/:id: Admin or Origin Manager only
 */
@ApiTags('Audit')
@Controller({ path: 'audit', version: '1' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditQueryService: AuditQueryService) {}

  @Get('events')
  @Roles(RoleEnum.admin, RoleEnum.manager)
  @ApiOperation({
    summary: 'Query Audit Events',
    description:
      'Query audit events with filtering and pagination. Only admins and origin managers can access audit logs. ' +
      'Origin managers can only query events for their documents.',
  })
  @ApiOkResponse({
    description: 'List of audit events (paginated)',
    type: InfinityPaginationResponseDto<AuditEventResponseDto>,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description:
      'Insufficient permissions. Admin or origin manager role required.',
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  async listEvents(
    @Query() query: ListAuditEventsDto,
    @Request() req,
  ): Promise<InfinityPaginationResponseDto<AuditEventResponseDto>> {
    const actor = extractActorFromRequest(req);

    // Additional authorization: managers can only query their own documents
    if (actor.type === 'manager' && query.originManagerId) {
      if (query.originManagerId !== actor.id) {
        throw new ForbiddenException(
          'Managers can only query audit events for their own documents.',
        );
      }
    }

    return this.auditQueryService.listEvents(query, actor);
  }

  @Get('events/:id')
  @Roles(RoleEnum.admin, RoleEnum.manager)
  @ApiOperation({
    summary: 'Get Audit Event by ID',
    description:
      'Get a specific audit event by ID. Only admins and origin managers can access audit logs.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Audit event ID',
    example: 1001,
  })
  @ApiOkResponse({
    description: 'Audit event details',
    type: AuditEventResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description:
      'Insufficient permissions. Admin or origin manager role required.',
  })
  @ApiBadRequestResponse({ description: 'Invalid event ID' })
  async getEvent(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req,
  ): Promise<AuditEventResponseDto> {
    const actor = extractActorFromRequest(req);
    return this.auditQueryService.getEvent(eventId, actor);
  }
}
