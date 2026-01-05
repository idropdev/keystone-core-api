import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtSignerPort } from './jwt-signer.port';

/**
 * Adapter implementing JWT signing using NestJS JwtService
 */
@Injectable()
export class JwtSignerAdapter implements JwtSignerPort {
  constructor(private readonly jwtService: JwtService) {}

  async sign(
    payload: Record<string, unknown>,
    secret: string,
    expiresInSeconds: number,
  ): Promise<string> {
    // If payload already has 'exp', don't use expiresIn (jsonwebtoken doesn't allow both)
    const options: { secret: string; expiresIn?: string } = {
      secret,
    };
    
    // Only set expiresIn if exp is not already in the payload
    if (!('exp' in payload)) {
      options.expiresIn = `${expiresInSeconds}s`;
    }
    
    return this.jwtService.signAsync(payload, options);
  }
}




