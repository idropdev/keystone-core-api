import { UpstreamError } from './upstream-error';

describe('UpstreamError', () => {
  describe('constructor', () => {
    it('should create error with all properties', () => {
      const error = new UpstreamError({
        status: 404,
        message: 'Not found',
        requestId: 'req-123',
        upstreamPath: '/v1/admin/users',
        upstreamBody: { username: 'test' },
      });

      expect(error.status).toBe(404);
      expect(error.message).toBe('Not found');
      expect(error.requestId).toBe('req-123');
      expect(error.upstreamPath).toBe('/v1/admin/users');
      expect(error.timestamp).toBeDefined();
    });

    it('should sanitize sensitive fields in body', () => {
      const error = new UpstreamError({
        status: 400,
        message: 'Bad request',
        requestId: 'req-123',
        upstreamPath: '/v1/admin/users/new',
        upstreamBody: {
          username: 'test',
          password: 'secret123',
          token: 'my-token',
        },
      });

      expect(error.upstreamBody).not.toContain('secret123');
      expect(error.upstreamBody).not.toContain('my-token');
      expect(error.upstreamBody).toContain('[REDACTED]');
    });

    it('should truncate long bodies', () => {
      const longBody = { data: 'x'.repeat(500) };
      const error = new UpstreamError({
        status: 400,
        message: 'Bad request',
        requestId: 'req-123',
        upstreamPath: '/test',
        upstreamBody: longBody,
      });

      expect(error.upstreamBody).toBeDefined();
      expect(error.upstreamBody!.length).toBeLessThanOrEqual(200);
    });

    it('should handle null body', () => {
      const error = new UpstreamError({
        status: 500,
        message: 'Error',
        requestId: 'req-123',
        upstreamPath: '/test',
      });

      expect(error.upstreamBody).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('should return plain object', () => {
      const error = new UpstreamError({
        status: 401,
        message: 'Unauthorized',
        requestId: 'req-456',
        upstreamPath: '/v1/admin/test',
      });

      const json = error.toJSON();

      expect(json.error).toBe('UpstreamError');
      expect(json.status).toBe(401);
      expect(json.message).toBe('Unauthorized');
      expect(json.requestId).toBe('req-456');
      expect(json.upstreamPath).toBe('/v1/admin/test');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('fromResponse', () => {
    it('should create error from Response', async () => {
      const mockResponse = {
        status: 403,
        statusText: 'Forbidden',
        text: jest.fn().mockResolvedValue('{"error":"Access denied"}'),
      } as any;

      const error = await UpstreamError.fromResponse(
        mockResponse,
        'req-789',
        '/v1/admin/users',
      );

      expect(error.status).toBe(403);
      expect(error.message).toBe('Access denied');
      expect(error.requestId).toBe('req-789');
    });

    it('should handle non-JSON response', async () => {
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('Server error'),
      } as any;

      const error = await UpstreamError.fromResponse(
        mockResponse,
        'req-789',
        '/v1/admin/users',
      );

      expect(error.status).toBe(500);
      expect(error.message).toContain('500');
    });
  });

  describe('fromNetworkError', () => {
    it('should create 502 error from network error', () => {
      const networkError = new Error('Connection refused');

      const error = UpstreamError.fromNetworkError(
        networkError,
        'req-999',
        '/v1/admin/test',
      );

      expect(error.status).toBe(502);
      expect(error.message).toContain('Network error');
      expect(error.message).toContain('Connection refused');
    });
  });
});
