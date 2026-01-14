import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../roles/roles.guard';
import { Roles } from '../../roles/roles.decorator';
import { RoleEnum } from '../../roles/roles.enum';
import { ManagerProfileDomainService } from '../domain/services/manager-profile.domain.service';
import { UpdateManagerProfileDto } from '../dto/update-manager-profile.dto';
import { extractActorFromRequest } from '../../document-processing/utils/actor-extractor.util';
import { ManagerRepositoryPort } from '../domain/repositories/manager.repository.port';
import { Inject } from '@nestjs/common';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.manager)
@ApiTags('Managers')
@Controller({ path: 'managers', version: '1' })
export class ManagersController {
  constructor(
    private readonly profileService: ManagerProfileDomainService,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get My Manager Profile',
    description:
      "Get the current manager's profile and verification status. Requires verified manager.",
  })
  @ApiOkResponse({
    description: 'Manager profile retrieved successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Manager role required.',
  })
  async getMyProfile(@Request() req) {
    const actor = extractActorFromRequest(req);
    if (actor.type !== 'manager') {
      throw new Error('Manager role required');
    }

    // Find Manager by userId
    const manager = await this.managerRepository.findByUserId(actor.id);
    if (!manager) {
      throw new Error('Manager not found for this user');
    }

    return this.profileService.getManagerProfile(manager.id);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update My Manager Profile',
    description:
      'Update non-sensitive profile data. Restrictions: Cannot update verification status.',
  })
  @ApiOkResponse({
    description: 'Manager profile updated successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Verified manager role required.',
  })
  async updateMyProfile(@Request() req, @Body() dto: UpdateManagerProfileDto) {
    const logger = new Logger(ManagersController.name);

    logger.log(
      `[UPDATE MY PROFILE] Request received: userId=${req.user?.id}, roleId=${req.user?.role?.id}, ` +
        `updates=${JSON.stringify(dto)}`,
    );

    const actor = extractActorFromRequest(req);
    logger.debug(
      `[UPDATE MY PROFILE] Actor extracted: type=${actor.type}, id=${actor.id}`,
    );

    if (actor.type !== 'manager') {
      logger.warn(
        `[UPDATE MY PROFILE] ❌ FORBIDDEN (403): Non-manager actor attempted to update profile: type=${actor.type}, id=${actor.id}`,
      );
      throw new ForbiddenException('Manager role required');
    }

    // Find Manager by userId
    logger.debug(
      `[UPDATE MY PROFILE] Looking up Manager for userId=${actor.id}`,
    );
    const manager = await this.managerRepository.findByUserId(actor.id);
    if (!manager) {
      logger.error(
        `[UPDATE MY PROFILE] ❌ Manager not found for userId=${actor.id}`,
      );
      throw new NotFoundException('Manager not found for this user');
    }

    logger.log(
      `[UPDATE MY PROFILE] Found Manager: managerId=${manager.id}, displayName="${manager.displayName}"`,
    );

    const result = await this.profileService.updateManagerProfile(
      manager.id,
      dto,
    );

    logger.log(
      `[UPDATE MY PROFILE] ✅ Profile updated successfully: managerId=${manager.id}`,
    );

    return result;
  }

  @Get()
  @ApiOperation({
    summary: 'List Verified Managers (Directory)',
    description:
      'Get a list of verified managers. Only verified managers appear in the directory.',
  })
  @ApiOkResponse({
    description: 'List of verified managers',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired access token' })
  async listManagers() {
    // Return only verified managers
    return this.managerRepository.findAllVerified();
  }
}
