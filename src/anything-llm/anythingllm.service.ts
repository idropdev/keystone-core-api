import { Injectable, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { User } from '../users/domain/user';
import { RoleEnum } from '../roles/roles.enum';
import { AuditService, AuthEventType } from '../audit/audit.service';

@Injectable()
export class AnythingLLMService {
  private readonly logger = new Logger(AnythingLLMService.name);

  constructor(
    private configService: ConfigService<AllConfigType>,
    private auditService: AuditService,
  ) {}

  async createUser(keystoneUser: User): Promise<void> {
    const apiKey = this.configService.get('anythingllm.apiKey', {
      infer: true,
    });
    const apiUrl = this.configService.get('anythingllm.apiUrl', {
      infer: true,
    });

    if (!apiKey || !apiUrl) {
      this.logger.warn(
        'AnythingLLM integration not configured. Skipping user creation.',
      );
      return;
    }

    // HIPAA Compliance: Enforce HTTPS in production
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    if (nodeEnv === 'production') {
      try {
        const url = new URL(apiUrl);
        if (url.protocol !== 'https:') {
          this.logger.error(
            'AnythingLLM API URL must use HTTPS in production for HIPAA compliance',
          );
          this.auditService.logAuthEvent({
            userId: keystoneUser.id,
            provider: 'anythingllm',
            event: AuthEventType.ACCOUNT_CREATED,
            success: false,
            errorMessage: 'HTTPS required in production',
            metadata: {
              action: 'create_user_blocked',
              externalService: 'anythingllm',
              reason: 'http_in_production',
            },
          });
          return;
        }
      } catch {
        this.logger.error('Invalid AnythingLLM API URL');
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: 'Invalid API URL',
          metadata: {
            action: 'create_user_blocked',
            externalService: 'anythingllm',
            reason: 'invalid_url',
          },
        });
        return;
      }
    }

    try {
      const username = this.generateUsername(keystoneUser);
      const role = this.mapRole(keystoneUser.role);
      const placeholderPassword = `test12345`;

      const response = await fetch(`${apiUrl}/api/v1/admin/users/new`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password: placeholderPassword,
          role,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (
          response.status === 400 &&
          errorData.error?.includes('already exists')
        ) {
          // HIPAA Compliance: Log without username (only user ID)
          this.logger.log(
            `User already exists in AnythingLLM for Keystone user ${keystoneUser.id}. Skipping.`,
          );
          // HIPAA Audit: Log user already exists (not an error, but logged for audit)
          this.auditService.logAuthEvent({
            userId: keystoneUser.id,
            provider: 'anythingllm',
            event: AuthEventType.ACCOUNT_CREATED,
            success: true,
            metadata: {
              action: 'user_already_exists',
              externalService: 'anythingllm',
            },
          });
          return;
        }

        // HIPAA Audit: Log failed user creation
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: `HTTP ${response.status}`,
          metadata: {
            action: 'create_user_failed',
            externalService: 'anythingllm',
            httpStatus: response.status,
          },
        });

        throw new HttpException(
          errorData.error || `AnythingLLM API error: ${response.status}`,
          response.status,
        );
      }

      const data = await response.json();
      const anythingLLMUserId = data.user?.id;

      if (anythingLLMUserId) {
        await this.createWorkspace(anythingLLMUserId, keystoneUser);
      } else {
        this.logger.error(
          `Failed to get external AnythingLLM user ID from response: ${JSON.stringify(data)}`,
        );
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: 'Failed to get external user ID',
          metadata: {
            action: 'create_user_failed_no_external_id',
            externalService: 'anythingllm',
          },
        });
      }
    } catch (error) {
      if (error instanceof HttpException) {
        this.logger.error(
          `Failed to create user in AnythingLLM for Keystone user ${keystoneUser.id}: ${error.message}`,
        );
        // HIPAA Audit: Log failed user creation
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: error.message.substring(0, 100), // Sanitized
          metadata: {
            action: 'create_user_error',
            externalService: 'anythingllm',
          },
        });
      } else if (error.name === 'TimeoutError') {
        this.logger.error(
          `Timeout creating user in AnythingLLM for Keystone user ${keystoneUser.id}`,
        );
        // HIPAA Audit: Log timeout
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: 'timeout',
          metadata: {
            action: 'create_user_timeout',
            externalService: 'anythingllm',
          },
        });
      } else {
        this.logger.error(
          `Unexpected error creating user in AnythingLLM for Keystone user ${keystoneUser.id}: ${error.message}`,
        );
        // HIPAA Audit: Log unexpected error
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: 'unexpected_error',
          metadata: {
            action: 'create_user_unexpected_error',
            externalService: 'anythingllm',
          },
        });
      }
    }
  }

  private async createWorkspace(
    anythingLLMUserId: number,
    keystoneUser: User,
  ): Promise<void> {
    const apiKey = this.configService.get('anythingllm.apiKey', {
      infer: true,
    });
    const apiUrl = this.configService.get('anythingllm.apiUrl', {
      infer: true,
    });

    if (!apiKey || !apiUrl) {
      return;
    }

    // Step 1: Check if multi-user mode is enabled
    let isMultiUserMode = false;
    try {
      const modeCheckResponse = await fetch(
        `${apiUrl}/api/v1/admin/is-multi-user-mode`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(5000),
        },
      );

      if (modeCheckResponse.ok) {
        const modeData = await modeCheckResponse.json();
        isMultiUserMode = modeData.isMultiUser === true;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to check multi-user mode for Keystone user ${keystoneUser.id}: ${error.message}`,
      );
      // Continue anyway - will try to create workspace
    }

    // Generate default workspace name
    const workspaceName = this.generateWorkspaceName();

    try {
      // Step 2: Create workspace
      const createResponse = await fetch(`${apiUrl}/api/v1/workspace/new`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: workspaceName,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}));
        throw new HttpException(
          errorData.error ||
            `Failed to create workspace: ${createResponse.status}`,
          createResponse.status,
        );
      }

      const createData = await createResponse.json();
      const workspace = createData.workspace;

      if (!workspace || !workspace.slug) {
        throw new Error('Workspace created but missing slug');
      }

      // Step 3: Link user to workspace (only if multi-user mode is enabled)
      if (isMultiUserMode) {
        const manageResponse = await fetch(
          `${apiUrl}/api/v1/admin/workspaces/${workspace.slug}/manage-users`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userIds: [anythingLLMUserId],
              reset: false, // Don't remove existing users, just add this one
            }),
            signal: AbortSignal.timeout(10000),
          },
        );

        if (!manageResponse.ok) {
          const errorData = await manageResponse.json().catch(() => ({}));
          this.logger.warn(
            `Failed to add user ${anythingLLMUserId} to workspace ${workspace.slug}: ${errorData.error || manageResponse.status}`,
          );
          // Log but don't throw - workspace exists, user can be added later
          this.auditService.logAuthEvent({
            userId: keystoneUser.id,
            provider: 'anythingllm',
            event: AuthEventType.ACCOUNT_CREATED,
            success: false,
            errorMessage: 'Workspace created but user linking failed',
            metadata: {
              action: 'workspace_user_link_failed',
              externalService: 'anythingllm',
              workspaceId: workspace.id?.toString(),
              workspaceSlug: workspace.slug,
            },
          });
          return;
        }
      } else {
        this.logger.warn(
          `Multi-user mode not enabled. Workspace ${workspace.slug} created but user ${anythingLLMUserId} not linked.`,
        );
        // Log that workspace was created but user linking skipped
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: true,
          metadata: {
            action: 'workspace_created_no_multi_user',
            externalService: 'anythingllm',
            workspaceId: workspace.id?.toString(),
            workspaceSlug: workspace.slug,
            note: 'Multi-user mode not enabled, user not linked',
          },
        });
      }

      this.logger.log(
        `Successfully created workspace ${workspace.slug} (ID: ${workspace.id})${isMultiUserMode ? ` and linked to user ${anythingLLMUserId}` : ''} for Keystone user ${keystoneUser.id}`,
      );

      // HIPAA Audit: Log workspace creation
      this.auditService.logAuthEvent({
        userId: keystoneUser.id,
        provider: 'anythingllm',
        event: AuthEventType.ACCOUNT_CREATED,
        success: true,
        metadata: {
          action: 'workspace_created',
          externalService: 'anythingllm',
          workspaceId: workspace.id?.toString(),
          workspaceSlug: workspace.slug,
          externalUserId: anythingLLMUserId.toString(),
          multiUserMode: isMultiUserMode,
        },
      });
    } catch (error) {
      if (error instanceof HttpException) {
        this.logger.error(
          `Failed to create workspace in AnythingLLM for Keystone user ${keystoneUser.id}: ${error.message}`,
        );
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: error.message.substring(0, 100), // Sanitized
          metadata: {
            action: 'create_workspace_error',
            externalService: 'anythingllm',
          },
        });
      } else if (error.name === 'TimeoutError') {
        this.logger.error(
          `Timeout creating workspace in AnythingLLM for Keystone user ${keystoneUser.id}`,
        );
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: 'timeout',
          metadata: {
            action: 'create_workspace_timeout',
            externalService: 'anythingllm',
          },
        });
      } else {
        this.logger.error(
          `Unexpected error creating workspace in AnythingLLM for Keystone user ${keystoneUser.id}: ${error.message}`,
        );
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: false,
          errorMessage: 'unexpected_error',
          metadata: {
            action: 'create_workspace_unexpected_error',
            externalService: 'anythingllm',
          },
        });
      }
    }
  }

  private generateUsername(user: User): string {
    if (user.email) {
      const emailPrefix = user.email.split('@')[0].toLowerCase();
      return emailPrefix.replace(/[^a-z0-9_\-.]/g, '').substring(0, 100);
    }
    return `user_${user.id}`;
  }

  private mapRole(keystoneRole: User['role']): string {
    if (!keystoneRole || !keystoneRole.id) {
      return 'default';
    }

    const roleMap: Record<number, string> = {
      [RoleEnum.admin]: 'admin',
      [RoleEnum.user]: 'default',
    };

    return roleMap[keystoneRole.id] || 'default';
  }

  private generateWorkspaceName(): string {
    // HIPAA Compliance: Use generic name without PII
    // Workspace names are logged in event logs, so we avoid user names/emails
    // Users have only one workspace, so a generic name is sufficient
    return 'User Workspace';
  }
}
