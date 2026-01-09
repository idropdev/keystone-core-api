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
  constructor(private readonly configService: ConfigService<AllConfigType>) {}

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

    // Validate that secret is a symmetric key (not an RSA key)
    // RSA keys start with "-----BEGIN" which would cause jsonwebtoken to infer RS256
    if (secret.trim().startsWith('-----BEGIN')) {
      throw new Error(
        'ANYTHINGLLM_DELEGATED_TOKEN_SECRET appears to be an RSA key, but HS256 requires a symmetric key (plain string). Please use a symmetric secret for delegated tokens.',
      );
    }

    return secret;
  }

  async getIssuer(): Promise<string | undefined> {
    // Try to get issuer from auth.jwtIssuer config
    const issuer = this.configService.get<string>('auth.jwtIssuer', {
      infer: true,
    });

    if (issuer) {
      return issuer;
    }

    // Fallback: Try to get from app.url (for local development)
    const appUrl = this.configService.get<string>('app.url', { infer: true });
    if (appUrl) {
      return appUrl;
    }

    // Final fallback: Use localhost:3000/api (matches AnythingLLM expectations)
    // AnythingLLM expects one of: anythingllm-internal, http://localhost:3000/api, http://localhost:3000
    return 'http://localhost:3000/api';
  }
}
