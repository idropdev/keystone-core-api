/**
 * UpstreamError - Normalized error for AnythingLLM API failures
 *
 * Provides a standard error format for upstream API call failures.
 * HIPAA Compliance: Never includes tokens or sensitive authentication data.
 */
export class UpstreamError extends Error {
  /**
   * HTTP status code from upstream response (or 502 for network errors)
   */
  readonly status: number;

  /**
   * Correlation ID for request tracing
   */
  readonly requestId: string;

  /**
   * Original upstream API path that was called
   */
  readonly upstreamPath: string;

  /**
   * Truncated, sanitized request body (no tokens, max 200 chars)
   */
  readonly upstreamBody: string | null;

  /**
   * Timestamp when the error occurred
   */
  readonly timestamp: string;

  constructor(params: {
    status: number;
    message: string;
    requestId: string;
    upstreamPath: string;
    upstreamBody?: unknown;
  }) {
    super(params.message);
    this.name = 'UpstreamError';
    this.status = params.status;
    this.requestId = params.requestId;
    this.upstreamPath = params.upstreamPath;
    this.timestamp = new Date().toISOString();

    // Sanitize and truncate upstream body
    this.upstreamBody = UpstreamError.sanitizeBody(params.upstreamBody);

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, UpstreamError.prototype);
  }

  /**
   * Sanitize request body for logging
   * - Removes sensitive fields (tokens, passwords, etc.)
   * - Truncates to 200 characters
   */
  private static sanitizeBody(body: unknown): string | null {
    if (!body) {
      return null;
    }

    try {
      let sanitized: Record<string, unknown>;

      if (typeof body === 'string') {
        try {
          sanitized = JSON.parse(body);
        } catch {
          // If not JSON, truncate and return
          return body.substring(0, 200);
        }
      } else if (typeof body === 'object') {
        sanitized = { ...body } as Record<string, unknown>;
      } else {
        return String(body).substring(0, 200);
      }

      // Remove sensitive fields
      const sensitiveFields = [
        'password',
        'token',
        'authorization',
        'apiKey',
        'api_key',
        'secret',
        'credential',
        'accessToken',
        'refreshToken',
        'id_token',
        'access_token',
        'refresh_token',
      ];

      for (const field of sensitiveFields) {
        if (field in sanitized) {
          sanitized[field] = '[REDACTED]';
        }
        // Also check lowercase variants
        const lowerField = field.toLowerCase();
        if (lowerField in sanitized) {
          sanitized[lowerField] = '[REDACTED]';
        }
      }

      const json = JSON.stringify(sanitized);
      return json.substring(0, 200);
    } catch {
      return '[Unable to serialize body]';
    }
  }

  /**
   * Convert to a plain object for HTTP response
   */
  toJSON(): Record<string, unknown> {
    return {
      error: 'UpstreamError',
      message: this.message,
      status: this.status,
      requestId: this.requestId,
      upstreamPath: this.upstreamPath,
      timestamp: this.timestamp,
    };
  }

  /**
   * Create UpstreamError from a fetch Response
   */
  static async fromResponse(
    response: Response,
    requestId: string,
    upstreamPath: string,
    requestBody?: unknown,
  ): Promise<UpstreamError> {
    let message: string;
    try {
      const body = await response.text();
      const json = JSON.parse(body);
      message =
        json.error || json.message || `Upstream error: ${response.status}`;
    } catch {
      message = `Upstream error: ${response.status} ${response.statusText}`;
    }

    return new UpstreamError({
      status: response.status,
      message,
      requestId,
      upstreamPath,
      upstreamBody: requestBody,
    });
  }

  /**
   * Create UpstreamError from a network/fetch error
   */
  static fromNetworkError(
    error: Error,
    requestId: string,
    upstreamPath: string,
    requestBody?: unknown,
  ): UpstreamError {
    return new UpstreamError({
      status: 502, // Bad Gateway for network errors
      message: `Network error: ${error.message}`,
      requestId,
      upstreamPath,
      upstreamBody: requestBody,
    });
  }
}
