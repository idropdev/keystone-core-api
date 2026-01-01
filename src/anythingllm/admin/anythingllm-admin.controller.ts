import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ServiceIdentityGuard } from '../guards/service-identity.guard';
import { AnythingLLMAdminService } from './anythingllm-admin.service';
import { UpstreamError } from '../registry/upstream-error';
import {
  IsMultiUserModeResponseSchema,
  ListUsersResponseSchema,
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  UpdateUserRequestSchema,
  UserOperationResponseSchema,
  ListInvitesResponseSchema,
  CreateInviteRequestSchema,
  CreateInviteResponseSchema,
  InviteOperationResponseSchema,
  GetWorkspaceUsersResponseSchema,
  ManageWorkspaceUsersRequestSchema,
  ManageWorkspaceUsersResponseSchema,
  WorkspaceChatsRequestSchema,
  WorkspaceChatsResponseSchema,
  UpdatePreferencesRequestSchema,
  UpdatePreferencesResponseSchema,
} from '../registry/schemas';

/**
 * AnythingLLM Admin Controller
 *
 * Proxy controller for AnythingLLM admin endpoints.
 * All routes require service identity authentication.
 * End-user JWT tokens are explicitly rejected.
 *
 * HIPAA Compliance:
 * - Service identity guard ensures only authorized services can access
 * - Never logs tokens or sensitive authentication data
 * - All errors are normalized to prevent information leakage
 */
@ApiTags('AnythingLLM Admin')
@ApiBearerAuth('service-identity')
@Controller('api/anythingllm/admin')
@UseGuards(ServiceIdentityGuard)
export class AnythingLLMAdminController {
  private readonly logger = new Logger(AnythingLLMAdminController.name);

  constructor(private readonly adminService: AnythingLLMAdminService) {}

  // ============================================================
  // System Status
  // ============================================================

  @Get('is-multi-user-mode')
  @ApiOperation({ summary: 'Check if instance is in multi-user mode' })
  @ApiResponse({
    status: 200,
    description: 'Multi-user mode status',
    type: IsMultiUserModeResponseSchema,
  })
  async isMultiUserMode(): Promise<IsMultiUserModeResponseSchema> {
    try {
      const result = await this.adminService.isMultiUserMode();
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================
  // User Management
  // ============================================================

  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  @ApiResponse({
    status: 200,
    description: 'List of users',
    type: ListUsersResponseSchema,
  })
  async listUsers(): Promise<ListUsersResponseSchema> {
    try {
      const result = await this.adminService.listUsers();
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  @Post('users/new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({
    status: 200,
    description: 'Created user',
    type: CreateUserResponseSchema,
  })
  async createUser(
    @Body() body: CreateUserRequestSchema,
  ): Promise<CreateUserResponseSchema> {
    try {
      const result = await this.adminService.createUser(body);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  @Post('users/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an existing user' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Update result',
    type: UserOperationResponseSchema,
  })
  async updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUserRequestSchema,
  ): Promise<UserOperationResponseSchema> {
    try {
      const result = await this.adminService.updateUser(id, body);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete a user' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Delete result',
    type: UserOperationResponseSchema,
  })
  async deleteUser(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserOperationResponseSchema> {
    try {
      const result = await this.adminService.deleteUser(id);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================
  // Invitation Management
  // ============================================================

  @Get('invites')
  @ApiOperation({ summary: 'List all invitations' })
  @ApiResponse({
    status: 200,
    description: 'List of invitations',
    type: ListInvitesResponseSchema,
  })
  async listInvites(): Promise<ListInvitesResponseSchema> {
    try {
      const result = await this.adminService.listInvites();
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  @Post('invite/new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a new invitation' })
  @ApiResponse({
    status: 200,
    description: 'Created invitation',
    type: CreateInviteResponseSchema,
  })
  async createInvite(
    @Body() body: CreateInviteRequestSchema,
  ): Promise<CreateInviteResponseSchema> {
    try {
      const result = await this.adminService.createInvite(body);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  @Delete('invite/:id')
  @ApiOperation({ summary: 'Revoke an invitation' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Revoke result',
    type: InviteOperationResponseSchema,
  })
  async revokeInvite(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InviteOperationResponseSchema> {
    try {
      const result = await this.adminService.revokeInvite(id);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================
  // Workspace Management
  // ============================================================

  @Get('workspaces/:workspaceId/users')
  @ApiOperation({ summary: 'Get users with access to a workspace' })
  @ApiParam({ name: 'workspaceId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Workspace users',
    type: GetWorkspaceUsersResponseSchema,
  })
  async getWorkspaceUsers(
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
  ): Promise<GetWorkspaceUsersResponseSchema> {
    try {
      const result = await this.adminService.getWorkspaceUsers(workspaceId);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  @Post('workspaces/:workspaceSlug/manage-users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manage users in a workspace' })
  @ApiParam({ name: 'workspaceSlug', type: String })
  @ApiResponse({
    status: 200,
    description: 'Manage users result',
    type: ManageWorkspaceUsersResponseSchema,
  })
  async manageWorkspaceUsers(
    @Param('workspaceSlug') workspaceSlug: string,
    @Body() body: ManageWorkspaceUsersRequestSchema,
  ): Promise<ManageWorkspaceUsersResponseSchema> {
    try {
      const result = await this.adminService.manageWorkspaceUsers(
        workspaceSlug,
        body,
      );
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  @Post('workspace-chats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get workspace chats (paginated)' })
  @ApiResponse({
    status: 200,
    description: 'Workspace chats',
    type: WorkspaceChatsResponseSchema,
  })
  async getWorkspaceChats(
    @Body() body: WorkspaceChatsRequestSchema,
  ): Promise<WorkspaceChatsResponseSchema> {
    try {
      const result = await this.adminService.getWorkspaceChats(body);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================
  // System Preferences
  // ============================================================

  @Post('preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update system preferences' })
  @ApiResponse({
    status: 200,
    description: 'Preferences update result',
    type: UpdatePreferencesResponseSchema,
  })
  async updatePreferences(
    @Body() body: UpdatePreferencesRequestSchema,
  ): Promise<UpdatePreferencesResponseSchema> {
    try {
      const result = await this.adminService.updatePreferences(body);
      return result.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================
  // Error Handling
  // ============================================================

  /**
   * Convert UpstreamError to HttpException
   */
  private handleError(error: unknown): HttpException {
    if (error instanceof UpstreamError) {
      return new HttpException(error.toJSON(), error.status);
    }

    if (error instanceof HttpException) {
      return error;
    }

    this.logger.error(
      `Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`,
    );

    return new HttpException(
      {
        error: 'InternalError',
        message: 'An unexpected error occurred',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
