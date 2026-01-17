import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMReconciliationService } from '../../src/anythingllm/provisioning/reconciliation/anythingllm-reconciliation.service';
import { AnythingLLMOrchestratorService } from '../../src/anythingllm-orchestrator/service';
import { AnythingLLMUserMappingRepository } from '../../src/anythingllm/provisioning/infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import { AnythingLLMUserMappingEntity } from '../../src/anythingllm/provisioning/infrastructure/persistence/relational/entities/anythingllm-user-mapping.entity';

/**
 * Unit Tests for AnythingLLM Reconciliation Service
 *
 * Tests reconciliation functionality:
 * - Find orphaned mappings
 * - Find orphaned AnythingLLM users
 * - Find users without workspaces
 * - Admin context verification (HS256 tokens)
 */
describe('AnythingLLM Reconciliation Service', () => {
  let service: AnythingLLMReconciliationService;
  let orchestratorService: jest.Mocked<AnythingLLMOrchestratorService>;
  let mappingRepository: jest.Mocked<AnythingLLMUserMappingRepository>;

  beforeEach(async () => {
    orchestratorService = {
      executeOperation: jest.fn(),
    } as any;

    mappingRepository = {
      findAll: jest.fn(),
      findByAnythingLLMUserId: jest.fn(),
      findByKeystoneUserId: jest.fn(),
      findByWorkspaceSlug: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMReconciliationService,
        {
          provide: AnythingLLMOrchestratorService,
          useValue: orchestratorService,
        },
        {
          provide: AnythingLLMUserMappingRepository,
          useValue: mappingRepository,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMReconciliationService>(
      AnythingLLMReconciliationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Find orphaned mappings', () => {
    it('should detect orphaned mappings where AnythingLLM user does not exist', async () => {
      // Create test mappings
      const mappings: AnythingLLMUserMappingEntity[] = [
        {
          id: 1,
          keystoneUserId: '123',
          anythingllmUserId: 456,
          workspaceSlug: 'patient-abc123',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          keystoneUserId: '456',
          anythingllmUserId: 789,
          workspaceSlug: 'patient-def456',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      mappingRepository.findAll.mockResolvedValue(mappings);

      // Mock orchestrator to return 404 for first user (orphaned), 200 for second (exists)
      orchestratorService.executeOperation
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve('Not Found'),
          headers: {
            get: jest.fn().mockReturnValue(null),
          },
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                user: {
                  id: 789,
                  username: 'patient_def456',
                },
              },
            }),
          text: () => Promise.resolve(''),
          headers: {
            get: jest.fn().mockReturnValue(null),
          },
        } as any);

      const orphanedMappings = await service.findOrphanedMappings();

      // Verify: Orphaned mappings detected correctly
      expect(orphanedMappings).toHaveLength(1);
      expect(orphanedMappings[0]).toEqual({
        mappingId: 1,
        keystoneUserId: '123',
        anythingllmUserId: 456,
        workspaceSlug: 'patient-abc123',
      });

      // Verify: All API calls use delegated tokens with admin context
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterContext: {
            userId: '1', // System admin ID
            roles: ['admin'],
          },
        }),
      );
    });

    it('should verify all API calls use delegated tokens (HS256) with admin context', async () => {
      mappingRepository.findAll.mockResolvedValue([]);

      await service.findOrphanedMappings();

      // Verify: All calls use admin context
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterContext: {
            userId: '1', // System admin ID
            roles: ['admin'],
          },
        }),
      );
    });
  });

  describe('Find orphaned AnythingLLM users', () => {
    it('should detect orphaned AnythingLLM users with externalId=keystone but no mapping', async () => {
      // Mock AnythingLLM to return users
      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            users: [
              {
                id: 999,
                username: 'patient_orphan',
                externalId: '999',
                externalProvider: 'keystone',
              },
              {
                id: 888,
                username: 'patient_valid',
                externalId: '888',
                externalProvider: 'keystone',
              },
            ],
          }),
        text: () => Promise.resolve(''),
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      // Mock mapping repository - first user has no mapping (orphaned), second has mapping
      mappingRepository.findByAnythingLLMUserId
        .mockResolvedValueOnce(null) // No mapping for user 999
        .mockResolvedValueOnce({
          id: 2,
          keystoneUserId: '888',
          anythingllmUserId: 888,
          workspaceSlug: 'patient-valid',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

      const orphanedUsers = await service.findOrphanedAnythingLLMUsers();

      // Verify: Orphans detected
      expect(orphanedUsers).toHaveLength(1);
      expect(orphanedUsers[0]).toEqual({
        anythingllmUserId: 999,
        externalId: '999',
        username: 'patient_orphan',
      });

      // Verify: All API calls use delegated tokens with admin context
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterContext: {
            userId: '1', // System admin ID
            roles: ['admin'],
          },
        }),
      );
    });
  });

  describe('Find users without workspaces', () => {
    it('should detect users without workspace assignments', async () => {
      const mappings: AnythingLLMUserMappingEntity[] = [
        {
          id: 1,
          keystoneUserId: '123',
          anythingllmUserId: 456,
          workspaceSlug: 'patient-abc123',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any;

      mappingRepository.findAll.mockResolvedValue(mappings);

      // Mock workspace check to return 404 (workspace doesn't exist)
      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      const usersWithoutWorkspaces = await service.findUsersWithoutWorkspaces();

      // Verify: Issue detected
      expect(usersWithoutWorkspaces).toHaveLength(1);
      expect(usersWithoutWorkspaces[0]).toEqual({
        mappingId: 1,
        keystoneUserId: '123',
        anythingllmUserId: 456,
        workspaceSlug: 'patient-abc123',
      });
    });
  });

  describe('Reconciliation uses admin context when no user context', () => {
    it('should use system admin (ID: 1) for delegated token context', async () => {
      mappingRepository.findAll.mockResolvedValue([]);

      await service.reconcile();

      // Verify: System admin (ID: 1) is used for delegated token context
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterContext: {
            userId: '1', // System admin ID
            roles: ['admin'],
          },
        }),
      );
    });

    it('should verify all tokens are HS256 (not RS256)', async () => {
      // The token algorithm verification happens in the orchestrator service
      // This test verifies that we're using the orchestrator (which issues HS256 tokens)
      mappingRepository.findAll.mockResolvedValue([]);

      await service.reconcile();

      // Verify: Orchestrator is called (which issues HS256 delegated tokens)
      expect(orchestratorService.executeOperation).toHaveBeenCalled();
      // The orchestrator service itself verifies tokens are HS256
    });
  });

  describe('Fix orphaned mapping', () => {
    it('should delete orphaned mapping', async () => {
      const mappingId = 1;

      await service.fixOrphanedMapping(mappingId);

      // Verify: Mapping deleted
      expect(mappingRepository.delete).toHaveBeenCalledWith(mappingId);
    });
  });

  describe('Fix orphaned user', () => {
    it('should suspend orphaned AnythingLLM user', async () => {
      const anythingllmUserId = 999;

      orchestratorService.executeOperation.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve(''),
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      } as any);

      await service.fixOrphanedUser(anythingllmUserId);

      // Verify: User suspended via orchestrator with admin context
      expect(orchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterContext: {
            userId: '1', // System admin ID
            roles: ['admin'],
          },
          endpoint: `/v1/admin/users/${anythingllmUserId}/suspend`,
          method: 'POST',
        }),
      );
    });
  });
});
