import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnythingLLMAuthDelegationService } from './service';
import { JwtSignerAdapter } from './infrastructure/jwt/jwt-signer.adapter';
import { ConfigKeystoreAdapter } from './infrastructure/keystore/config-keystore.adapter';
import { JwtSignerPort } from './infrastructure/jwt/jwt-signer.port';
import { KeystorePort } from './infrastructure/keystore/keystore.port';

@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    AnythingLLMAuthDelegationService,
    {
      provide: 'JwtSignerPort',
      useClass: JwtSignerAdapter,
    },
    {
      provide: 'KeystorePort',
      useClass: ConfigKeystoreAdapter,
    },
  ],
  exports: [AnythingLLMAuthDelegationService],
})
export class AnythingLLMAuthDelegationModule {}

