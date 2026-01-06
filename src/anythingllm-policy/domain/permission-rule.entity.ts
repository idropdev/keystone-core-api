/**
 * Domain entity for permission rules
 * No infrastructure dependencies - pure domain model
 */
export interface PermissionRule {
  allowed: boolean;
  scope: string[];
  reason?: string; // Optional reason for denial
}










