import { registerAs } from '@nestjs/config';
import { ThrottlerConfig } from './throttler-config.type';
import { IsInt, IsString, Min } from 'class-validator';
import validateConfig from '../utils/validate-config';

class EnvironmentVariablesValidator {
  @IsInt()
  @Min(1)
  THROTTLE_TTL: number;

  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number;

  @IsInt()
  @Min(1)
  THROTTLE_AUTH_TTL: number;

  @IsInt()
  @Min(1)
  THROTTLE_AUTH_LIMIT: number;

  @IsString()
  NODE_ENV: string;
}

export default registerAs<ThrottlerConfig>('throttler', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10), // milliseconds (default: 60s)
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '10', 10), // requests per TTL (default: 10)
    authTtl: parseInt(process.env.THROTTLE_AUTH_TTL ?? '60000', 10), // milliseconds for auth endpoints (default: 60s)
    authLimit: parseInt(process.env.THROTTLE_AUTH_LIMIT ?? '5', 10), // requests per TTL for auth endpoints (default: 5)
  };
});

// TODO: Fine-tune rate limits based on production traffic patterns
// TODO: Consider implementing distributed rate limiting using Redis for multi-instance deployments
// TODO: Add monitoring and alerting for rate limit violations (potential attack indicators)
