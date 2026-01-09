import { Injectable, Logger } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';
import {
  VectorSearchRequestSchema,
  VectorSearchResponseSchema,
  OpenAIChatCompletionsRequestSchema,
  OpenAIChatCompletionsResponseSchema,
  OpenAIEmbeddingsRequestSchema,
  OpenAIEmbeddingsResponseSchema,
} from '../registry/schemas';

/**
 * AnythingLLM Vector Search Service
 *
 * Provides typed methods for vector search and OpenAI-compatible endpoints.
 * Handles semantic search, chat completions, and embeddings.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMVectorSearchService {
  private readonly logger = new Logger(AnythingLLMVectorSearchService.name);

  constructor(private readonly registryClient: AnythingLLMRegistryClient) {}

  /**
   * Perform vector search in a workspace
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async search(
    workspaceSlug: string,
    request: VectorSearchRequestSchema,
  ): Promise<RegistryCallResult<VectorSearchResponseSchema>> {
    throw new Error(
      'Non-admin vector-search endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<
    //   VectorSearchResponseSchema,
    //   VectorSearchRequestSchema
    // >(AnythingLLMAdminEndpointIds.VECTOR_SEARCH, {
    //   params: { slug: workspaceSlug },
    //   body: request,
    // });
  }

  /**
   * Get OpenAI-compatible chat completions
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async chatCompletions(
    request: OpenAIChatCompletionsRequestSchema,
  ): Promise<RegistryCallResult<OpenAIChatCompletionsResponseSchema>> {
    throw new Error(
      'Non-admin vector-search endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<
    //   OpenAIChatCompletionsResponseSchema,
    //   OpenAIChatCompletionsRequestSchema
    // >(AnythingLLMAdminEndpointIds.OPENAI_CHAT_COMPLETIONS, { body: request });
  }

  /**
   * Generate embeddings using OpenAI-compatible endpoint
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async embeddings(
    request: OpenAIEmbeddingsRequestSchema,
  ): Promise<RegistryCallResult<OpenAIEmbeddingsResponseSchema>> {
    throw new Error(
      'Non-admin vector-search endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<
    //   OpenAIEmbeddingsResponseSchema,
    //   OpenAIEmbeddingsRequestSchema
    // >(AnythingLLMAdminEndpointIds.OPENAI_EMBEDDINGS, { body: request });
  }
}
