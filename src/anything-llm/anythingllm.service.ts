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

      if (data.user) {
        // HIPAA Compliance: Log without username (only user IDs)
        this.logger.log(
          `Successfully created user in AnythingLLM (external ID: ${data.user.id}) for Keystone user ${keystoneUser.id}`,
        );

        // HIPAA Audit: Log successful user creation
        this.auditService.logAuthEvent({
          userId: keystoneUser.id,
          provider: 'anythingllm',
          event: AuthEventType.ACCOUNT_CREATED,
          success: true,
          metadata: {
            action: 'user_created',
            externalService: 'anythingllm',
            externalUserId: data.user.id?.toString(),
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
}
