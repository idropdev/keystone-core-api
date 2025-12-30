import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { User } from '../../../users/domain/user';

/**
 * Workspace Mapper Service
 *
 * Generates workspace slugs for users using cryptographic hashing.
 * Each user gets a unique workspace: patient-{hash(keystoneUserId)}
 *
 * HIPAA Compliance: Uses SHA-256 hash to avoid leaking raw user IDs and prevent guessable URLs.
 */
@Injectable()
export class WorkspaceMapperService {
  /**
   * Generate workspace slug for a user
   *
   * @param user - Keystone user
   * @returns Workspace slug (patient-{hash})
   */
  getWorkspaceSlugForUser(user: User): string {
    return this.generateWorkspaceSlug(String(user.id));
  }

  /**
   * Generate workspace slug from Keystone user ID
   *
   * Uses SHA-256 hash to avoid leaking raw user IDs and prevent guessable URLs.
   *
   * @param keystoneUserId - Keystone user ID (string)
   * @returns Workspace slug in format: patient-{sha256_hash}
   */
  generateWorkspaceSlug(keystoneUserId: string): string {
    const hash = createHash('sha256').update(keystoneUserId).digest('hex');
    return `patient-${hash}`;
  }
}
