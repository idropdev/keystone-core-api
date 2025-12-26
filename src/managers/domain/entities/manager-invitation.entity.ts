/**
 * Domain entity for ManagerInvitation
 * Represents a temporary, auditable object that gates manager creation
 * 
 * HIPAA Requirement: Prevents self-signup, enforces admin-controlled onboarding
 */
export class ManagerInvitation {
  id: number;
  email: string;
  
  // Manager identity fields (set at invitation time)
  displayName: string; // REQUIRED: "Quest Diagnostics – Downtown Lab"
  legalName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phoneNumber?: string;
  
  invitedByAdminId: number;
  token: string; // One-time, expiring token (crypto-secure)
  expiresAt: Date;
  acceptedAt?: Date;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
}
