import {
  Controller,
  Post,
  Get,
  Patch,
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
import { RevocationRequestDomainService } from './domain/services/revocation-request.domain.service';
import { RevocationService } from './revocation.service';
import { CreateRevocationRequestDto } from './dto/create-revocation-request.dto';
import { ListRevocationRequestsDto } from './dto/list-revocation-requests.dto';
import { RevocationRequestResponseDto } from './dto/revocation-request-response.dto';
import { ApproveRevocationRequestDto } from './dto/approve-revocation-request.dto';
import { DenyRevocationRequestDto } from './dto/deny-revocation-request.dto';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { InfinityPaginationResponse } from '../utils/dto/infinity-pagination-response.dto';
import { extractActorFromRequest } from '../document-processing/utils/actor-extractor.util';
import { RoleEnum } from '../roles/roles.enum';

/**
 * Revocation Request Controller
 * 
 * Handles revocation request workflow endpoints.
 * 
 * HIPAA Compliance:
 * - All endpoints protected by JWT authentication
 * - Authorization enforced (origin manager for approve/deny, requester for cancel)
 * - All workflow steps audit logged
 * - No PHI in responses
 * 
 * Authorization Rules:
 * - Create: Any user/manager with document access
 * - List: Origin manager (all requests) or requester (own requests)
 * - Approve: Origin manager only
 * - Deny: Origin manager only
 * - Cancel: Requester only
 * - Admins: Hard-denied from all endpoints
 */
@ApiTags('Revocation Requests')
@Controller({ path: 'revocation-requests', version: '1' })
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class RevocationController {
  constructor(
    private readonly revocationService: RevocationService,
    private readonly revocationDomainService: RevocationRequestDomainService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create Revocation Request',
    description:
      'Create a revocation request for a document. Only users/managers with access to the document can create requests.',
  })
  @ApiCreatedResponse({
    description: 'Revocation request created successfully',
    type: RevocationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request data or duplicate pending request',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Requester does not have access to the document or admin attempting access',
  })
  @ApiNotFoundResponse({
    description: 'Document not found',
  })
  async createRequest(
    @Request() req,
    @Body() dto: CreateRevocationRequestDto,
  ): Promise<RevocationRequestResponseDto> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    return this.revocationService.createRequest(
      dto.documentId,
      dto.requestType,
      dto.cascadeToSecondaryManagers || false,
      actor,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List Revocation Requests',
    description:
      'List revocation requests with optional filtering. Origin managers see all requests for their documents. Others see only their own requests.',
  })
  @ApiQuery({
    name: 'documentId',
    required: false,
    type: String,
    description: 'Filter by document ID (UUID)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'approved', 'denied', 'cancelled'],
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'requestType',
    required: false,
    enum: ['self_revocation', 'user_revocation', 'manager_revocation'],
    description: 'Filter by request type',
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
    description: 'Paginated list of revocation requests',
    type: InfinityPaginationResponse(RevocationRequestResponseDto),
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Admin attempting access',
  })
  async listRequests(
    @Request() req,
    @Query() query: ListRevocationRequestsDto,
  ): Promise<InfinityPaginationResponseDto<RevocationRequestResponseDto>> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    return this.revocationService.listRequests(query, actor);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Revocation Request by ID',
    description:
      'Get a specific revocation request. Origin managers can see any request for their documents. Others can only see their own requests.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Revocation request ID',
    example: 1,
  })
  @ApiOkResponse({
    description: 'Revocation request details',
    type: RevocationRequestResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Actor does not have permission to view this request',
  })
  @ApiNotFoundResponse({
    description: 'Revocation request not found',
  })
  async getRequest(
    @Request() req,
    @Param('id', ParseIntPipe) requestId: number,
  ): Promise<RevocationRequestResponseDto> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    return this.revocationService.getRequest(requestId, actor);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve Revocation Request',
    description:
      'Approve a revocation request. Only origin managers can approve requests. This will revoke access grants and update the request status.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Revocation request ID',
    example: 1,
  })
  @ApiOkResponse({
    description: 'Revocation request approved successfully',
    type: RevocationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request is not in pending status',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Only origin manager can approve revocation requests',
  })
  @ApiNotFoundResponse({
    description: 'Revocation request or document not found',
  })
  async approveRequest(
    @Request() req,
    @Param('id', ParseIntPipe) requestId: number,
    @Body() dto: ApproveRevocationRequestDto,
  ): Promise<RevocationRequestResponseDto> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    const request = await this.revocationDomainService.approveRequest(
      requestId,
      dto.reviewNotes,
      actor,
    );
    return this.revocationService.toResponseDto(request);
  }

  @Patch(':id/deny')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deny Revocation Request',
    description:
      'Deny a revocation request. Only origin managers can deny requests. This updates the request status but does not revoke access.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Revocation request ID',
    example: 1,
  })
  @ApiOkResponse({
    description: 'Revocation request denied successfully',
    type: RevocationRequestResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request is not in pending status',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Only origin manager can deny revocation requests',
  })
  @ApiNotFoundResponse({
    description: 'Revocation request or document not found',
  })
  async denyRequest(
    @Request() req,
    @Param('id', ParseIntPipe) requestId: number,
    @Body() dto: DenyRevocationRequestDto,
  ): Promise<RevocationRequestResponseDto> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    const request = await this.revocationDomainService.denyRequest(
      requestId,
      dto.reviewNotes,
      actor,
    );
    return this.revocationService.toResponseDto(request);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel Revocation Request',
    description:
      'Cancel a pending revocation request. Only the requester can cancel their own requests.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Revocation request ID',
    example: 1,
  })
  @ApiNoContentResponse({
    description: 'Revocation request cancelled successfully',
  })
  @ApiBadRequestResponse({
    description: 'Request is not in pending status',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiForbiddenResponse({
    description: 'Only the requester can cancel a revocation request',
  })
  @ApiNotFoundResponse({
    description: 'Revocation request not found',
  })
  async cancelRequest(
    @Request() req,
    @Param('id', ParseIntPipe) requestId: number,
  ): Promise<void> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    await this.revocationDomainService.cancelRequest(requestId, actor);
  }
}

