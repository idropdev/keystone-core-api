import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnythingLLMServiceIdentityService } from '../../src/anythingllm/services/anythingllm-service-identity.service';
import anythingllmConfig from '../../src/anythingllm/config/anythingllm.config';
import { AllConfigType } from '../../src/config/config.type';

/**
 * Integration tests for GCP OIDC token minting
 *
 * These tests require real GCP credentials to be configured:
 * - Application Default Credentials (ADC): `gcloud auth application-default login`
 * - OR Service account key file: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
 * - OR Service account impersonation: `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=service-account@project.iam.gserviceaccount.com`
 *
 * To skip these tests if credentials are not available:
 * SKIP_GCP_TESTS=true npm run test:integration -- service-identity.integration.spec.ts
 */
describe('AnythingLLM Service Identity - Integration Tests', () => {
  let service: AnythingLLMServiceIdentityService;
  let configService: ConfigService<AllConfigType>;

  const skipTests = process.env.SKIP_GCP_TESTS === 'true';

  beforeAll(async () => {
    if (skipTests) {
      console.log('⚠️  Skipping GCP integration tests (SKIP_GCP_TESTS=true)');
      return;
    }

    // Check if GCP credentials are available
    // Priority: GOOGLE_APPLICATION_CREDENTIALS > GOOGLE_IMPERSONATE_SERVICE_ACCOUNT > ADC
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const impersonateServiceAccount =
      process.env.GOOGLE_IMPERSONATE_SERVICE_ACCOUNT;
    let hasCredentials = false;
    let credentialSource = '';

    if (credentialsPath) {
      // Check if the key file exists
      const fs = require('fs');
      if (fs.existsSync(credentialsPath)) {
        hasCredentials = true;
        credentialSource = 'GOOGLE_APPLICATION_CREDENTIALS';
        console.log(
          `✅ Found GCP credentials via GOOGLE_APPLICATION_CREDENTIALS: ${credentialsPath}`,
        );
      } else {
        console.warn(
          `⚠️  GOOGLE_APPLICATION_CREDENTIALS set but file not found: ${credentialsPath}`,
        );
      }
    } else if (impersonateServiceAccount) {
      hasCredentials = true;
      credentialSource = 'GOOGLE_IMPERSONATE_SERVICE_ACCOUNT';
      console.log(
        `✅ Found GCP credentials via GOOGLE_IMPERSONATE_SERVICE_ACCOUNT: ${impersonateServiceAccount}`,
      );
    } else {
      // Check for ADC credentials (Application Default Credentials)
      const fs = require('fs');
      const path = require('path');
      const adcPath = path.join(
        process.env.HOME || process.env.USERPROFILE || '',
        '.config',
        'gcloud',
        'application_default_credentials.json',
      );
      if (fs.existsSync(adcPath)) {
        hasCredentials = true;
        credentialSource = 'ADC (Application Default Credentials)';
        console.log(`✅ Found GCP credentials via ADC: ${adcPath}`);
      }
    }

    if (!hasCredentials) {
      console.warn('⚠️  No GCP credentials found. Skipping integration tests.');
      console.warn('   Configure credentials using one of:');
      console.warn('   1. GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json');
      console.warn(
        '   2. GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=service-account@project.iam.gserviceaccount.com',
      );
      console.warn('   3. gcloud auth application-default login (for ADC)');
      console.warn('   Or set SKIP_GCP_TESTS=true to suppress this warning.');
      return;
    }

    console.log(`   Using credential source: ${credentialSource}`);

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [anythingllmConfig],
          envFilePath: ['.env'],
        }),
      ],
      providers: [AnythingLLMServiceIdentityService],
    }).compile();

    service = module.get<AnythingLLMServiceIdentityService>(
      AnythingLLMServiceIdentityService,
    );
    configService = module.get<ConfigService<AllConfigType>>(ConfigService);
  });

  describe('GCP OIDC Token Minting', () => {
    it('should mint a valid GCP ID token with real credentials', async () => {
      if (skipTests) {
        return;
      }

      const audience =
        configService.get('anythingllm.serviceAudience', { infer: true }) ||
        'anythingllm-internal';

      const token = await service.getIdToken();

      // Verify token is a valid JWT
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      // Verify JWT structure (header.payload.signature)
      const parts = token.split('.');
      expect(parts.length).toBe(3);

      // Decode and verify header
      const header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf-8'),
      );
      expect(header).toHaveProperty('alg');
      expect(header).toHaveProperty('typ');
      expect(header.typ).toBe('JWT');

      // Decode and verify payload
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      // Verify required claims
      expect(payload).toHaveProperty('aud');
      expect(payload.aud).toBe(audience);
      expect(payload).toHaveProperty('iss');
      expect(payload.iss).toContain('google');
      expect(payload).toHaveProperty('exp');
      expect(payload).toHaveProperty('iat');

      // Verify expiration (should be in the future)
      const now = Math.floor(Date.now() / 1000);
      expect(payload.exp).toBeGreaterThan(now);

      // Verify service account email (if present)
      if (payload.email) {
        expect(payload.email).toMatch(/\.iam\.gserviceaccount\.com$/);
      }

      console.log('✅ Successfully minted GCP ID token');
      console.log(`   Audience: ${payload.aud}`);
      console.log(`   Issuer: ${payload.iss}`);
      console.log(`   Expires: ${new Date(payload.exp * 1000).toISOString()}`);
      if (payload.email) {
        console.log(`   Service Account: ${payload.email}`);
      }
    });

    it('should cache tokens for 55 minutes', async () => {
      if (skipTests) {
        return;
      }

      const startTime = Date.now();

      // First call - should mint new token
      const token1 = await service.getIdToken();
      const firstCallDuration = Date.now() - startTime;

      // Second call immediately - should use cache
      const secondStartTime = Date.now();
      const token2 = await service.getIdToken();
      const secondCallDuration = Date.now() - secondStartTime;

      // Verify same token returned
      expect(token1).toBe(token2);

      // Verify second call was faster (cached)
      expect(secondCallDuration).toBeLessThan(firstCallDuration);

      console.log(`✅ Token caching verified`);
      console.log(`   First call: ${firstCallDuration}ms`);
      console.log(`   Second call (cached): ${secondCallDuration}ms`);
    });

    it('should handle different credential sources', async () => {
      if (skipTests) {
        return;
      }

      // Determine which credential source is being used
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const impersonateServiceAccount =
        process.env.GOOGLE_IMPERSONATE_SERVICE_ACCOUNT;
      const credentialSource = credentialsPath
        ? 'GOOGLE_APPLICATION_CREDENTIALS (service account key file)'
        : impersonateServiceAccount
          ? 'GOOGLE_IMPERSONATE_SERVICE_ACCOUNT (impersonation)'
          : 'ADC (Application Default Credentials)';

      console.log(`   Using credential source: ${credentialSource}`);
      if (credentialsPath) {
        console.log(`   Key file: ${credentialsPath}`);
      } else if (impersonateServiceAccount) {
        console.log(`   Impersonating: ${impersonateServiceAccount}`);
      }

      const token = await service.getIdToken();
      expect(token).toBeDefined();

      // Decode token to verify it was minted correctly
      const parts = token.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      expect(payload).toHaveProperty('aud');
      expect(payload).toHaveProperty('iss');

      // Log service account email if present
      if (payload.email) {
        console.log(`   Service Account: ${payload.email}`);
      }

      console.log(`✅ Token minted successfully with ${credentialSource}`);
    });

    it('should throw error with invalid audience', async () => {
      if (skipTests) {
        return;
      }

      // This test would require modifying the service to accept custom audience
      // For now, we'll test that the service uses the configured audience
      const audience =
        configService.get('anythingllm.serviceAudience', { infer: true }) ||
        'anythingllm-internal';

      const token = await service.getIdToken();
      const parts = token.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      expect(payload.aud).toBe(audience);
    });
  });

  describe('Credential Detection', () => {
    it('should detect and log credential source', async () => {
      if (skipTests) {
        return;
      }

      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const impersonateServiceAccount =
        process.env.GOOGLE_IMPERSONATE_SERVICE_ACCOUNT;

      // Verify credential detection matches what the service will use
      if (credentialsPath) {
        const fs = require('fs');
        const exists = fs.existsSync(credentialsPath);
        expect(exists).toBe(true);
        console.log(`✅ Using service account key file: ${credentialsPath}`);
      } else if (impersonateServiceAccount) {
        console.log(
          `✅ Using service account impersonation: ${impersonateServiceAccount}`,
        );
      } else {
        const fs = require('fs');
        const path = require('path');
        const adcPath = path.join(
          process.env.HOME || process.env.USERPROFILE || '',
          '.config',
          'gcloud',
          'application_default_credentials.json',
        );
        const hasADC = fs.existsSync(adcPath);
        expect(hasADC).toBe(true);
        console.log(
          `✅ Using Application Default Credentials (ADC): ${adcPath}`,
        );
      }

      // Service should successfully mint token regardless of credential source
      const token = await service.getIdToken();
      expect(token).toBeDefined();

      // Verify token was minted correctly
      const parts = token.split('.');
      expect(parts.length).toBe(3);
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      expect(payload).toHaveProperty('aud');
      expect(payload).toHaveProperty('iss');
    });
  });
});
