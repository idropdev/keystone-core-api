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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4b3ccba3-55b0-467b-8ddb-33cba3067360',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jwt-signer.adapter.ts:12',message:'JWT sign called',data:{hasExp:'exp' in payload,expValue:payload.exp,expiresInSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    
    // If payload already has 'exp', don't use expiresIn (jsonwebtoken doesn't allow both)
    const options: { secret: string; expiresIn?: string } = {
      secret,
    };
    
    // Only set expiresIn if exp is not already in the payload
    if (!('exp' in payload)) {
      options.expiresIn = `${expiresInSeconds}s`;
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4b3ccba3-55b0-467b-8ddb-33cba3067360',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jwt-signer.adapter.ts:24',message:'JWT sign options',data:{hasExpiresIn:'expiresIn' in options,expiresInValue:options.expiresIn},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    
    return this.jwtService.signAsync(payload, options);
  }
}




