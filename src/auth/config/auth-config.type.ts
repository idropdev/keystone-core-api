import ms from 'ms';

export type AuthConfig = {
  secret?: string;
  expires?: ms.StringValue;
  refreshSecret?: string;
  refreshExpires?: ms.StringValue;
  forgotSecret?: string;
  forgotExpires?: ms.StringValue;
  confirmEmailSecret?: string;
  confirmEmailExpires?: ms.StringValue;
  // Token introspection (RFC 7662)
  introspectionServiceKey?: string;
  introspectionRateLimit?: number;
  // JWT standards (RFC 7519, RFC 9068)
  jwtIssuer?: string;
  jwtAudience?: string;
  jwtKeyId?: string;
  jwtAllowedAlgorithms?: string[];
};
