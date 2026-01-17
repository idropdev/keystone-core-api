import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnythingLLMAuthDelegationService } from './service';
import { JwtSignerAdapter } from './infrastructure/jwt/jwt-signer.adapter';
import { ConfigKeystoreAdapter } from './infrastructure/keystore/config-keystore.adapter';

@Module({
  imports: [ConfigModule],
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
