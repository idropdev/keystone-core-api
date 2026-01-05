import {
  Injectable,
  ExecutionContext,
  CanActivate,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/**
 * Optional JWT Guard
 *
 * Attempts to validate JWT token if present, but allows request to proceed
 * if JWT is missing or invalid. Sets request.user if JWT is valid.
 *
 * Used for endpoints that support both user JWT and service identity authentication.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') implements CanActivate {
  // Override handleRequest to allow requests without JWT
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
  ): TUser {
    // If JWT is missing or invalid, return undefined (allow request to proceed)
    // The controller will check for request.user and use service identity if missing
    if (err || !user) {
      return undefined as TUser;
    }

    // JWT is valid, return user
    return user as TUser;
  }

  // Override canActivate to catch errors and allow request to proceed
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // If no Authorization header, allow request to proceed (service identity will be used)
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return true;
    }

    // Try to activate JWT guard, but don't throw if it fails
    const result = super.canActivate(context);
    
    if (result instanceof Promise) {
      return result.catch(() => {
        // JWT validation failed, but we allow the request to proceed
        // Controller will handle service identity fallback
        return true;
      });
    }

    if (result instanceof Observable) {
      return result.pipe(
        map(() => true),
        catchError(() => {
          // JWT validation failed, but we allow the request to proceed
          return of(true);
        }),
      );
    }

    return result;
  }
}

