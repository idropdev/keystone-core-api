import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';
import { SerializeOptions } from '@nestjs/common';
import { ManagerOnboardingDomainService } from '../domain/services/manager-onboarding.domain.service';
import { AcceptInvitationDto } from '../dto/accept-invitation.dto';

@ApiTags('Manager Onboarding')
@Controller({ path: 'manager-onboarding', version: '1' })
export class ManagerOnboardingController {
  constructor(
    private readonly onboardingService: ManagerOnboardingDomainService,
  ) {}

  @Get('invitations/:token')
  @ApiOperation({
    summary: 'Validate Invitation Token (Public)',
    description:
      'Validate an invitation token before signup. Returns manager display name and expiration.',
  })
  @ApiParam({
    name: 'token',
    type: String,
    description: 'Invitation token',
  })
  @ApiOkResponse({
    description: 'Invitation token is valid',
    schema: {
      type: 'object',
      properties: {
        displayName: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['pending'] },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Invalid or expired invitation token' })
  async validateInvitation(@Param('token') token: string) {
    return this.onboardingService.validateInvitation(token);
  }

  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Accept Invitation & Create Manager Profile (Public)',
    description:
      'Accept an invitation and create manager profile. Creates User (role = manager) and Manager (status = pending).',
  })
  @ApiCreatedResponse({
    description: 'Manager profile created successfully',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            email: { type: 'string' },
            role: { type: 'object' },
          },
        },
        manager: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            userId: { type: 'number' },
            displayName: { type: 'string' },
            verificationStatus: { type: 'string', enum: ['pending'] },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid token, expired invitation, or validation errors',
  })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  @SerializeOptions({
    groups: ['me'],
  })
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.onboardingService.acceptInvitation(dto);
  }
}
