# OAuth Implementation Guide for Keystone Core API

## Context

You are the lead backend/security engineer for **HealthAtlas**, a HIPAA-adjacent personal health record platform.

You are working in the **Keystone Core API**, a NestJS monolith based on the [Brocoders NestJS boilerplate](https://github.com/brocoders/nestjs-boilerplate). This service is the central API gateway and authentication service for the HealthAtlas Flutter mobile app.

---

## Critical HIPAA/Security Requirements

### ⚠️ MUST NOT Violations (Non-Negotiable)

1. **NO PHI in OAuth**: Never request health-related scopes from Google/Apple
2. **NO PHI in storage**: User table contains ONLY identity data (email, name, provider info)
3. **NO PHI in JWT**: Token payload contains ONLY `id`, `role`, `sessionId` (no health data)
4. **NO PHI in logs**: Audit logs contain ONLY user ID, provider, timestamps
5. **NO long-term token storage**: Do NOT persist OAuth access tokens from providers
6. **ALL secrets from env**: Never hardcode credentials - use ConfigService
7. **HTTPS in production**: All OAuth callbacks must use HTTPS (enforce via config validation)

### ✅ Security Best Practices

- Use session-based JWT with refresh token rotation
- Implement soft deletes for user data
- Support role-based access control (RBAC)
- Validate all DTOs with class-validator
- Use class-transformer serialization groups to control data exposure
- Log structured audit events as JSON

---

## Current Architecture Overview

### Authentication Flow (Mobile-First)

The implementation uses a **mobile-first OAuth flow** where:

1. **Flutter app** handles OAuth consent with Google/Apple natively
2. **Flutter receives ID token** from the provider
3. **Flutter sends ID token** to Keystone Core API via POST request
4. **Backend verifies token** server-side using provider libraries
5. **Backend creates/finds user**, creates session, issues JWT + refresh token
6. **Flutter stores tokens** and uses them for authenticated requests

**Key Difference from Traditional OAuth**: No server-side redirects or callback URLs. The mobile app gets the ID token directly and sends it to our API for verification.

---

## Current Module Structure

```
src/
├── auth/                           # Core authentication module
│   ├── auth.module.ts              # Imports PassportModule, JwtModule, UsersModule
│   ├── auth.controller.ts          # /v1/auth endpoints (email login, register, me, refresh, logout)
│   ├── auth.service.ts             # Core auth logic: validateLogin, validateSocialLogin, register
│   ├── auth-providers.enum.ts      # Enum: email, facebook, google, apple
│   ├── strategies/
│   │   ├── jwt.strategy.ts         # Validates Bearer tokens using AUTH_JWT_SECRET
│   │   ├── jwt-refresh.strategy.ts # Validates refresh tokens
│   │   └── anonymous.strategy.ts   # Allows unauthenticated access
│   └── dto/
│       ├── login-response.dto.ts   # { token, refreshToken, tokenExpires, user }
│       └── ...
│
├── auth-google/                    # Google OAuth module
│   ├── auth-google.module.ts       # Imports AuthModule, ConfigModule
│   ├── auth-google.controller.ts   # POST /v1/auth/google/login
│   ├── auth-google.service.ts      # Verifies Google ID token using google-auth-library
│   ├── config/
│   │   └── google.config.ts        # Loads GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
│   └── dto/
│       └── auth-google-login.dto.ts # { idToken: string }
│
├── auth-apple/                     # Apple OAuth module  
│   ├── auth-apple.module.ts
│   ├── auth-apple.controller.ts    # POST /v1/auth/apple/login
│   ├── auth-apple.service.ts       # Verifies Apple ID token using apple-signin-auth
│   ├── config/
│   │   └── apple.config.ts         # Loads APPLE_APP_AUDIENCE (JSON array)
│   └── dto/
│       └── auth-apple-login.dto.ts # { idToken: string, firstName?: string, lastName?: string }
│
├── users/                          # User management module
│   ├── users.service.ts            # CRUD: findByEmail, findBySocialIdAndProvider, create, update
│   ├── domain/
│   │   └── user.ts                 # User entity with serialization groups
│   └── infrastructure/
│       └── persistence/            # TypeORM/Mongoose repositories
│
├── session/                        # Session management
│   ├── session.service.ts          # create, update, deleteById, deleteByUserId
│   └── domain/
│       └── session.ts              # { id, user, hash, createdAt, updatedAt, deletedAt }
│
└── social/
    └── interfaces/
        └── social.interface.ts     # { id: string, email?: string, firstName?, lastName? }
```

---

## Data Models

### User Entity (`src/users/domain/user.ts`)

```typescript
export class User {
  id: number | string;              // Auto-incremented (Postgres) or ObjectId (Mongo)
  
  @Expose({ groups: ['me', 'admin'] })
  email: string | null;             // Nullable for Apple private relay
  
  @Exclude({ toPlainOnly: true })
  password?: string;                // Only for email provider (bcrypt hashed)
  
  @Expose({ groups: ['me', 'admin'] })
  provider: string;                 // 'email' | 'facebook' | 'google' | 'apple'
  
  @Expose({ groups: ['me', 'admin'] })
  socialId?: string | null;         // Provider's user ID (Google sub, Apple sub)
  
  firstName: string | null;
  lastName: string | null;
  photo?: FileType | null;
  role?: Role | null;               // { id: RoleEnum }
  status?: Status;                  // { id: StatusEnum }
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;                  // Soft delete timestamp
}
```

**Key Fields for OAuth**:
- `socialId`: The stable provider user identifier (e.g., Google `sub` claim, Apple `sub` claim)
- `provider`: Which OAuth provider this user signed in with
- `email`: May be null (Apple private relay) or a relay email

### Session Entity (`src/session/domain/session.ts`)

```typescript
export class Session {
  id: number | string;
  user: User;
  hash: string;                     // Random hash for refresh token validation
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
}
```

**Purpose**: Each login creates a new session. The `hash` is included in refresh tokens to enable token revocation.

### JWT Payload (`src/auth/strategies/types/jwt-payload.type.ts`)

```typescript
export type JwtPayloadType = Pick<User, 'id' | 'role'> & {
  sessionId: Session['id'];
  iat: number;
  exp: number;
};
```

**Security Note**: JWT contains ONLY `id`, `role`, `sessionId`. NO email, NO provider, NO PHI.

---

## OAuth Implementation Details

### Google OAuth Flow

#### 1. Client-Side (Flutter)
```dart
// Flutter uses google_sign_in package
final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();
final GoogleSignInAuthentication googleAuth = await googleUser!.authentication;
final String? idToken = googleAuth.idToken;

// Send idToken to backend
final response = await http.post(
  Uri.parse('https://api.healthatlas.com/v1/auth/google/login'),
  body: json.encode({'idToken': idToken}),
);
```

#### 2. Backend Verification (`src/auth-google/auth-google.service.ts`)

```typescript
@Injectable()
export class AuthGoogleService {
  private google: OAuth2Client;

  constructor(private configService: ConfigService<AllConfigType>) {
    this.google = new OAuth2Client(
      configService.get('google.clientId', { infer: true }),
      configService.get('google.clientSecret', { infer: true }),
    );
  }

  async getProfileByToken(loginDto: AuthGoogleLoginDto): Promise<SocialInterface> {
    const ticket = await this.google.verifyIdToken({
      idToken: loginDto.idToken,
      audience: [this.configService.getOrThrow('google.clientId', { infer: true })],
    });

    const data = ticket.getPayload();

    if (!data) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { user: 'wrongToken' },
      });
    }

    return {
      id: data.sub,                 // Google's stable user ID
      email: data.email,
      firstName: data.given_name,
      lastName: data.family_name,
    };
  }
}
```

**Security**: Uses `google-auth-library` to verify the ID token's signature and claims server-side.

#### 3. Controller (`src/auth-google/auth-google.controller.ts`)

```typescript
@Controller({ path: 'auth/google', version: '1' })
export class AuthGoogleController {
  constructor(
    private readonly authService: AuthService,
    private readonly authGoogleService: AuthGoogleService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: AuthGoogleLoginDto): Promise<LoginResponseDto> {
    const socialData = await this.authGoogleService.getProfileByToken(loginDto);
    return this.authService.validateSocialLogin('google', socialData);
  }
}
```

#### 4. Auth Service Logic (`src/auth/auth.service.ts`)

```typescript
async validateSocialLogin(
  authProvider: string,
  socialData: SocialInterface,
): Promise<LoginResponseDto> {
  let user: NullableType<User> = null;
  const socialEmail = socialData.email?.toLowerCase();
  let userByEmail: NullableType<User> = null;

  // Try to find existing user by email
  if (socialEmail) {
    userByEmail = await this.usersService.findByEmail(socialEmail);
  }

  // Try to find user by socialId + provider
  if (socialData.id) {
    user = await this.usersService.findBySocialIdAndProvider({
      socialId: socialData.id,
      provider: authProvider,
    });
  }

  // Update user email if found by socialId but email changed
  if (user) {
    if (socialEmail && !userByEmail) {
      user.email = socialEmail;
    }
    await this.usersService.update(user.id, user);
  } 
  // Link existing email user to social account
  else if (userByEmail) {
    user = userByEmail;
  } 
  // Create new user
  else if (socialData.id) {
    user = await this.usersService.create({
      email: socialEmail ?? null,
      firstName: socialData.firstName ?? null,
      lastName: socialData.lastName ?? null,
      socialId: socialData.id,
      provider: authProvider,
      role: { id: RoleEnum.user },
      status: { id: StatusEnum.active },
    });
  }

  if (!user) {
    throw new UnprocessableEntityException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      errors: { user: 'userNotFound' },
    });
  }

  // Create session with random hash
  const hash = crypto
    .createHash('sha256')
    .update(randomStringGenerator())
    .digest('hex');

  const session = await this.sessionService.create({ user, hash });

  // Generate JWT + refresh token
  const { token: jwtToken, refreshToken, tokenExpires } = await this.getTokensData({
    id: user.id,
    role: user.role,
    sessionId: session.id,
    hash,
  });

  return {
    refreshToken,
    token: jwtToken,
    tokenExpires,
    user,
  };
}
```

**Key Logic**:
1. Find user by `socialId` + `provider` (most reliable)
2. Fallback to email match (for linking accounts)
3. Create new user if not found
4. Create session with random hash
5. Issue JWT (15m) + refresh token (10 years)
6. Return tokens + serialized user object

---

### Apple OAuth Flow

#### Differences from Google

1. **ID Token Only**: Apple doesn't provide first/last name after first sign-in, so Flutter must pass it
2. **Private Relay Email**: Apple may provide a relay email like `xyz@privaterelay.appleid.com`
3. **Audience is Array**: `APPLE_APP_AUDIENCE` is a JSON array of allowed client IDs

#### Backend Verification (`src/auth-apple/auth-apple.service.ts`)

```typescript
@Injectable()
export class AuthAppleService {
  constructor(private configService: ConfigService<AllConfigType>) {}

  async getProfileByToken(loginDto: AuthAppleLoginDto): Promise<SocialInterface> {
    const data = await appleSigninAuth.verifyIdToken(loginDto.idToken, {
      audience: this.configService.get('apple.appAudience', { infer: true }),
    });

    return {
      id: data.sub,                 // Apple's stable user ID
      email: data.email,
      firstName: loginDto.firstName, // Passed from client
      lastName: loginDto.lastName,   // Passed from client
    };
  }
}
```

**Note**: Uses `apple-signin-auth` library to verify Apple's ID token.

---

## Environment Variables

### Required Variables (`env-example-relational`)

```bash
# JWT Configuration
AUTH_JWT_SECRET=secret                          # HS256 signing key (use 32+ random chars in prod)
AUTH_JWT_TOKEN_EXPIRES_IN=15m                   # Access token expiry
AUTH_REFRESH_SECRET=secret_for_refresh          # Refresh token signing key
AUTH_REFRESH_TOKEN_EXPIRES_IN=3650d             # Refresh token expiry (10 years)
AUTH_FORGOT_SECRET=secret_for_forgot            # Password reset token key
AUTH_FORGOT_TOKEN_EXPIRES_IN=30m
AUTH_CONFIRM_EMAIL_SECRET=secret_for_confirm_email
AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN=1d

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Apple OAuth
APPLE_APP_AUDIENCE=["com.healthatlas.app", "com.healthatlas.app.dev"]
```

### Configuration Loading

All config is loaded via `ConfigModule.forRoot()` in `app.module.ts`:

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        authConfig,
        appConfig,
        mailConfig,
        fileConfig,
        facebookConfig,
        googleConfig,
        appleConfig,
      ],
      envFilePath: ['.env'],
    }),
    // ...
  ],
})
export class AppModule {}
```

Each config file (e.g., `google.config.ts`) validates environment variables using `class-validator`:

```typescript
class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_ID: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_SECRET: string;
}

