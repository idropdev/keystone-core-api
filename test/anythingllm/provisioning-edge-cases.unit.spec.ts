import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMUserProvisioningService } from '../../src/anythingllm/provisioning/anythingllm-user-provisioning.service';
import { AnythingLLMAdminService } from '../../src/anythingllm/admin/anythingllm-admin.service';
import { AnythingLLMOrchestratorService } from '../../src/anythingllm-orchestrator/service';
import { AuditService } from '../../src/audit/audit.service';
import { WorkspaceMapperService } from '../../src/anythingllm/provisioning/domain/workspace-mapper.service';
import { AnythingLLMWorkspaceService } from '../../src/anythingllm/workspace/anythingllm-workspace.service';
import { ConfigService } from '@nestjs/config';
import { AnythingLLMUserMappingRepository } from '../../src/anythingllm/provisioning/infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import { User } from '../../src/users/domain/user';
import { RoleEnum } from '../../src/roles/roles.enum';
import { StatusEnum } from '../../src/statuses/statuses.enum';

/**
 * Unit Tests for Edge Cases in User Provisioning
 *
 * Tests scenarios with malformed responses and missing data:
 * - Malformed AnythingLLM responses (missing properties, invalid JSON, unexpected status codes)
 * - Missing AnythingLLM ID in mapping for suspension
 *
 * These tests verify graceful error handling and clear error messages.
 */
describe('AnythingLLM User Provisioning - Edge Cases', () => {
  let service: AnythingLLMUserProvisioningService;
  let adminService: jest.Mocked<AnythingLLMAdminService>;
  let orchestratorService: jest.Mocked<AnythingLLMOrchestratorService>;
  let auditService: jest.Mocked<AuditService>;
  let workspaceMapper: jest.Mocked<WorkspaceMapperService>;
  let workspaceService: jest.Mocked<AnythingLLMWorkspaceService>;
  let mappingRepository: jest.Mocked<AnythingLLMUserMappingRepository>;
  let configService: jest.Mocked<ConfigService>;

  const mockUser: User = {
    id: 123,
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: { id: RoleEnum.user, name: 'user' },
    status: { id: StatusEnum.active, name: 'active' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Create mocks
    adminService = {
      createUser: jest.fn(),
    } as any;

    orchestratorService = {
      executeOperation: jest.fn(),
    } as any;

    auditService = {
      logAuthEvent: jest.fn(),
    } as any;

    workspaceMapper = {
      getWorkspaceSlugForUser: jest.fn().mockReturnValue('patient-abc123'),
    } as any;

    workspaceService = {
      createWorkspace: jest.fn(),
    } as any;

    mappingRepository = {
      create: jest.fn(),
      findByKeystoneUserId: jest.fn().mockResolvedValue(null),
      findByWorkspaceSlug: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue([]),
      findByAnythingLLMUserId: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    } as any;

    configService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMUserProvisioningService,
        {
          provide: AnythingLLMAdminService,
          useValue: adminService,
        },
        {
          provide: AnythingLLMOrchestratorService,
          useValue: orchestratorService,
        },
        {
          provide: AuditService,
          useValue: auditService,
        },
        {
          provide: WorkspaceMapperService,
          useValue: workspaceMapper,
        },
        {
          provide: AnythingLLMWorkspaceService,
          useValue: workspaceService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: AnythingLLMUserMappingRepository,
          useValue: mappingRepository,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMUserProvisioningService>(
      AnythingLLMUserProvisioningService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Malformed AnythingLLM responses', () => {
    it('should handle missing properties in response gracefully', async () => {
      // Mock user creation to return response missing 'user' property
      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            // Missing 'user' property
            success: true,
          },
        }),
        text: async () => '',
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Verify: Graceful error handling, clear error messages, no partial state
      await expect(service.provisionUser(mockUser)).rejects.toThrow(
        'AnythingLLM user creation returned no user',
      );

      // Verify no mapping was stored (partial state avoided)
      expect(mappingRepository.create).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON in response gracefully', async () => {
      // Mock user creation to return invalid JSON
      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token in JSON');
        },
        text: async () => 'Invalid JSON response',
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Verify: Graceful error handling
      await expect(service.provisionUser(mockUser)).rejects.toThrow();

      // Verify no mapping was stored
      expect(mappingRepository.create).not.toHaveBeenCalled();
    });

    it('should handle unexpected status codes gracefully', async () => {
      // Mock user creation to return unexpected status code (418 I'm a teapot)
      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: false,
        status: 418,
        text: async () => "I'm a teapot",
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Verify: Graceful error handling
      await expect(service.provisionUser(mockUser)).rejects.toThrow();

      // Verify no mapping was stored
      expect(mappingRepository.create).not.toHaveBeenCalled();
    });

    it('should handle missing workspace properties gracefully', async () => {
      // Mock user creation to succeed
      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              id: 456,
              username: 'patient_abc123',
              role: 'default',
            },
          },
        }),
        text: async () => '',
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Mock workspace creation to return response missing 'workspace' property
      workspaceService.createWorkspace.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          // Missing 'workspace' property
          success: true,
        }),
        text: async () => '',
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Verify: Graceful error handling
      await expect(service.provisionUser(mockUser)).rejects.toThrow();

      // Verify no mapping was stored
      expect(mappingRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('Missing AnythingLLM ID in mapping for suspension', () => {
    it('should handle suspension when mapping exists but AnythingLLM user is missing', async () => {
      // Mock mapping to exist but AnythingLLM user doesn't exist
      mappingRepository.findByKeystoneUserId.mockResolvedValue({
        id: 1,
        keystoneUserId: '123',
        anythingllmUserId: 999, // Non-existent user ID
        workspaceSlug: 'patient-abc123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // Mock AnythingLLM to return 404 for user lookup
      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'User not found',
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Verify: Error logged, graceful degradation
      await expect(service.suspendUser(999, mockUser)).rejects.toThrow();

      // Verify error was logged
      expect(auditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          event: expect.stringContaining('SUSPENSION'),
        }),
      );
    });

    it('should handle suspension when mapping is missing gracefully', async () => {
      // Mock mapping to not exist
      mappingRepository.findByKeystoneUserId.mockResolvedValue(null);

      // Verify: Error logged, graceful degradation
      // The service should handle missing mapping gracefully
      // In a real scenario, this might skip suspension or log a warning
      await expect(service.suspendUser(999, mockUser)).rejects.toThrow();

      // Verify error was logged
      expect(auditService.logAuthEvent).toHaveBeenCalled();
    });
  });
});
