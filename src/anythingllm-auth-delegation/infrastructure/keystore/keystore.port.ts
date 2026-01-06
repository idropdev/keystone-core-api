/**
 * Port interface for key management
 * Defines the contract for retrieving JWT secrets
 * TODO: migrate to GCP Secret Manager
 */

export interface KeystorePort {
  /**
   * Get the secret key for delegated token signing
   *
   * @returns Promise resolving to the secret key
   * @throws Error if secret is not configured
   */
  getDelegatedTokenSecret(): Promise<string>;

  /**
   * Get the issuer URL (optional)
   *
   * @returns Promise resolving to issuer URL or undefined
   */
  getIssuer(): Promise<string | undefined>;
}










