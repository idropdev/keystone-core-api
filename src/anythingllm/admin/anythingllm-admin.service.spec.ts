import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMAdminService } from './anythingllm-admin.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';

describe('AnythingLLMAdminService', () => {
  let service: AnythingLLMAdminService;
  let mockRegistryClient: jest.Mocked<AnythingLLMRegistryClient>;

  const mockResult = {
    data: { success: true },
    requestId: 'test-request-id',
    status: 200,
  };

  beforeEach(async () => {
    // Create mock registry client
    mockRegistryClient = {
      call: jest.fn().mockResolvedValue(mockResult),
      getEndpoint: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMAdminService,
        {
          provide: AnythingLLMRegistryClient,
          useValue: mockRegistryClient,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMAdminService>(AnythingLLMAdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isMultiUserMode', () => {
    it('should call registry client with correct endpoint', async () => {
      await service.isMultiUserMode();

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE,
      );
    });
  });

  describe('listUsers', () => {
    it('should call registry client with correct endpoint', async () => {
      await service.listUsers();

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.LIST_USERS,
      );
    });
  });

  describe('createUser', () => {
    it('should call registry client with request body', async () => {
      const request = { username: 'test', password: 'pass', role: 'default' };

      await service.createUser(request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.CREATE_USER,
        { body: request },
      );
    });
  });

  describe('updateUser', () => {
    it('should call registry client with params and body', async () => {
      const userId = 123;
      const request = { role: 'admin' };

      await service.updateUser(userId, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.UPDATE_USER,
        { params: { id: userId }, body: request },
      );
    });
  });

  describe('deleteUser', () => {
    it('should call registry client with user ID param', async () => {
      const userId = 123;

      await service.deleteUser(userId);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.DELETE_USER,
        { params: { id: userId } },
      );
    });
  });

  describe('listInvites', () => {
    it('should call registry client with correct endpoint', async () => {
      await service.listInvites();

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.LIST_INVITES,
      );
    });
  });

  describe('createInvite', () => {
    it('should call registry client with workspace IDs', async () => {
      const request = { workspaceIds: [1, 2, 3] };

      await service.createInvite(request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.CREATE_INVITE,
        { body: request },
      );
    });
  });

  describe('revokeInvite', () => {
    it('should call registry client with invite ID param', async () => {
      const inviteId = 456;

      await service.revokeInvite(inviteId);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.REVOKE_INVITE,
        { params: { id: inviteId } },
      );
    });
  });

  describe('getWorkspaceUsers', () => {
    it('should call registry client with workspace ID param', async () => {
      const workspaceId = 789;

      await service.getWorkspaceUsers(workspaceId);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.GET_WORKSPACE_USERS,
        { params: { workspaceId } },
      );
    });
  });

  describe('manageWorkspaceUsers', () => {
    it('should call registry client with params and body', async () => {
      const slug = 'my-workspace';
      const request = { userIds: [1, 2], reset: false };

      await service.manageWorkspaceUsers(slug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.MANAGE_WORKSPACE_USERS,
        { params: { workspaceSlug: slug }, body: request },
      );
    });
  });

  describe('getWorkspaceChats', () => {
    it('should call registry client with offset', async () => {
      const request = { offset: 10 };

      await service.getWorkspaceChats(request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.WORKSPACE_CHATS,
        { body: request },
      );
    });
  });

  describe('updatePreferences', () => {
    it('should call registry client with preferences', async () => {
      const request = { support_email: 'test@example.com' };

      await service.updatePreferences(request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.UPDATE_PREFERENCES,
        { body: request },
      );
    });
  });
});
