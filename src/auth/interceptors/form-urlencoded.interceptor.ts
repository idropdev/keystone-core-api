import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';

/**
 * Interceptor to handle application/x-www-form-urlencoded requests
 * for RFC 7662 token introspection endpoint
 *
 * RFC 7662 requires the introspection endpoint to accept
 * application/x-www-form-urlencoded content type.
 *
 * This interceptor converts form-urlencoded body to DTO format
 * for compatibility with existing validation and processing.
 */
@Injectable()
export class FormUrlEncodedInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    // Only process if content-type is application/x-www-form-urlencoded
    const contentType = request.headers['content-type'] || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      // If body is already parsed (by body-parser), convert to DTO format
      if (request.body && typeof request.body === 'object') {
        // Convert form-urlencoded fields to DTO structure
        const dto: any = {
          token: request.body.token || request.body.access_token,
          tokenTypeHint: request.body.token_type_hint,
        };

        // Handle includeUser if present (optional, not in RFC 7662)
        if (request.body.includeUser !== undefined) {
          dto.includeUser =
            request.body.includeUser === 'true' ||
            request.body.includeUser === true;
        }

        // Validate required token field
        if (!dto.token) {
          throw new BadRequestException({
            statusCode: 400,
            message: 'token is required',
            error: 'Bad Request',
          });
        }

        // Replace request body with DTO format
        request.body = dto;
      }
    }

    return next.handle();
  }
}
