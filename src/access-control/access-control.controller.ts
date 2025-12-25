import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNoContentResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { AccessControlService } from './access-control.service';
import { CreateAccessGrantDto } from './dto/create-access-grant.dto';
import { ListAccessGrantsDto } from './dto/list-access-grants.dto';
import { AccessGrantResponseDto } from './dto/access-grant-response.dto';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { extractActorFromRequest } from '../document-processing/utils/actor-extractor.util';
import { RoleEnum } from '../roles/roles.enum';
import { InfinityPaginationResponse } from '../utils/dto/infinity-pagination-response.dto';

/**
 * Access Control Controller
 * 
 * Handles access grant creation, listing, and revocation.
 * 
 * HIPAA Compliance:
 * - All endpoints protected by JWT authentication
 * - Authorization enforced (origin manager or grant subject)
 * - All mutations audit logged
 * - No PHI in responses
 * 
 * Authorization Rules:
 * - Create: Origin manager or user with delegated grant authority
 * - List: Origin manager (all grants) or grant subject (own grants)
 * - Revoke: Origin manager or grant creator (for delegated grants)
 * - Admins: Hard-denied from all endpoints
 */
@ApiTags('Access Grants')
@Controller({ path: 'access-grants', version: '1' })
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AccessControlController {
  constructor(private readonly accessControlService: AccessControlService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create Access Grant',
    description:
      'Create a new access grant for a document. Only origin managers or users with delegated grant authority can create grants.',
  })
  @ApiCreatedResponse({
    description: 'Access grant created successfully',
    type: AccessGrantResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request data or grant already exists',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Actor does not have authority to create grants for this document',
  })
  @ApiNotFoundResponse({
    description: 'Document not found',
  })
  async createGrant(
    @Request() req,
    @Body() dto: CreateAccessGrantDto,
  ): Promise<AccessGrantResponseDto> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    return this.accessControlService.createGrant(dto, actor);
  }

  @Get()
  @ApiOperation({
    summary: 'List Access Grants',
    description:
      'List access grants with optional filtering. If documentId is provided, returns grants for that document (origin manager sees all, others see own grants). If no documentId, returns actor\'s own grants.',
  })
  @ApiQuery({
    name: 'documentId',
    required: false,
    type: String,
    description: 'Filter by document ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'subjectType',
    required: false,
    enum: ['user', 'manager'],
    description: 'Filter by subject type',
  })
  @ApiQuery({
    name: 'subjectId',
    required: false,
    type: Number,
    description: 'Filter by subject ID',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
    example: 20,
  })
  @ApiOkResponse({
    description: 'Paginated list of access grants',
    type: InfinityPaginationResponse(AccessGrantResponseDto),
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Admin attempting access or insufficient permissions',
  })
  async listGrants(
    @Request() req,
    @Query() query: ListAccessGrantsDto,
  ): Promise<InfinityPaginationResponseDto<AccessGrantResponseDto>> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    return this.accessControlService.listGrants(query, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke Access Grant',
    description:
      'Revoke an access grant. Only origin managers or the grant creator (for delegated grants) can revoke grants.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Access grant ID',
    example: 1,
  })
  @ApiNoContentResponse({
    description: 'Access grant revoked successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Actor does not have authority to revoke this grant',
  })
  @ApiNotFoundResponse({
    description: 'Grant not found or already revoked',
  })
  async revokeGrant(
    @Request() req,
    @Param('id', ParseIntPipe) grantId: number,
  ): Promise<void> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    await this.accessControlService.revokeGrant(grantId, actor);
  }

  @Get('my-grants')
  @ApiOperation({
    summary: 'List My Active Grants',
    description:
      'List all active access grants for the authenticated actor (user or manager).',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
    example: 20,
  })
  @ApiOkResponse({
    description: 'Paginated list of actor\'s active grants',
    type: InfinityPaginationResponse(AccessGrantResponseDto),
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Admin attempting access',
  })
  async getMyGrants(
    @Request() req,
    @Query() query: { page?: number; limit?: number },
  ): Promise<InfinityPaginationResponseDto<AccessGrantResponseDto>> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    return this.accessControlService.getMyGrants(actor, query);
  }
}

