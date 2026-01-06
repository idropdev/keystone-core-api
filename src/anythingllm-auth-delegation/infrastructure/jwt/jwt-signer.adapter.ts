import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtSignerPort } from './jwt-signer.port';

/**
 * Adapter implementing JWT signing using jsonwebtoken directly
 * This ensures we have full control over the algorithm (HS256)
 */
@Injectable()
export class JwtSignerAdapter implements JwtSignerPort {
  async sign(
    payload: Record<string, unknown>,
    secret: string,
    expiresInSeconds: number,
  ): Promise<string> {
    // Use jsonwebtoken directly to ensure algorithm is explicitly set
    // If payload already has 'exp', don't use expiresIn (jsonwebtoken doesn't allow both)
    const options: jwt.SignOptions = {
      algorithm: 'HS256', // Explicitly set algorithm to HS256 (HMAC SHA-256)
      header: {
        alg: 'HS256', // Also set in header to ensure it's in the JWT header
        typ: 'JWT', // JWT type
      },
    };
    
    // Only set expiresIn if exp is not already in the payload
    if (!('exp' in payload)) {
      options.expiresIn = expiresInSeconds;
    }
    
    // Use jsonwebtoken.sign directly with explicit algorithm
    return new Promise<string>((resolve, reject) => {
      jwt.sign(payload, secret, options, (err, token) => {
        if (err) {
          reject(err);
        } else if (!token) {
          reject(new Error('Token signing returned undefined'));
        } else {
          resolve(token);
        }
      });
    });
  }
}




