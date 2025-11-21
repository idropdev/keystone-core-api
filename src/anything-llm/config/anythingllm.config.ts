import { registerAs } from '@nestjs/config';
import validateConfig from '../../utils/validate-config';
import { IsString, IsUrl } from 'class-validator';
import { AnythingLLMConfig } from './anythingllm-config.type';

class EnvironmentVariablesValidator {
  @IsUrl({ require_tld: false })
  ANYTHINGLLM_API_URL: string;

  @IsString()
  ANYTHINGLLM_API_KEY: string;
}

export default registerAs<AnythingLLMConfig>('anythingllm', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    apiUrl: process.env.ANYTHINGLLM_API_URL || 'http://localhost:3001',
    apiKey: process.env.ANYTHINGLLM_API_KEY || '',
  };
});
