import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';

/**
 * Middleware to enforce HTTPS in production environments
 *
 * HIPAA Requirement: All PHI/ePHI transmission must be encrypted in transit
 *
 * This middleware:
 * - Redirects HTTP requests to HTTPS in production
 * - Allows HTTP in development/test for easier local development
 * - Checks for X-Forwarded-Proto header (common in load balancers/proxies)
 *
 * TODO: Ensure load balancer/proxy is configured to set X-Forwarded-Proto header
 * TODO: Consider implementing HSTS (HTTP Strict Transport Security) headers
 */
@Injectable()
export class HttpsEnforcementMiddleware implements NestMiddleware {
  constructor(private configService: ConfigService<AllConfigType>) {}

  use(req: Request, res: Response, next: NextFunction) {
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });

    // Only enforce HTTPS in production
    if (nodeEnv === 'production') {
      // Check if request is already HTTPS
      const isHttps =
        req.secure ||
        req.protocol === 'https' ||
        req.get('x-forwarded-proto') === 'https';

      if (!isHttps) {
        // Return 403 Forbidden instead of redirecting to prevent potential security issues
        // In production, the load balancer should handle HTTP->HTTPS redirect
        return res.status(403).json({
          statusCode: 403,
          message:
            'HTTPS is required for all requests in production. Please use HTTPS.',
          error: 'Forbidden',
        });
      }
    }

    next();
  }
}
