import { UserThrottlerGuard } from './user-throttler.guard';

describe('UserThrottlerGuard.getTracker', () => {
  let guard: UserThrottlerGuard;

  beforeEach(() => {
    // Subclass to expose the protected method for testing
    class TestableGuard extends UserThrottlerGuard {
      public testGetTracker(req: Record<string, any>): Promise<string> {
        return this.getTracker(req);
      }
    }
    guard = new TestableGuard(
      // Provide minimal constructor args. ThrottlerGuard requires options,
      // storage, reflector — pass undefined-as-any since we never invoke
      // canActivate, only the tracker method.
      undefined as any,
      undefined as any,
      undefined as any,
    );
  });

  it('should return user:<id> when req.user.id is present', async () => {
    const req = { user: { id: 42 }, ip: '10.0.0.1' };
    const tracker = await (guard as any).testGetTracker(req);
    expect(tracker).toBe('user:42');
  });

  it('should handle string user ids (from JWT sub claim)', async () => {
    const req = { user: { id: '42' }, ip: '10.0.0.1' };
    const tracker = await (guard as any).testGetTracker(req);
    expect(tracker).toBe('user:42');
  });

  it('should fall back to ip:<ip> when req.user is missing', async () => {
    const req = { ip: '10.0.0.1' };
    const tracker = await (guard as any).testGetTracker(req);
    expect(tracker).toBe('ip:10.0.0.1');
  });

  it('should fall back to ip when req.user is present but id is missing', async () => {
    const req = { user: {}, ip: '10.0.0.1' };
    const tracker = await (guard as any).testGetTracker(req);
    expect(tracker).toBe('ip:10.0.0.1');
  });
});
