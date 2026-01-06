import { Injectable, Logger } from '@nestjs/common';
import { AnythingLLMVectorSearchService } from '../vector-search/anythingllm-vector-search.service';
import {
  VectorSearchRequestSchema,
  OpenAIChatCompletionsRequestSchema,
  OpenAIChatMessageSchema,
} from '../registry/schemas';

/**
 * Thread-Scoped Chat Service (Pattern 1)
 *
 * Implements strict document scoping by:
 * 1. Using vector search with docPaths filter to retrieve only relevant chunks
 * 2. Calling OpenAI-compatible chat completions with system prompt containing selected chunks
 * 3. Storing conversation in Keystone (not in AnythingLLM thread history for strict scoping)
 * 4. Optionally mirroring summary to AnythingLLM thread for audit trail
 *
 * This ensures that when documents are attached to a thread, only those documents
 * are used for retrieval, maintaining strict compliance boundaries.
 */
@Injectable()
export class ThreadScopedChatService {
  private readonly logger = new Logger(ThreadScopedChatService.name);

  constructor(
    private readonly vectorSearchService: AnythingLLMVectorSearchService,
  ) {}

  /**
   * Perform vector search with strict document scoping
   *
   * @param workspaceSlug - Workspace slug
   * @param query - Search query
   * @param docPaths - Array of document paths to restrict search to
   * @param topN - Number of results to return (default: 5)
   * @param scoreThreshold - Minimum score threshold (default: 0.7)
   * @returns Array of search results
   */
  async searchWithScope(
    workspaceSlug: string,
    query: string,
    docPaths: string[],
    topN: number = 5,
    scoreThreshold: number = 0.7,
  ) {
    const request: VectorSearchRequestSchema = {
      query,
      topN,
      scoreThreshold,
      docPaths, // This restricts search to only the specified documents
    };

    const result = await this.vectorSearchService.search(workspaceSlug, request);
    return result.data.results;
  }

  /**
   * Generate chat completion with strict document scoping
   *
   * @param workspaceSlug - Workspace slug
   * @param messages - Chat messages (user query, etc.)
   * @param docPaths - Array of document paths to restrict retrieval to
   * @param model - Model to use (default: 'gpt-3.5-turbo')
   * @param temperature - Temperature for generation (default: 0.7)
   * @returns Chat completion response
   */
  async chatWithScope(
    workspaceSlug: string,
    messages: OpenAIChatMessageSchema[],
    docPaths: string[],
    model: string = 'gpt-3.5-turbo',
    temperature: number = 0.7,
  ) {
    // Step 1: Extract the user's query from messages
    const userMessage = messages.find((msg) => msg.role === 'user');
    if (!userMessage) {
      throw new Error('No user message found in messages array');
    }

    // Step 2: Perform vector search with strict scoping
    const searchResults = await this.searchWithScope(
      workspaceSlug,
      userMessage.content,
      docPaths,
    );

    // Step 3: Build system prompt with retrieved chunks
    const contextChunks = searchResults
      .map((result) => `[${result.source}]: ${result.text}`)
      .join('\n\n');

    const systemPrompt = `You are a helpful assistant. Use the following context from the user's documents to answer their question. Only use information from these documents. If the answer is not in the documents, say so.

Context from documents:
${contextChunks}`;

    // Step 4: Call OpenAI-compatible chat completions with system prompt
    const request: OpenAIChatCompletionsRequestSchema = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature,
      max_tokens: 1000,
      stream: false,
    };

    const result = await this.vectorSearchService.chatCompletions(request);
    return result.data;
  }

  /**
   * Build system prompt from search results
   * Helper method for custom prompt construction
   */
  buildSystemPromptFromResults(
    searchResults: Array<{ text: string; source: string; score: number }>,
    customInstructions?: string,
  ): string {
    const contextChunks = searchResults
      .map((result) => `[${result.source}]: ${result.text}`)
      .join('\n\n');

    const baseInstructions =
      customInstructions ||
      `You are a helpful assistant. Use the following context from the user's documents to answer their question. Only use information from these documents. If the answer is not in the documents, say so.`;

    return `${baseInstructions}

Context from documents:
${contextChunks}`;
  }
}





