/**
 * Port interface for JWT signing
 * Defines the contract for signing JWT tokens
 */

export interface JwtSignerPort {
  /**
   * Sign a token payload and return the JWT string
   *
   * @param payload - Token payload to sign
   * @param secret - Secret key for signing
   * @param expiresInSeconds - Token expiration in seconds
   * @returns Promise resolving to the signed JWT token string
   */
  sign(
    payload: Record<string, unknown>,
    secret: string,
    expiresInSeconds: number,
  ): Promise<string>;
}










