/**
 * DTO for requester context extracted from JWT
 */
export interface RequesterContextDto {
  userId: string;
  roles: string[];
  sessionId?: string;
  provider?: string;
}










