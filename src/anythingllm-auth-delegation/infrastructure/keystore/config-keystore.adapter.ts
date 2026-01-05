import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../../config/config.type';
import { KeystorePort } from './keystore.port';

/**
 * Adapter implementing key management using ConfigService
 * TODO: migrate to GCP Secret Manager
 */
@Injectable()
export class ConfigKeystoreAdapter implements KeystorePort {
  constructor(
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async getDelegatedTokenSecret(): Promise<string> {
    const secret = this.configService.get<string>(
      'anythingllm.delegatedTokenSecret',
      { infer: true },
    );

    if (!secret) {
      throw new Error(
        'ANYTHINGLLM_DELEGATED_TOKEN_SECRET is not configured. TODO: migrate to GCP Secret Manager',
      );
    }

    return secret;
  }

  async getIssuer(): Promise<string | undefined> {
    return this.configService.get<string>('auth.jwtIssuer', { infer: true });
  }
}








