import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { AccessRequestDomainService } from './domain/services/access-request.domain.service';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { ReviewAccessRequestDto } from './dto/review-access-request.dto';
import { AccessRequestResponseDto } from './dto/access-request-response.dto';
import { ManagerRepositoryPort } from '../managers/domain/repositories/manager.repository.port';
import { plainToClass } from 'class-transformer';
import { Inject, ForbiddenException } from '@nestjs/common';

/**
 * Access Request Controller
 *
 * SYSTEM-100: Access Request Workflow
 *
 * Endpoints for managers to request document access
 * and for origin managers to approve/deny requests.
 */
@ApiTags('Access Requests')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({
  path: 'access-requests',
  version: '1',
})
export class AccessRequestController {
  constructor(
    private readonly accessRequestService: AccessRequestDomainService,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
  ) {}

  @Post()
  @Roles(RoleEnum.manager)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request access to a document' })
  @ApiResponse({
    status: 201,
    description: 'Access request created',
    type: AccessRequestResponseDto,
  })
  async createRequest(
    @Request() req: any,
    @Body() dto: CreateAccessRequestDto,
  ): Promise<AccessRequestResponseDto> {
    const manager = await this.managerRepository.findByUserId(req.user.id);
    if (!manager) {
      throw new ForbiddenException('Manager profile not found');
    }

    const request = await this.accessRequestService.createRequest(
      dto.documentId,
      manager.id,
      dto.requestReason,
    );

    return this.toResponseDto(request);
  }

  @Get('my-requests')
  @Roles(RoleEnum.manager)
  @ApiOperation({ summary: 'Get my access requests' })
  @ApiResponse({
    status: 200,
    description: 'List of my access requests',
    type: [AccessRequestResponseDto],
  })
  async getMyRequests(
    @Request() req: any,
  ): Promise<AccessRequestResponseDto[]> {
    const manager = await this.managerRepository.findByUserId(req.user.id);
    if (!manager) {
      throw new ForbiddenException('Manager profile not found');
    }

    const requests = await this.accessRequestService.getMyRequests(manager.id);
    return requests.map((r) => this.toResponseDto(r));
  }

  @Get('pending')
  @Roles(RoleEnum.manager)
  @ApiOperation({
    summary: 'Get pending requests for my documents (as origin manager)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of pending access requests',
    type: [AccessRequestResponseDto],
  })
  async getPendingRequests(
    @Request() req: any,
  ): Promise<AccessRequestResponseDto[]> {
    const manager = await this.managerRepository.findByUserId(req.user.id);
    if (!manager) {
      throw new ForbiddenException('Manager profile not found');
    }

    const requests =
      await this.accessRequestService.getPendingRequestsForOriginManager(
        manager.id,
      );
    return requests.map((r) => this.toResponseDto(r));
  }

  @Patch(':id/approve')
  @Roles(RoleEnum.manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve an access request' })
  @ApiParam({ name: 'id', description: 'Access request ID' })
  @ApiResponse({
    status: 200,
    description: 'Access request approved',
    type: AccessRequestResponseDto,
  })
  async approveRequest(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewAccessRequestDto,
  ): Promise<AccessRequestResponseDto> {
    const request = await this.accessRequestService.approveRequest(
      id,
      req.user.id,
      dto.reviewNotes,
    );

    return this.toResponseDto(request);
  }

  @Patch(':id/deny')
  @Roles(RoleEnum.manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deny an access request' })
  @ApiParam({ name: 'id', description: 'Access request ID' })
  @ApiResponse({
    status: 200,
    description: 'Access request denied',
    type: AccessRequestResponseDto,
  })
  async denyRequest(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewAccessRequestDto,
  ): Promise<AccessRequestResponseDto> {
    const request = await this.accessRequestService.denyRequest(
      id,
      req.user.id,
      dto.reviewNotes,
    );

    return this.toResponseDto(request);
  }

  private toResponseDto(request: any): AccessRequestResponseDto {
    return plainToClass(AccessRequestResponseDto, request, {
      excludeExtraneousValues: true,
    });
  }
}
