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
 * Unit Tests for Partial Failures in User Provisioning
 *
 * Tests scenarios where provisioning partially succeeds:
 * - User creation succeeds but workspace creation fails
 * - User + workspace creation succeed but assignment fails
 *
 * These tests verify that partial state is handled correctly and errors are properly logged.
 */
describe('AnythingLLM User Provisioning - Partial Failures', () => {
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
    deletedAt: null as any,
    provider: 'email',
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

  describe('Workspace creation fails after user success', () => {
    it('should create user but fail on workspace creation, no mapping stored, error thrown', async () => {
      // Mock user creation to succeed
      orchestratorService.executeOperation
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                user: {
                  id: 456,
                  username: 'patient_abc123',
                  role: 'default',
                },
              },
            }),
          text: () => Promise.resolve(''),
          headers: {
            get: jest.fn().mockReturnValue(null),
          },
        } as any)
        // Mock workspace creation to fail
        .mockRejectedValueOnce(new Error('Workspace creation failed'));

      // Mock workspace service to throw error
      workspaceService.createWorkspace.mockRejectedValue(
        new Error('Workspace creation failed'),
      );

      // Verify: User created, no workspace, no mapping stored, error thrown
      await expect(service.provisionUser(mockUser)).rejects.toThrow(
        'Workspace creation failed',
      );

      // Verify user creation was attempted
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/v1/admin/users/new',
          method: 'POST',
        }),
      );

      // Verify workspace creation was attempted
      expect(workspaceService.createWorkspace).toHaveBeenCalled();

      // Verify mapping was NOT stored (provisioning failed)
      expect(mappingRepository.create).not.toHaveBeenCalled();

      // Verify audit events were logged
      expect(auditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.any(String),
          provider: 'anythingllm',
        }),
      );
    });
  });

  describe('Workspace assignment fails after workspace creation', () => {
    it('should create user + workspace but fail on assignment, mapping stored (if any), assignment failure logged', async () => {
      // Mock user creation to succeed
      orchestratorService.executeOperation
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                user: {
                  id: 456,
                  username: 'patient_abc123',
                  role: 'default',
                },
              },
            }),
          text: () => Promise.resolve(''),
          headers: {
            get: jest.fn().mockReturnValue(null),
          },
        } as any)
        // Mock workspace creation to succeed
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              workspace: {
                id: 789,
                slug: 'patient-abc123',
                name: 'Workspace for user 123',
              },
            }),
          text: () => Promise.resolve(''),
          headers: {
            get: jest.fn().mockReturnValue(null),
          },
        } as any)
        // Mock workspace assignment to fail
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
          headers: {
            get: jest.fn().mockReturnValue(null),
          },
        } as any);

      // Mock workspace service to succeed
      workspaceService.createWorkspace.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            workspace: {
              id: 789,
              slug: 'patient-abc123',
              name: 'Workspace for user 123',
            },
          }),
        text: () => Promise.resolve(''),
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Verify: User + workspace exist, mapping stored (if any), assignment failure logged
      await expect(service.provisionUser(mockUser)).rejects.toThrow();

      // Verify user creation was attempted
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/v1/admin/users/new',
          method: 'POST',
        }),
      );

      // Verify workspace creation was attempted
      expect(workspaceService.createWorkspace).toHaveBeenCalled();

      // Verify workspace assignment was attempted
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining('/manage-users'),
          method: 'POST',
        }),
      );

      // Verify assignment failure was logged
      expect(auditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.stringContaining('ASSIGNMENT_FAILED'),
          success: false,
        }),
      );
    });
  });
});
