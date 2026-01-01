import { registerAs } from '@nestjs/config';
import { IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
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
  };
});
