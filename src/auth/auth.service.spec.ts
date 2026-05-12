import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { TokenIntrospectionCacheService } from './services/token-introspection-cache.service';
import { AnythingLLMUserProvisioningService } from '../anythingllm/provisioning/anythingllm-user-provisioning.service';

describe('AuthService', () => {
  let authService: AuthService;
  let mockUsersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let mockProvisioningService: jest.Mocked<
    Pick<AnythingLLMUserProvisioningService, 'getWorkspaceMappingForUser'>
  >;

  beforeEach(async () => {
    mockUsersService = {
      findById: jest.fn(),
    };

    mockProvisioningService = {
      getWorkspaceMappingForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        { provide: UsersService, useValue: mockUsersService },
        {
          provide: SessionService,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByIdAndUserId: jest.fn(),
            update: jest.fn(),
            deleteById: jest.fn(),
            deleteByUserId: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: { userSignUp: jest.fn(), forgotPassword: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-value'),
            getOrThrow: jest.fn().mockReturnValue('test-value'),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logAuthEvent: jest.fn(),
          },
        },
        {
          provide: TokenIntrospectionCacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: AnythingLLMUserProvisioningService,
          useValue: mockProvisioningService,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('me() — chatWorkspaceSlug augmentation', () => {
    const jwtPayload = {
      id: 42,
      role: { id: 1 } as any,
      sessionId: 'sess-1',
      iat: 0,
      exp: 0,
    };

    it('should include chatWorkspaceSlug from the provisioning mapping', async () => {
      mockUsersService.findById.mockResolvedValue({
        id: 42,
        email: 'u@example.com',
      } as any);
      mockProvisioningService.getWorkspaceMappingForUser.mockResolvedValue({
        keystoneUserId: '42',
        anythingllmUserId: 100,
        workspaceId: 5,
        workspaceSlug: 'user-42-ws',
      });

      const result = await authService.me(jwtPayload);

      expect(result).toMatchObject({
        id: 42,
        email: 'u@example.com',
        chatWorkspaceSlug: 'user-42-ws',
      });
      expect(
        mockProvisioningService.getWorkspaceMappingForUser,
      ).toHaveBeenCalledWith(42);
    });

    it('should set chatWorkspaceSlug to null when the user has no workspace mapping', async () => {
      mockUsersService.findById.mockResolvedValue({
        id: 42,
        email: 'u@example.com',
      } as any);
      mockProvisioningService.getWorkspaceMappingForUser.mockResolvedValue(
        null,
      );

      const result = await authService.me(jwtPayload);

      expect(result).toMatchObject({
        id: 42,
        chatWorkspaceSlug: null,
      });
    });

    it('should return null when the user is not found and skip the workspace lookup', async () => {
      mockUsersService.findById.mockResolvedValue(null);

      const result = await authService.me(jwtPayload);

      expect(result).toBeNull();
      expect(
        mockProvisioningService.getWorkspaceMappingForUser,
      ).not.toHaveBeenCalled();
    });
  });
});
