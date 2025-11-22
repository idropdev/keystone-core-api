import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { TokenIntrospectResponseDto } from '../dto/token-introspect.dto';

interface CachedIntrospection {
  response: TokenIntrospectResponseDto;
  expiresAt: number;
  tokenHash: string;
}

/**
 * Token Introspection Cache Service
 *
 * Caches token introspection results for a short TTL to improve performance
 * for resource servers (e.g., AnythingLLM) that may introspect the same token
 * multiple times.
 *
 * Security Considerations:
 * - Cache TTL is short (default: 30 seconds) to ensure revocation is reflected quickly
 * - Cache key is a hash of the token (never store raw tokens)
 * - Cache is in-memory (per-instance) - consider Redis for distributed systems
 * - Cache is automatically invalidated on session revocation
 *
 * HIPAA Compliance:
 * - No raw tokens stored in cache
 * - Cache entries expire quickly to ensure revocation is enforced
 * - TODO: In production, use Redis with encryption for distributed caching
 */
@Injectable()
export class TokenIntrospectionCacheService {
  private cache: Map<string, CachedIntrospection> = new Map();
  private readonly cacheTtl: number; // Cache TTL in milliseconds

  constructor(private configService: ConfigService<AllConfigType>) {
    // Default to 30 seconds cache TTL (configurable via env)
    // Short TTL ensures revocation is reflected within 30 seconds
    const ttlSeconds =
      parseInt(process.env.AUTH_INTROSPECTION_CACHE_TTL_SECONDS || '30', 10) *
      1000;
    this.cacheTtl = ttlSeconds;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get cached introspection result
   *
   * @param tokenHash - SHA-256 hash of the token
   * @returns Cached response or null if not found/expired
   */
  get(tokenHash: string): TokenIntrospectResponseDto | null {
    const cached = this.cache.get(tokenHash);

    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(tokenHash);
      return null;
    }

    return cached.response;
  }

  /**
   * Store introspection result in cache
   *
   * @param tokenHash - SHA-256 hash of the token
   * @param response - Introspection response to cache
   */
  set(tokenHash: string, response: TokenIntrospectResponseDto): void {
    // Only cache active tokens (inactive tokens are fast to verify)
    // Also, don't cache if token is revoked (revocation should be immediate)
    if (!response.active || response.revoked) {
      return;
    }

    const expiresAt = Date.now() + this.cacheTtl;

    this.cache.set(tokenHash, {
      response,
      expiresAt,
      tokenHash,
    });
  }

  /**
   * Invalidate cache entry for a specific token
   * Called when a session is revoked or token is invalidated
   *
   * @param tokenHash - SHA-256 hash of the token
   */
  invalidate(tokenHash: string): void {
    this.cache.delete(tokenHash);
  }

  /**
   * Invalidate all cache entries for a user
   * Called when user logs out or all sessions are invalidated
   *
   * @param userId - User ID
   */
  invalidateByUserId(userId: string | number): void {
    for (const [tokenHash, cached] of this.cache.entries()) {
      if (cached.response.sub === String(userId)) {
        this.cache.delete(tokenHash);
      }
    }
  }

  /**
   * Invalidate all cache entries for a session
   * Called when a specific session is revoked
   *
   * @param sessionId - Session ID
   */
  invalidateBySessionId(sessionId: string | number): void {
    for (const [tokenHash, cached] of this.cache.entries()) {
      if (cached.response.sid === String(sessionId)) {
        this.cache.delete(tokenHash);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired cache entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [tokenHash, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(tokenHash);
      }
    }
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getStats(): { size: number; ttl: number } {
    return {
      size: this.cache.size,
      ttl: this.cacheTtl,
    };
  }
}
