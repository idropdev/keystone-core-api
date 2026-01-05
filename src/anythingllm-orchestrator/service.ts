import {
  Injectable,
  Logger,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AnythingLLMPolicyService } from '../anythingllm-policy/service';
import { AnythingLLMAuthDelegationService } from '../anythingllm-auth-delegation/service';
import { AnythingLLMClientService } from '../anythingllm/services/anythingllm-client.service';
import { AnythingLLMOperation } from '../anythingllm-policy/domain/anythingllm-operation.enum';
import { ResourceContext } from '../anythingllm-policy/domain/resource-context.entity';
import {
  CallAnythingLLMDto,
  RequesterContextDto,
} from './dto/call-anythingllm.dto';
import {
  AuthorizeOperationDto,
  RequesterContextDto as PolicyRequesterContextDto,
} from '../anythingllm-policy/dto/authorize-operation.dto';

/**
 * Orchestrator service that composes policy check → token issuance → client call
 * Single entry point for all AnythingLLM operations from Keystone
 */
@Injectable()
export class AnythingLLMOrchestratorService {
  private readonly logger = new Logger(AnythingLLMOrchestratorService.name);

  constructor(
    private readonly policyService: AnythingLLMPolicyService,
    private readonly delegationService: AnythingLLMAuthDelegationService,
    private readonly clientService: AnythingLLMClientService,
  ) {}

  /**
   * Execute an AnythingLLM operation with authorization and delegated token
   *
   * Flow:
   * 1. Authorize operation (policy check)
   * 2. Issue delegated token (if authorized)
   * 3. Call AnythingLLM with delegated token
   *
   * @param dto - Operation request
   * @returns HTTP Response from AnythingLLM
   */
  async executeOperation(dto: CallAnythingLLMDto): Promise<Response> {
    // Step 1: Authorize operation
    const authDto: AuthorizeOperationDto = {
      requesterContext: this.mapRequesterContext(dto.requesterContext),
      operation: dto.operation,
      resourceContext: dto.resourceContext,
    };

    const authResult = await this.policyService.authorizeOperation(authDto);

    if (!authResult.allowed) {
      // HIPAA-compliant logging (no PHI)
      this.logger.warn(
        `Operation ${dto.operation} denied for user ${dto.requesterContext.userId}: ${authResult.reason || 'Unauthorized'}`,
      );
      throw new ForbiddenException(
        authResult.reason || 'Operation not allowed',
      );
    }

    // Step 2: Issue delegated token
    let delegatedToken: string;
    try {
      const tokenResult = await this.delegationService.issueDelegatedToken({
        requesterContext: dto.requesterContext,
        operation: dto.operation,
        scope: authResult.scope,
      });
      delegatedToken = tokenResult.token;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to issue delegated token for operation ${dto.operation}: ${errorMessage}`,
      );
      throw new InternalServerErrorException(
        'Failed to issue delegated token',
      );
    }

    // Step 3: Call AnythingLLM with delegated token
    try {
      // Detect if body is FormData (multipart/form-data)
      const isFormData =
        dto.body &&
        (dto.body instanceof FormData ||
          (typeof FormData !== 'undefined' && dto.body instanceof FormData) ||
          // Check for form-data package instance (Node.js)
          (dto.body.constructor &&
            dto.body.constructor.name === 'FormData' &&
            typeof (dto.body as any).getHeaders === 'function'));

      // Build headers - don't set Content-Type for FormData (let it set boundary)
      const headers: Record<string, string> = {
        ...dto.headers,
        Authorization: `Bearer ${delegatedToken}`, // Pass delegated token in Authorization header
      };

      // Only set Content-Type for JSON bodies
      if (!isFormData) {
        headers['Content-Type'] = 'application/json';
      }

      // Prepare body - pass FormData directly, stringify JSON
      let requestBody: string | FormData | undefined;
      if (dto.body) {
        if (isFormData) {
          requestBody = dto.body as FormData;
        } else {
          requestBody = JSON.stringify(dto.body);
        }
      }

      const response = await this.clientService.callAnythingLLM(
        dto.endpoint,
        {
          method: dto.method,
          body: requestBody,
          headers,
        },
      );

      // HIPAA-compliant logging (no PHI, no tokens)
      this.logger.debug(
        `Operation ${dto.operation} completed for user ${dto.requesterContext.userId}, status: ${response.status}`,
      );

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `AnythingLLM call failed for operation ${dto.operation}: ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * Map requester context from orchestrator DTO to policy DTO
   */
  private mapRequesterContext(
    context: RequesterContextDto,
  ): PolicyRequesterContextDto {
    return {
      userId: context.userId,
      roles: context.roles,
      sessionId: context.sessionId,
      provider: context.provider,
    };
  }
}




