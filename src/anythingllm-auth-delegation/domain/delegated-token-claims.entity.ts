/**
 * Domain entity for delegated token claims structure
 * No infrastructure dependencies - pure domain model
 */

export interface ActorClaim {
  sub: string; // Requester user ID
  roles: string[]; // Requester roles (e.g., ['user'], ['manager'], ['admin'])
  sessionId?: string; // Optional: session ID for audit
  provider?: string; // Optional: auth provider (e.g., 'google', 'apple', 'email')
}

export interface DelegatedTokenClaims {
  sub: string; // Service identity: "svc-keystone"
  act: ActorClaim; // Actor claim (RFC 8693)
  scope: string[]; // OAuth2 scopes (e.g., ["anythingllm:thread:chat"])
  aud: string; // Audience: "anythingllm"
  iat: number; // Issued at (Unix timestamp)
  exp: number; // Expiration (Unix timestamp)
  iss?: string; // Optional: Issuer URL
  nbf?: number; // Optional: Not before (Unix timestamp)
}
