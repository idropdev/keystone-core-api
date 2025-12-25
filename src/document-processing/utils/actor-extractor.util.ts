import { Request } from 'express';
import { RoleEnum } from '../../roles/roles.enum';
import { Actor } from '../../access-control/domain/services/access-grant.domain.service';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';

/**
 * Extract actor from request
 * 
 * Actor type is determined by role:
 * - RoleEnum.admin (1) → 'admin'
 * - RoleEnum.manager (3) → 'manager'
 * - RoleEnum.user (2) → 'user'
 * 
 * @param req - Express request with user from JWT
 * @returns Actor object with type and id
 */
export function extractActorFromRequest(req: Request & { user?: JwtPayloadType }): Actor {
  const userId = req.user?.id;
  const roleId = req.user?.role?.id;

  if (!userId || !roleId) {
    throw new Error('User ID or role ID not found in request');
  }

  // Determine actor type from role ID
  let actorType: 'user' | 'manager' | 'admin';
  if (roleId === RoleEnum.admin) {
    actorType = 'admin';
  } else if (roleId === RoleEnum.manager) {
    actorType = 'manager';
  } else {
    actorType = 'user';
  }

  return {
    type: actorType,
    id: Number(userId),
  };
}

