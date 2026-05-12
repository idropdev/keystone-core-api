import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler guard that uses the authenticated user's ID as the tracker key,
 * falling back to the request's IP when no user is present.
 *
 * Use this on routes where multiple users may share a public IP (NAT / proxy)
 * and per-user quotas matter — e.g. AnythingLLM stream-chat. The default
 * ThrottlerGuard uses `req.ip`, which causes all users behind one NAT to
 * share a single quota.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id;
    if (userId !== undefined && userId !== null) {
      return Promise.resolve(`user:${userId}`);
    }
    return Promise.resolve(`ip:${req.ip}`);
  }
}
