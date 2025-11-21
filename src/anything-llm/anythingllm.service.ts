import { Injectable, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { User } from '../users/domain/user';
import { RoleEnum } from '../roles/roles.enum';

@Injectable()
export class AnythingLLMService {
  private readonly logger = new Logger(AnythingLLMService.name);

  constructor(private configService: ConfigService<AllConfigType>) {}

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
          this.logger.log(
            `User ${username} already exists in AnythingLLM. Skipping.`,
          );
          return;
        }

        throw new HttpException(
          errorData.error || `AnythingLLM API error: ${response.status}`,
          response.status,
        );
      }

      const data = await response.json();

      if (data.user) {
        this.logger.log(
          `Successfully created user ${username} (ID: ${data.user.id}) in AnythingLLM for Keystone user ${keystoneUser.id}`,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        this.logger.error(
          `Failed to create user in AnythingLLM for Keystone user ${keystoneUser.id}: ${error.message}`,
        );
      } else if (error.name === 'TimeoutError') {
        this.logger.error(
          `Timeout creating user in AnythingLLM for Keystone user ${keystoneUser.id}`,
        );
      } else {
        this.logger.error(
          `Unexpected error creating user in AnythingLLM for Keystone user ${keystoneUser.id}: ${error.message}`,
        );
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
