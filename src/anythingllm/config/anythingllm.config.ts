import { registerAs } from '@nestjs/config';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { AnythingLLMConfig } from './anythingllm-config.type';
import validateConfig from '../../utils/validate-config';

class EnvironmentVariablesValidator {
  @IsEnum(['gcp', 'local_jwt'])
  @IsOptional()
  ANYTHINGLLM_SERVICE_AUTH_MODE?: 'gcp' | 'local_jwt';

  @IsString()
  @IsOptional()
  ANYTHINGLLM_SERVICE_AUDIENCE?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  ANYTHINGLLM_BASE_URL?: string;

  @IsBoolean()
  @IsOptional()
  ENABLE_DELEGATED_TOKENS?: boolean;

  @IsNumber()
  @IsOptional()
  ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN?: number;

  @IsString()
  @IsOptional()
  ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE?: string;

  @IsString()
  @IsOptional()
  ANYTHINGLLM_DELEGATED_TOKEN_SECRET?: string;
}

export default registerAs<AnythingLLMConfig>('anythingllm', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    serviceAuthMode:
      (process.env.ANYTHINGLLM_SERVICE_AUTH_MODE as 'gcp' | 'local_jwt') ||
      'gcp',
    serviceAudience:
      process.env.ANYTHINGLLM_SERVICE_AUDIENCE || 'anythingllm-internal',
    baseUrl: process.env.ANYTHINGLLM_BASE_URL || '',
    enableDelegatedTokens:
      process.env.ENABLE_DELEGATED_TOKENS === 'true' || false,
    delegatedTokenSecret: process.env.ANYTHINGLLM_DELEGATED_TOKEN_SECRET || '',
    delegatedTokenExpiresIn: process.env.ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN
      ? parseInt(process.env.ANYTHINGLLM_DELEGATED_TOKEN_EXPIRES_IN, 10)
      : 300, // Default: 5 minutes
    delegatedTokenAudience:
      process.env.ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE || 'anythingllm',
  };
});
