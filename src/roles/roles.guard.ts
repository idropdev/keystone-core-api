import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleEnum } from './roles.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<(number | string)[]>(
      'roles',
      [context.getClass(), context.getHandler()],
    );
    if (!roles.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest();

    // Get role ID from request (supports RoleEnum.admin, RoleEnum.user, RoleEnum.manager)
    const userRoleId = request.user?.role?.id;
    if (!userRoleId) {
      return false;
    }

    // Check if user's role ID matches any allowed role
    return roles.map(String).includes(String(userRoleId));
  }
}