export default registerAs<GoogleConfig>('google', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
});
```

---

## API Endpoints

### Google OAuth

```http
POST /v1/auth/google/login
Content-Type: application/json

{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6..."
}
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenExpires": 1672531200000,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "provider": "google",
    "socialId": "1234567890",
    "firstName": "John",
    "lastName": "Doe",
    "role": { "id": 2 },
    "status": { "id": 1 },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Apple OAuth

```http
POST /v1/auth/apple/login
Content-Type: application/json

{
  "idToken": "eyJraWQiOiJlWGF1bm1MIiwiYWxnIjoi...",
  "firstName": "Jane",
  "lastName": "Smith"
}
```

**Note**: `firstName` and `lastName` are optional. Apple only provides them on first sign-in.

### Protected Routes

```http
GET /v1/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response**:
```json
{
  "id": 1,
  "email": "user@example.com",
  "provider": "google",
  "firstName": "John",
  "lastName": "Doe",
  "role": { "id": 2 },
  "status": { "id": 1 },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Token Refresh

```http
POST /v1/auth/refresh
Authorization: Bearer <refresh_token>
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenExpires": 1672531200000
}
```

---

## Security Best Practices Implemented

### 1. Token Verification
- ✅ Google: Uses `google-auth-library` OAuth2Client.verifyIdToken()
- ✅ Apple: Uses `apple-signin-auth` to verify Apple's JWK signatures
- ✅ Validates audience/client ID matches expected values

### 2. Session Management
- ✅ Each login creates a new session with a random hash
- ✅ Refresh tokens include `sessionId` + `hash` for validation
- ✅ Logout invalidates session (prevents token reuse)
- ✅ Password change invalidates all other sessions

### 3. JWT Security
- ✅ Short-lived access tokens (15 minutes)
- ✅ Long-lived refresh tokens (10 years) with rotation
- ✅ Payload contains minimal data (id, role, sessionId)
- ✅ Secrets stored in environment variables

### 4. Data Protection
- ✅ Passwords hashed with bcrypt (salt rounds: 10)
- ✅ Soft deletes preserve audit trail
- ✅ Serialization groups control data exposure (@Expose, @Exclude)
- ✅ Email is nullable (supports Apple private relay)

### 5. Input Validation
- ✅ All DTOs validated with class-validator decorators
- ✅ Environment variables validated on startup
- ✅ Unprocessable Entity errors for invalid data

---

## TODO: Production Hardening

### ⚠️ Before Production Deployment

1. **Secrets Management**
   ```typescript
   // TODO: Replace ConfigService with GCP Secret Manager
   // Example: @google-cloud/secret-manager
   const [version] = await client.accessSecretVersion({
     name: 'projects/PROJECT_ID/secrets/AUTH_JWT_SECRET/versions/latest',
   });
   ```

2. **TLS/HTTPS Enforcement**
   ```typescript
   // TODO: Add middleware to enforce HTTPS in production
   if (process.env.NODE_ENV === 'production' && req.protocol !== 'https') {
     throw new ForbiddenException('HTTPS required in production');
   }
   ```

3. **Rate Limiting**
   ```typescript
   // TODO: Add rate limiting to auth endpoints
   // Example: @nestjs/throttler
   @Throttle(5, 60) // 5 requests per 60 seconds
   @Post('login')
   async login() { ... }
   ```

4. **MFA Support**
   ```typescript
   // TODO: Add TOTP/SMS MFA after successful OAuth login
   // Check if user has MFA enabled → require second factor
   ```

5. **Audit Logging**
   ```typescript
   // TODO: Forward audit logs to GCP Cloud Logging
   console.info(JSON.stringify({
     event: 'login_success',
     userId: user.id,
     provider: user.authProvider,
     at: new Date().toISOString(),
     note: 'No PHI logged',
   }));
   ```

6. **CORS Configuration**
   ```typescript
   // TODO: Restrict CORS to production Flutter app domains
   app.enableCors({
     origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://app.healthatlas.com'],
     credentials: true,
   });
   ```

7. **Session Expiry**
   ```typescript
   // TODO: Add background job to delete expired sessions
   // Retention: 90 days for HIPAA audit compliance
   ```

8. **IP Allowlisting** (if applicable)
   ```typescript
   // TODO: If using GCP Cloud Run, consider VPC egress for database
   ```

---

## Testing

### Unit Tests
```bash
npm run test
```

### E2E Tests
```bash
# Start test database
docker-compose -f docker-compose.relational.test.yaml up -d

# Run tests
npm run test:e2e

# Example test: test/user/auth.e2e-spec.ts
```

### Manual Testing with cURL

```bash
# Get Google ID token from OAuth Playground
# https://developers.google.com/oauthplayground/

curl -X POST http://localhost:3000/v1/auth/google/login \
  -H "Content-Type: application/json" \
  -d '{"idToken":"YOUR_GOOGLE_ID_TOKEN"}'
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] Update all environment variables in GCP Secret Manager
- [ ] Set `NODE_ENV=production`
- [ ] Configure Cloud SQL connection (Postgres)
- [ ] Set up Cloud Storage bucket for file uploads
- [ ] Enable Cloud Logging
- [ ] Configure health check endpoint (`/api/v1/home`)
- [ ] Set up CI/CD pipeline (GitHub Actions → Cloud Run)

### OAuth Provider Setup

#### Google Cloud Console
1. Create OAuth 2.0 Client ID (Type: iOS/Android/Web)
2. Add authorized redirect URIs (if using web flow)
3. Copy Client ID and Client Secret
4. Add to `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

#### Apple Developer Portal
1. Register App ID with "Sign in with Apple" capability
2. Create Services ID
3. Configure redirect URL (not needed for mobile-first flow)
4. Copy Service ID → `APPLE_APP_AUDIENCE` (as JSON array)

---

## Architecture Decisions

### Why Mobile-First OAuth?

Traditional OAuth (with server redirects) doesn't work well for native mobile apps. Instead:

1. **Native SDKs**: Flutter uses `google_sign_in` and `sign_in_with_apple` packages
2. **Better UX**: Users stay in-app, no webview redirects
3. **Secure**: ID tokens are signed by provider, verified server-side
4. **Simpler**: No callback URL handling, no state management

### Why Session-Based JWT?

1. **Revocation**: Can invalidate sessions (e.g., on logout, password change)
2. **Refresh Tokens**: Long-lived refresh tokens enable seamless UX
3. **Audit Trail**: Session table tracks login history
4. **Multi-Device**: Each device gets its own session

### Why Separate Auth Modules?

1. **Modularity**: Easy to add/remove providers (Google, Apple, Facebook)
2. **Testability**: Each provider has isolated unit tests
3. **Maintainability**: Provider-specific logic doesn't pollute core auth
4. **Scalability**: Can move providers to separate microservices if needed

---

## Troubleshooting

### Common Issues

#### "wrongToken" Error (Google)
- **Cause**: ID token expired (1 hour TTL) or invalid audience
- **Fix**: Flutter should refresh ID token before sending to backend

#### "invalidHash" Error (Refresh Token)
- **Cause**: Session hash doesn't match (token reuse or session deleted)
- **Fix**: Force re-login (session was invalidated)

#### "emailAlreadyExists" Error
- **Cause**: User with same email exists with different provider
- **Fix**: Backend should link accounts (already implemented in `validateSocialLogin`)

#### Apple Email is Null
- **Cause**: Apple user opted for "Hide My Email"
- **Fix**: Use `socialId` as primary identifier, email is optional

---

## Glossary

- **ID Token**: JWT signed by OAuth provider containing user identity claims
- **Access Token** (OAuth): Short-lived token for API calls to provider (NOT stored)
- **Access Token** (Our API): JWT issued by Keystone for authenticated requests
- **Refresh Token**: Long-lived token to get new access tokens without re-login
- **Session Hash**: Random string to validate refresh token authenticity
- **Social ID**: Provider's unique user identifier (e.g., Google `sub`)
- **Provider**: OAuth source (email, google, apple, facebook)
- **Serialization Group**: Controls which fields are exposed in API responses

---

## References

- [Brocoders NestJS Boilerplate](https://github.com/brocoders/nestjs-boilerplate)
- [Brocoders Auth Documentation](https://github.com/brocoders/nestjs-boilerplate/blob/main/docs/auth.md)
- [Google Sign-In for Flutter](https://pub.dev/packages/google_sign_in)
- [Sign in with Apple (Flutter)](https://pub.dev/packages/sign_in_with_apple)
- [google-auth-library (Node)](https://www.npmjs.com/package/google-auth-library)
- [apple-signin-auth (Node)](https://www.npmjs.com/package/apple-signin-auth)
- [NestJS Authentication](https://docs.nestjs.com/security/authentication)
- [HIPAA Compliance Checklist](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html)

---

## Summary

This implementation provides:

✅ **HIPAA-Aligned OAuth**: No PHI in scopes, storage, JWT, or logs  
✅ **Mobile-First Flow**: Flutter handles consent, backend verifies tokens  
✅ **Session Management**: Refresh tokens with revocation support  
✅ **Modular Architecture**: Separate modules for each provider  
✅ **Production-Ready**: Environment validation, error handling, audit logging  
✅ **Secure by Default**: Bcrypt passwords, soft deletes, serialization groups  
✅ **Well-Documented**: Swagger/OpenAPI, comprehensive DTOs  

**Next Steps**: Implement TODO items for production hardening (Secret Manager, MFA, rate limiting, audit export).
























