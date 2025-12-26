/**
 * Domain entity for Manager
 * Represents an independent, verified healthcare provider that can act as origin manager
 */
export class Manager {
  id: number;
  userId: number; // Links to User entity (manager must have role 'manager')
  
  // Identity (Required for uniqueness)
  displayName: string; // REQUIRED: "Quest Diagnostics – Downtown Lab"
  legalName?: string; // Optional: "Quest Diagnostics Incorporated"
  
  // Location (at least one required)
  address?: string; // Full address string OR
  latitude?: number; // Geographic coordinates (if no address)
  longitude?: number; // Geographic coordinates (if no address)
  
  // Contact & Metadata
  phoneNumber?: string;
  operatingHours?: string; // Free-form or structured JSON
  timezone?: string; // IANA timezone format (e.g., "America/New_York")
  
  // Verification (Manager-Level)
  verificationStatus: 'pending' | 'verified' | 'suspended';
  verifiedAt?: Date;
  verifiedByAdminId?: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

