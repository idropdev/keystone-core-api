import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiParam,
} from '@nestjs/swagger';
import { RolesGuard } from '../../roles/roles.guard';
import { Roles } from '../../roles/roles.decorator';
import { RoleEnum } from '../../roles/roles.enum';
import { ManagerOnboardingDomainService } from '../domain/services/manager-onboarding.domain.service';
import { CreateManagerInvitationDto } from '../dto/create-manager-invitation.dto';
import { VerifyManagerDto } from '../dto/verify-manager.dto';
import { SuspendManagerDto } from '../dto/suspend-manager.dto';
import { extractActorFromRequest } from '../../document-processing/utils/actor-extractor.util';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@ApiTags('Admin - Managers')
@Controller({ path: 'admin', version: '1' })
export class AdminManagersController {
  constructor(
    private readonly onboardingService: ManagerOnboardingDomainService,
  ) {}

  @Post('manager-invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite Manager (Admin Only)',
    description:
      'Invite a manager to onboard. Creates a ManagerInvitation with a secure, one-time token and manager identity fields.',
  })
  @ApiCreatedResponse({
    description: 'Manager invitation created successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        email: { type: 'string' },
        displayName: { type: 'string' },
        token: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['pending'] },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiBadRequestResponse({ description: 'Invalid request body' })
  async inviteManager(@Request() req, @Body() dto: CreateManagerInvitationDto) {
    const actor = extractActorFromRequest(req);
    if (actor.type !== 'admin') {
      throw new Error('Admin role required');
    }

    return this.onboardingService.inviteManager({
      email: dto.email,
      displayName: dto.displayName,
      legalName: dto.legalName,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      phoneNumber: dto.phoneNumber,
      invitedByAdminId: actor.id,
    });
  }

  @Get('managers')
  @ApiOperation({
    summary: 'List Managers (Admin Only)',
    description:
      'Get a paginated list of all managers. Filterable by verification status.',
  })
  @ApiOkResponse({
    description: 'List of managers',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  async listManagers(
    @Query('status') status?: 'verified' | 'pending' | 'suspended',
  ) {
    // TODO: Implement manager listing with filtering
    // For now, return empty array
    return { data: [], hasNextPage: false };
  }

  @Patch('managers/:id/verify')
  @ApiOperation({
    summary: 'Verify Manager (Admin Only)',
    description:
      'Verify a manager after review. Sets manager verification_status = "verified".',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Manager ID' })
  @ApiOkResponse({
    description: 'Manager verified successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({ description: 'Manager not found' })
  @ApiBadRequestResponse({ description: 'Manager already verified' })
  async verifyManager(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyManagerDto,
  ) {
    const logger = new Logger(AdminManagersController.name);

    logger.log(
      `[VERIFY MANAGER] Request received: adminId=${req.user?.id}, managerId=${id}, ` +
        `status=${dto.status}`,
    );

    const actor = extractActorFromRequest(req);
    if (actor.type !== 'admin') {
      logger.error(
        `[VERIFY MANAGER] ❌ Non-admin attempted to verify: actorType=${actor.type}, actorId=${actor.id}`,
      );
      throw new Error('Admin role required');
    }

    const result = await this.onboardingService.verifyManager(actor.id, id);

    logger.log(
      `[VERIFY MANAGER] ✅ Verification completed: managerId=${id}, resultId=${result.id}`,
    );

    return result;
  }

  @Patch('managers/:id/suspend')
  @ApiOperation({
    summary: 'Suspend Manager (Admin Only)',
    description:
      'Emergency suspension of a manager. Disables all access and prevents new documents.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Manager ID' })
  @ApiOkResponse({
    description: 'Manager suspended successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({ description: 'Manager not found' })
  async suspendManager(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SuspendManagerDto,
  ) {
    const actor = extractActorFromRequest(req);
    if (actor.type !== 'admin') {
      throw new Error('Admin role required');
    }

    return this.onboardingService.suspendManager(actor.id, id, dto.reason);
  }

  @Delete('managers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete Manager (Admin Only)',
    description:
      'Hard delete a manager. Preconditions: No origin documents OR documents reassigned.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Manager ID' })
  @ApiOkResponse({ description: 'Manager deleted successfully' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  @ApiNotFoundResponse({ description: 'Manager not found' })
  @ApiBadRequestResponse({
    description: 'Cannot delete manager with origin documents',
  })
  async deleteManager(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const actor = extractActorFromRequest(req);
    if (actor.type !== 'admin') {
      throw new Error('Admin role required');
    }

    // TODO: Implement manager deletion with preconditions check
    // For now, throw not implemented
    throw new Error('Manager deletion not yet implemented');
  }
}
