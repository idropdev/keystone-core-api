import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMChatController } from './anythingllm-chat.controller';
import { AnythingLLMChatService } from './anythingllm-chat.service';
import { RoleEnum } from '../../roles/roles.enum';

describe('AnythingLLMChatController', () => {
  let controller: AnythingLLMChatController;
  let chatService: { streamChatWithDocuments: jest.Mock };

  beforeEach(async () => {
    chatService = { streamChatWithDocuments: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnythingLLMChatController],
      providers: [
        {
          provide: AnythingLLMChatService,
          useValue: chatService,
        },
      ],
    }).compile();

    controller = module.get(AnythingLLMChatController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function createMockResponse() {
    const writes: string[] = [];
    return {
      headersSent: false,
      setHeader: jest.fn(),
      write: jest.fn((chunk: string) => {
        writes.push(chunk);
      }),
      end: jest.fn(() => undefined),
      _writes: writes,
    } as any;
  }

  it('denies managers with 403 and does not call chat service', async () => {
    const response = createMockResponse();

    await controller.streamChat(
      {
        user: {
          id: 1,
          role: { id: RoleEnum.manager, name: 'manager' },
          sessionId: 'sess-1',
        },
      } as any,
      { workspaceSlug: 'ws-1', message: 'hello', documentIds: [] },
      response,
    );

    expect(chatService.streamChatWithDocuments).not.toHaveBeenCalled();
    expect(response.write).toHaveBeenCalled();
    expect(response.end).toHaveBeenCalled();
    expect(response._writes.join('')).toContain('"close":true');
  });
});

