import { Test } from '@nestjs/testing';
import { AnythingLLMUserProvisioningService } from '../../src/anythingllm/provisioning/anythingllm-user-provisioning.service';
import { AnythingLLMWorkspaceService } from '../../src/anythingllm/workspace/anythingllm-workspace.service';
import { AnythingLLMOrchestratorService } from '../../src/anythingllm-orchestrator/service';
import { AnythingLLMAdminService } from '../../src/anythingllm/admin/anythingllm-admin.service';
import { AuditService } from '../../src/audit/audit.service';
import { WorkspaceMapperService } from '../../src/anythingllm/provisioning/domain/workspace-mapper.service';
import { AnythingLLMUserMappingRepository } from '../../src/anythingllm/provisioning/infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import { ConfigService } from '@nestjs/config';
import { User } from '../../src/users/domain/user';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AuthEventType } from '../../src/audit/audit.service';

/**
 * Unit Tests for Workspace Provisioning Methods
 *
 * Tests the workspace creation, assignment, and verification logic in isolation:
 * - Workspace creation with default configuration
 * - User assignment to workspace
 * - Workspace assignment verification
 * - Error handling for workspace operations
 */
describe('Workspace Provisioning Unit Tests', () => {
  let provisioningService: AnythingLLMUserProvisioningService;
  let mockWorkspaceService: jest.Mocked<AnythingLLMWorkspaceService>;
  let mockOrchestratorService: jest.Mocked<AnythingLLMOrchestratorService>;
  let mockAdminService: jest.Mocked<AnythingLLMAdminService>;
  let mockAuditService: jest.Mocked<AuditService>;
  let mockWorkspaceMapper: jest.Mocked<WorkspaceMapperService>;
  let mockMappingRepository: jest.Mocked<AnythingLLMUserMappingRepository>;

  beforeEach(async () => {
    // Create mocks
    mockWorkspaceService = {
      createWorkspace: jest.fn(),
    } as any;

    mockOrchestratorService = {
      executeOperation: jest.fn(),
    } as any;

    mockAdminService = {} as any;

    mockAuditService = {
      logAuthEvent: jest.fn(),
    } as any;

    mockWorkspaceMapper = {
      getWorkspaceSlugForUser: jest.fn(),
      generateWorkspaceSlug: jest.fn(),
    } as any;

    mockMappingRepository = {
      create: jest.fn(),
      findByKeystoneUserId: jest.fn(),
    } as any;

    // Create test module
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnythingLLMUserProvisioningService,
        {
          provide: AnythingLLMWorkspaceService,
          useValue: mockWorkspaceService,
        },
        {
          provide: AnythingLLMOrchestratorService,
          useValue: mockOrchestratorService,
        },
        {
          provide: AnythingLLMAdminService,
          useValue: mockAdminService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: WorkspaceMapperService,
          useValue: mockWorkspaceMapper,
        },
        {
          provide: AnythingLLMUserMappingRepository,
          useValue: mockMappingRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    provisioningService = moduleRef.get<AnythingLLMUserProvisioningService>(
      AnythingLLMUserProvisioningService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createWorkspaceForUser', () => {
    const keystoneUserId = '123';
    const workspaceSlug = 'patient-abc123';
    const workspaceId = 42;

    it('should create workspace with default configuration', async () => {
      // Mock workspace creation response
      mockWorkspaceService.createWorkspace.mockResolvedValue({
        ok: true,
        json: async () => ({
          workspace: {
            id: workspaceId,
            name: `Workspace for user ${keystoneUserId}`,
            slug: workspaceSlug,
          },
          message: 'Workspace created',
        }),
      } as any);

      const result = await (provisioningService as any).createWorkspaceForUser(
        workspaceSlug,
        keystoneUserId,
      );

      expect(result).toBe(workspaceId);
      expect(mockWorkspaceService.createWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          name: `Workspace for user ${keystoneUserId}`,
          slug: workspaceSlug,
          chatMode: 'chat',
          topN: 8,
          similarityThreshold: 0.68,
          openAiTemp: 0.2,
          openAiHistory: 12,
          openAiPrompt: expect.stringContaining('citation-first assistant'),
          queryRefusalResponse: expect.stringContaining(
            "don't have enough grounded context",
          ),
        }),
        expect.objectContaining({
          userId: expect.any(String),
          roles: ['admin'],
        }),
      );

      // Verify audit logging
      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: keystoneUserId,
          provider: 'anythingllm',
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_CREATION_STARTED,
          success: true,
        }),
      );

      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: keystoneUserId,
          provider: 'anythingllm',
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_CREATION_SUCCEEDED,
          success: true,
          metadata: expect.objectContaining({
            workspaceId,
            workspaceSlug,
          }),
        }),
      );
    });

    it('should handle workspace creation failure', async () => {
      mockWorkspaceService.createWorkspace.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as any);

      await expect(
        (provisioningService as any).createWorkspaceForUser(
          workspaceSlug,
          keystoneUserId,
        ),
      ).rejects.toThrow();

      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_CREATION_FAILED,
          success: false,
        }),
      );
    });

    it('should use provided adminUserId for delegated tokens', async () => {
      const adminUserId = 999;
      mockWorkspaceService.createWorkspace.mockResolvedValue({
        ok: true,
        json: async () => ({
          workspace: {
            id: workspaceId,
            name: `Workspace for user ${keystoneUserId}`,
            slug: workspaceSlug,
          },
          message: 'Workspace created',
        }),
      } as any);

      await (provisioningService as any).createWorkspaceForUser(
        workspaceSlug,
        keystoneUserId,
        adminUserId,
      );

      expect(mockWorkspaceService.createWorkspace).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          userId: String(adminUserId),
          roles: ['admin'],
        }),
      );
    });
  });

  describe('assignUserToWorkspace', () => {
    const anythingllmUserId = 100;
    const workspaceSlug = 'patient-abc123';
    const keystoneUserId = '123';
    const user: User = {
      id: Number(keystoneUserId),
      role: { id: RoleEnum.user },
    } as User;

    it('should assign user to workspace using delegated tokens', async () => {
      mockOrchestratorService.executeOperation.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          users: [
            {
              userId: anythingllmUserId,
              username: 'test-user',
              role: 'default',
            },
          ],
        }),
      } as any);

      await (provisioningService as any).assignUserToWorkspace(
        anythingllmUserId,
        workspaceSlug,
        user,
      );

      expect(mockOrchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: `/v1/admin/workspaces/${workspaceSlug}/manage-users`,
          method: 'POST',
          body: {
            userIds: [anythingllmUserId],
            reset: false,
          },
          requesterContext: expect.objectContaining({
            userId: expect.any(String),
            roles: ['admin'],
          }),
        }),
      );

      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: keystoneUserId,
          provider: 'anythingllm',
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_ASSIGNMENT_SUCCEEDED,
          success: true,
        }),
      );
    });

    it('should handle assignment failure', async () => {
      mockOrchestratorService.executeOperation.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Workspace not found',
      } as any);

      await expect(
        (provisioningService as any).assignUserToWorkspace(
          anythingllmUserId,
          workspaceSlug,
          user,
        ),
      ).rejects.toThrow();

      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_ASSIGNMENT_FAILED,
          success: false,
        }),
      );
    });

    it('should use provided adminUserId for delegated tokens', async () => {
      const adminUserId = 999;
      mockOrchestratorService.executeOperation.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          users: [],
        }),
      } as any);

      await (provisioningService as any).assignUserToWorkspace(
        anythingllmUserId,
        workspaceSlug,
        user,
        adminUserId,
      );

      expect(mockOrchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterContext: expect.objectContaining({
            userId: String(adminUserId),
            roles: ['admin'],
          }),
        }),
      );
    });
  });

  describe('verifyWorkspaceAssignment', () => {
    const workspaceId = 42;
    const anythingllmUserId = 100;

    it('should verify user is assigned to workspace', async () => {
      mockOrchestratorService.executeOperation.mockResolvedValue({
        ok: true,
        json: async () => ({
          users: [
            {
              userId: anythingllmUserId,
              username: 'test-user',
              role: 'default',
            },
            {
              userId: 200,
              username: 'other-user',
              role: 'default',
            },
          ],
        }),
      } as any);

      await (provisioningService as any).verifyWorkspaceAssignment(
        workspaceId,
        anythingllmUserId,
      );

      expect(mockOrchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: `/v1/admin/workspaces/${workspaceId}/users`,
          method: 'GET',
          requesterContext: expect.objectContaining({
            userId: expect.any(String),
            roles: ['admin'],
          }),
        }),
      );

      expect(mockAuditService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_ASSIGNMENT_VERIFIED,
          success: true,
          metadata: expect.objectContaining({
            workspaceId,
            anythingllmUserId,
          }),
        }),
      );
    });

    it('should handle verification failure gracefully', async () => {
      mockOrchestratorService.executeOperation.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      } as any);

      // Should not throw - graceful degradation
      await expect(
        (provisioningService as any).verifyWorkspaceAssignment(
          workspaceId,
          anythingllmUserId,
        ),
      ).resolves.not.toThrow();
    });

    it('should handle user not found in workspace list', async () => {
      mockOrchestratorService.executeOperation.mockResolvedValue({
        ok: true,
        json: async () => ({
          users: [
            {
              userId: 200,
              username: 'other-user',
              role: 'default',
            },
          ],
        }),
      } as any);

      // Should not throw - just logs warning
      await expect(
        (provisioningService as any).verifyWorkspaceAssignment(
          workspaceId,
          anythingllmUserId,
        ),
      ).resolves.not.toThrow();

      // Should not log verification success since user not found
      const verificationCalls = mockAuditService.logAuthEvent.mock.calls.filter(
        (call) =>
          call[0].event ===
          AuthEventType.ANYTHINGLLM_WORKSPACE_ASSIGNMENT_VERIFIED,
      );
      expect(verificationCalls.length).toBe(0);
    });
  });
});

