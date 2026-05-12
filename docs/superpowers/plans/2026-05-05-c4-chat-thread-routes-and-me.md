# C4 — Chat Thread Routes + /auth/me Augmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four backend pieces HealthAtlas chat needs: a list-threads endpoint, a delete-thread endpoint, a thread-history endpoint, and a `chatWorkspaceSlug` field on `/auth/me`. Plus verify the existing stream-chat throttle is per-user.

**Architecture:** Three new routes layered on the existing `anythingllm-workspace.controller`, following the same orchestrator-via-requesterContext pattern as the existing `POST :slug/thread/new`. Service-layer changes: re-enable two stubbed methods (`deleteThread`, `getThreadHistory`) and add one new method (`listThreads`) that reads from keystone's local `anythingllm_user_threads` mirror table — NOT upstream AnythingLLM, which has no list-threads endpoint. `/auth/me` augmentation looks up the workspace slug via the existing `AnythingLLMUserProvisioningService.getWorkspaceMappingForUser`.

**Tech Stack:** NestJS 10+, TypeORM, `@nestjs/throttler`, Jest. No new dependencies. No database migrations.

**Reference spec:** `docs/superpowers/specs/2026-05-05-workstream-c-backend-gaps-design.md` §4.C4.

**Task 1 findings that override plan templates below:**
- `THREAD_HISTORY` already exists in `AnythingLLMOperation` (we use that name). `THREAD_LIST` also already exists. Only `THREAD_DELETE` is missing — Task 2 adds it.
- `AnythingLLMUserThreadRepository` is NOT directly exported. Inject `AnythingLLMUserProvisioningService` instead (already available, already used by the workspace controller at line 71). Either add a new method to that service for the list-by-workspace use case, OR expose the repository in a dedicated module. Prefer adding a method to the provisioning service to avoid module surgery.
- `mapUserToRequesterContext` and `logEndpointCall` are PRIVATE methods on `AnythingLLMWorkspaceController` (lines 39, 77). The C4 routes go into THIS controller (not a new thread-controller), so they can use these private methods directly.
- `/auth/me` returns the `User` entity directly via class-transformer with `groups: ['me']` — no DTO file. Task 5 introduces a wrapper shape.
- Circular-dep risk: `AnythingLLMWorkspaceModule` already imports `AuthModule` with `forwardRef`. Task 5 (auth importing AnythingLLM) needs `forwardRef` on both sides.

**Key code shapes already verified:**
- `AnythingLLMThreadService.deleteThread` (line 111) and `getThreadHistory` (line 129) **exist but throw `'Non-admin thread endpoints have been temporarily disabled'`** with the real bodies commented out. C4 re-enables both.
- `AnythingLLMThreadService.createThread` (line 50) is the working reference — follow its pattern for the orchestrator wiring.
- `AnythingLLMUserThreadRepository` (`src/anythingllm/provisioning/infrastructure/persistence/repositories/anythingllm-user-thread.repository.ts`) exposes `findByKeystoneUserId`, `findByThreadSlug`, `softDelete`. The local `anythingllm_user_threads` table is the source of truth for thread listing.
- `AnythingLLMUserProvisioningService.getWorkspaceMappingForUser(keystoneUserId)` (line 1006) returns `{workspaceSlug, anythingllmUserId, ...} | null`.
- `anythingllm-workspace.controller.ts:311` shows the canonical pattern: extract `requesterContext` via `this.mapUserToRequesterContext(request.user)` and pass to the service.
- Auth service `me(userJwtPayload)` (line 474 of `auth.service.ts`) returns `Promise<NullableType<User>>`. Augmentation extends this.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `test/anythingllm/thread-routes.e2e-spec.ts` | E2e tests for the three new routes |
| `test/auth/me-with-workspace.e2e-spec.ts` | E2e test that `/auth/me` includes `chatWorkspaceSlug` |

### Modified files

| Path | Change |
|---|---|
| `src/anythingllm/thread/anythingllm-thread.service.ts` | Re-enable `deleteThread` and `getThreadHistory` (uncomment real bodies); add new `listThreads` method. Inject `AnythingLLMUserThreadRepository` for `listThreads` + soft-delete on local mirror after upstream `deleteThread` success |
| `src/anythingllm/thread/anythingllm-thread.service.spec.ts` | Update tests for the re-enabled methods + add tests for `listThreads`. The existing "should throw error (temporarily disabled)" tests are removed |
| `src/anythingllm/workspace/anythingllm-workspace.controller.ts` | Add three new routes: `GET :slug/threads`, `DELETE :slug/thread/:threadSlug`, `GET :slug/thread/:threadSlug/chats`. Pattern matches existing `POST :slug/thread/new` |
| `src/auth/auth.service.ts` | `me()` returns user + `chatWorkspaceSlug` looked up via `AnythingLLMUserProvisioningService.getWorkspaceMappingForUser` |
| `src/auth/auth.controller.ts` | Update `/me` response type / Swagger schema to include `chatWorkspaceSlug` |
| `src/auth/dto/auth-me-response.dto.ts` (or wherever the `/me` DTO lives — verify in Task 1) | Add `chatWorkspaceSlug: string \| null` field |
| `src/anythingllm-policy/domain/anythingllm-operation.enum.ts` | Add `THREAD_LIST`, `THREAD_DELETE`, `THREAD_GET_CHATS` operations if not already present (verify in Task 1) |

---

## Task 1: Verify keystone state for C4

Research only. No production code. No commit. Reports findings for subsequent tasks.

- [ ] **Step 1: Confirm thread service current state**

Run: `grep -nE "async (createThread|updateThread|deleteThread|getThreadHistory|sendMessage|streamMessage|listThreads)" src/anythingllm/thread/anythingllm-thread.service.ts`

Expected: lines for `createThread`, `updateThread`, `deleteThread`, `getThreadHistory`, `sendMessage`, `streamMessage`. NO `listThreads` line (we add it).

Then read the bodies of `deleteThread` and `getThreadHistory` to confirm they are currently throwing the "temporarily disabled" error with the real registry call commented out:

Run: `sed -n '105,150p' src/anythingllm/thread/anythingllm-thread.service.ts`

Report exactly what you see. If the bodies are NOT stubbed (e.g. they've already been re-enabled by other work), say so — the plan changes.

- [ ] **Step 2: Confirm `AnythingLLMOperation` enum entries**

Run: `cat src/anythingllm-policy/domain/anythingllm-operation.enum.ts`

Report which `THREAD_*` operations exist. The plan assumes at least `THREAD_CREATE` exists (used by `createThread`). The new routes need: `THREAD_LIST`, `THREAD_DELETE`, `THREAD_GET_CHATS`. If any are missing, Task 5 adds them.

- [ ] **Step 3: Confirm `AnythingLLMUserThreadRepository` shape**

Run: `grep -nE "async \w+|constructor|@InjectRepository" src/anythingllm/provisioning/infrastructure/persistence/repositories/anythingllm-user-thread.repository.ts`

Confirm: `findByKeystoneUserId(keystoneUserId): Promise<UserThreadEntity[]>`, `findByThreadSlug(threadSlug): Promise<UserThreadEntity | null>`, `softDelete(threadSlug): Promise<void>`. Note exact signatures.

Also read the entity to confirm the columns we need to surface in `listThreads`:

Run: `grep -nE "@Column|@PrimaryGenerated" src/anythingllm/provisioning/infrastructure/persistence/relational/entities/anythingllm-user-thread.entity.ts`

Confirm columns: `keystone_user_id`, `workspace_slug`, `thread_slug`, `thread_name`, `message_count`, `last_message_at`, `created_at`.

- [ ] **Step 4: Confirm `/auth/me` shape**

Run: `sed -n '470,490p' src/auth/auth.service.ts && grep -nB2 -A8 "@Get('me')" src/auth/auth.controller.ts`

Report the current `me()` signature and return type. Find the response DTO (if there is one — might just return `User` directly).

- [ ] **Step 5: Confirm `getWorkspaceMappingForUser` signature**

Run: `sed -n '1000,1050p' src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts`

Confirm: it takes `keystoneUserId: string | number`, returns `Promise<{workspaceSlug, anythingllmUserId, ...} | null>`.

- [ ] **Step 6: Confirm existing stream-chat throttle scope**

Run: `grep -nB2 -A4 "stream-chat" src/anythingllm/workspace/anythingllm-workspace.controller.ts`

Report what `@Throttle` decorator is applied (if any), and look at the registered `ThrottlerGuard` in `app.module.ts` to understand whether the default key generator is per-IP or per-user.

Run: `grep -nA3 "ThrottlerModule\.forRoot\|ThrottlerGuard\b" src/app.module.ts src/main.ts 2>/dev/null`

If the default tracker is IP-based, Task 6 swaps it for a per-user tracker on the stream-chat route. If it's already user-based, Task 6 is a no-op (just add an assertion test).

- [ ] **Step 7: Find the canonical orchestrator-pattern route template**

Run: `sed -n '311,420p' src/anythingllm/workspace/anythingllm-workspace.controller.ts`

This is the `POST :slug/thread/new` route. Confirm its structure:
- `@Request() request: ExpressRequestWithUser`
- `@Param('slug') workspaceSlug: string`
- `requestId = randomUUID()`, `response.setHeader('X-Request-Id', requestId)`
- `requesterContext = request.user ? this.mapUserToRequesterContext(request.user) : undefined`
- `upstreamResponse = await this.threadService.createThread(workspaceSlug, body, requesterContext)`
- Error mapping per upstream status
- `this.logEndpointCall(...)`

The three new routes follow this exact shape.

- [ ] **Step 8: Report**

Report findings under these headers:

```
## C4 Task 1 — Keystone State Findings

### Thread service state
- deleteThread stubbed?: <yes/no>
- getThreadHistory stubbed?: <yes/no>
- listThreads exists?: <yes/no>
- Bodies snapshot: <relevant code or paths>

### AnythingLLMOperation enum
- Existing THREAD_* values: <list>
- Need to add: <list>

### Repository methods (signatures)
- findByKeystoneUserId: <signature>
- findByThreadSlug: <signature>
- softDelete: <signature>

### /auth/me current shape
- Signature: <exact>
- Return type: <exact>
- Has DTO file?: <path or "no, returns User entity directly">

### getWorkspaceMappingForUser
- Signature: <exact>

### Stream-chat throttle
- Decorator: <e.g. @Throttle({default: {limit:X, ttl:T}})>
- Key generator: <IP-based default, or custom>
- Task 6 action: <swap to per-user / already per-user / not applicable>

### Orchestrator-pattern route shape
- requesterContext extracted via: <method name>
- Service call shape: <pattern>
- Logging via: <method name>
- Anything that will break the new routes if copied literally: <free text>

### Anything else surprising
- <free text>
```

Cap report at 600 words.

**Do NOT commit.**

---

## Task 2: Re-enable `deleteThread` and `getThreadHistory` in `AnythingLLMThreadService` (TDD)

**Files modified:**
- `src/anythingllm/thread/anythingllm-thread.service.ts`
- `src/anythingllm/thread/anythingllm-thread.service.spec.ts`

This task **undoes the temporary disabling** that's been in place. The bodies of both methods are already written out — they're just commented out. We uncomment them, route through the orchestrator (matching the existing `createThread` pattern), and also call `anythingllm_user_threads.softDelete` after upstream success in `deleteThread` so the local mirror stays consistent.

### Step 1: Update `deleteThread`

Find the method body (around lines 105–125 based on Task 1 findings):

```typescript
async deleteThread(
  _workspaceSlug: string,
  _threadSlug: string,
): Promise<RegistryCallResult<DeleteThreadResponseSchema>> {
  await Promise.resolve();
  throw new Error(
    'Non-admin thread endpoints have been temporarily disabled',
  );
  // return this.registryClient.call<DeleteThreadResponseSchema>(
  //   AnythingLLMAdminEndpointIds.DELETE_THREAD,
  //   { params: { slug: workspaceSlug, threadSlug } },
  // );
}
```

Replace with (mirrors `createThread` orchestrator wiring + soft-deletes the local mirror):

```typescript
async deleteThread(
  workspaceSlug: string,
  threadSlug: string,
  requesterContext?: RequesterContextDto,
): Promise<Response> {
  const path = `/v1/workspace/${encodeURIComponent(workspaceSlug)}/thread/${encodeURIComponent(threadSlug)}`;

  let upstreamResponse: Response;
  if (requesterContext) {
    const resourceContext: ResourceContext = { workspaceSlug, threadSlug };
    upstreamResponse = await this.orchestratorService.executeOperation({
      operation: AnythingLLMOperation.THREAD_DELETE,
      requesterContext,
      resourceContext,
      endpoint: path,
      method: 'DELETE',
    });
  } else {
    upstreamResponse = await this.clientService.callAnythingLLM(path, {
      method: 'DELETE',
    });
  }

  if (upstreamResponse.ok) {
    try {
      await this.userThreadRepository.softDelete(threadSlug);
    } catch (e) {
      this.logger.warn(
        `Upstream delete succeeded but local mirror soft-delete failed for thread ${threadSlug}: ${e}`,
      );
    }
  }

  return upstreamResponse;
}
```

This requires injecting `AnythingLLMUserThreadRepository` into the service. Update the constructor:

```typescript
constructor(
  private readonly registryClient: AnythingLLMRegistryClient,
  private readonly clientService: AnythingLLMClientService,
  private readonly orchestratorService: AnythingLLMOrchestratorService,
  private readonly userThreadRepository: AnythingLLMUserThreadRepository,
) {}
```

And add the import + module registration. The import:

```typescript
import { AnythingLLMUserThreadRepository } from '../provisioning/infrastructure/persistence/repositories/anythingllm-user-thread.repository';
```

If `AnythingLLMUserThreadRepository` is not exported from a module that `AnythingLLMThreadModule` imports, you'll need to add it. Verify in Task 1.

If `AnythingLLMOperation.THREAD_DELETE` does not exist in the enum, add it as part of this commit.

### Step 2: Update `getThreadHistory`

Find the method body (around lines 125–145):

```typescript
async getThreadHistory(
  _workspaceSlug: string,
  _threadSlug: string,
): Promise<RegistryCallResult<ThreadChatsResponseSchema>> {
  await Promise.resolve();
  throw new Error(
    'Non-admin thread endpoints have been temporarily disabled',
  );
  // ...
}
```

Replace with:

```typescript
async getThreadHistory(
  workspaceSlug: string,
  threadSlug: string,
  requesterContext?: RequesterContextDto,
): Promise<Response> {
  const path = `/v1/workspace/${encodeURIComponent(workspaceSlug)}/thread/${encodeURIComponent(threadSlug)}/chats`;

  if (requesterContext) {
    const resourceContext: ResourceContext = { workspaceSlug, threadSlug };
    return this.orchestratorService.executeOperation({
      operation: AnythingLLMOperation.THREAD_HISTORY,
      requesterContext,
      resourceContext,
      endpoint: path,
      method: 'GET',
    });
  }
  return this.clientService.callAnythingLLM(path, { method: 'GET' });
}
```

If `AnythingLLMOperation.THREAD_HISTORY` does not exist, add it.

### Step 3: Update the existing spec file

Open `src/anythingllm/thread/anythingllm-thread.service.spec.ts`. The existing test cases for the disabled methods look like:

```typescript
it('should throw error (temporarily disabled)', async () => {
  await expect(...).rejects.toThrow(
    'Non-admin thread endpoints have been temporarily disabled',
  );
});
```

Replace those test cases with real expectations. Mirror the `createThread` spec's tests. Each method needs:
- A test that calls with no `requesterContext` and asserts `clientService.callAnythingLLM` was invoked with the expected path + method
- A test that calls with a `requesterContext` and asserts `orchestratorService.executeOperation` was invoked with the expected operation, resourceContext, endpoint, method
- For `deleteThread` only: a test asserting `userThreadRepository.softDelete(threadSlug)` is called after upstream success
- For `deleteThread` only: a test asserting local soft-delete failure does NOT bubble up (just logs a warning)

Mock the repository, the client service, and the orchestrator. Test descriptions must start with "should" (lint rule).

### Step 4: Run tests

Run: `npm test -- --testPathPattern=anythingllm-thread.service.spec`

All tests should pass. If a previously-passing test no longer makes sense (e.g. "should throw error (temporarily disabled)"), it should have been replaced — verify it's not still in the file.

### Step 5: Run lint

Run: `npm run lint -- src/anythingllm/thread/`

### Step 6: Commit

```bash
git add -- src/anythingllm/thread/anythingllm-thread.service.ts src/anythingllm/thread/anythingllm-thread.service.spec.ts src/anythingllm-policy/domain/anythingllm-operation.enum.ts
git commit -m "feat(anythingllm): re-enable deleteThread and getThreadHistory with orchestrator"
```

(98 chars — within commitlint 100-char limit.)

If the operation enum file wasn't touched, omit it from `git add`.

---

## Task 3: Add `listThreads` to `AnythingLLMThreadService` (TDD)

**Files modified:**
- `src/anythingllm/thread/anythingllm-thread.service.ts`
- `src/anythingllm/thread/anythingllm-thread.service.spec.ts`

Unlike `deleteThread` and `getThreadHistory`, `listThreads` does NOT proxy upstream — upstream has no list-threads endpoint. The method queries the local `anythingllm_user_threads` table via the repository.

### Step 1: Write failing test

In `anythingllm-thread.service.spec.ts`, add a new `describe('listThreads', () => { ... })` block:

```typescript
describe('listThreads', () => {
  it('should return threads for the user filtered by workspace slug', async () => {
    const fakeRows = [
      {
        threadSlug: 'thread-a',
        threadName: 'Cold symptoms',
        workspaceSlug: 'user-1-ws',
        messageCount: 4,
        lastMessageAt: new Date('2026-05-10T10:00:00Z'),
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
      {
        threadSlug: 'thread-b',
        threadName: 'Lab results',
        workspaceSlug: 'user-1-ws',
        messageCount: 1,
        lastMessageAt: new Date('2026-05-09T10:00:00Z'),
        createdAt: new Date('2026-05-02T10:00:00Z'),
      },
      {
        // Different workspace — should be filtered out
        threadSlug: 'thread-c',
        threadName: 'Other',
        workspaceSlug: 'user-1-other-ws',
        messageCount: 0,
        lastMessageAt: null,
        createdAt: new Date('2026-05-03T10:00:00Z'),
      },
    ];
    mockUserThreadRepository.findByKeystoneUserId.mockResolvedValue(fakeRows);

    const result = await service.listThreads('user-1-ws', '42');

    expect(mockUserThreadRepository.findByKeystoneUserId).toHaveBeenCalledWith('42');
    expect(result).toHaveLength(2);
    expect(result[0].slug).toBe('thread-a');
    expect(result[0].name).toBe('Cold symptoms');
    expect(result[0].workspaceSlug).toBe('user-1-ws');
    expect(result[1].slug).toBe('thread-b');
  });

  it('should return an empty array when the user has no threads', async () => {
    mockUserThreadRepository.findByKeystoneUserId.mockResolvedValue([]);
    const result = await service.listThreads('user-1-ws', '42');
    expect(result).toEqual([]);
  });

  it('should map repository rows to the documented DTO shape', async () => {
    mockUserThreadRepository.findByKeystoneUserId.mockResolvedValue([
      {
        threadSlug: 'thread-a',
        threadName: 'Cold symptoms',
        workspaceSlug: 'user-1-ws',
        messageCount: 4,
        lastMessageAt: new Date('2026-05-10T10:00:00Z'),
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
    ]);
    const [thread] = await service.listThreads('user-1-ws', '42');
    expect(thread).toEqual({
      slug: 'thread-a',
      name: 'Cold symptoms',
      workspaceSlug: 'user-1-ws',
      messageCount: 4,
      lastMessageAt: new Date('2026-05-10T10:00:00Z').toISOString(),
      createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
    });
  });
});
```

You may need to extend the `setUp` for the service tests to include `mockUserThreadRepository` if it's not already there from Task 2. Refer to how `createThread` tests set up mocks.

### Step 2: Run test — confirm it fails

Run: `npm test -- --testPathPattern=anythingllm-thread.service.spec`
Expected: 3 new tests fail (`listThreads is not a function` or similar).

### Step 3: Implement `listThreads`

Add to `anythingllm-thread.service.ts`. Place this method below `createThread` so it groups with thread queries:

```typescript
export interface ThreadListItem {
  slug: string;
  name: string | null;
  workspaceSlug: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

// ... inside the class:

/**
 * List threads for the given keystone user, filtered by workspace slug.
 *
 * Reads from the local `anythingllm_user_threads` mirror table. AnythingLLM's
 * upstream API has no list-threads endpoint, so this is keystone-side only.
 */
async listThreads(
  workspaceSlug: string,
  keystoneUserId: string | number,
): Promise<ThreadListItem[]> {
  const rows = await this.userThreadRepository.findByKeystoneUserId(
    String(keystoneUserId),
  );
  return rows
    .filter((row) => row.workspaceSlug === workspaceSlug)
    .map((row) => ({
      slug: row.threadSlug,
      name: row.threadName ?? null,
      workspaceSlug: row.workspaceSlug,
      messageCount: row.messageCount,
      lastMessageAt: row.lastMessageAt
        ? row.lastMessageAt.toISOString()
        : null,
      createdAt: row.createdAt.toISOString(),
    }));
}
```

Place the `ThreadListItem` interface near the top of the file (after imports) so it's exported.

### Step 4: Run tests

Run: `npm test -- --testPathPattern=anythingllm-thread.service.spec`
Expected: all tests pass, including the 3 new ones.

### Step 5: Run lint

Run: `npm run lint -- src/anythingllm/thread/`

### Step 6: Commit

```bash
git add -- src/anythingllm/thread/anythingllm-thread.service.ts src/anythingllm/thread/anythingllm-thread.service.spec.ts
git commit -m "feat(anythingllm): add listThreads to thread service backed by local mirror"
```

---

## Task 4: Add three new routes to `anythingllm-workspace.controller`

**Files modified:**
- `src/anythingllm/workspace/anythingllm-workspace.controller.ts`

The three new routes follow the existing `POST :slug/thread/new` template. Per Task 1's findings, copy that template's shape:
- `@Request() request: ExpressRequestWithUser`
- `@Param` extraction
- `requestId = randomUUID()` + `X-Request-Id` header
- `requesterContext = request.user ? this.mapUserToRequesterContext(request.user) : undefined`
- Service call with `requesterContext`
- Upstream error mapping + `this.logEndpointCall(...)`

This is one commit covering all three routes.

### Step 1: Add `GET :slug/threads`

Find the existing `@Post(':slug/thread/new')` route. Just before it (or in a sensible location grouping thread routes), add:

```typescript
@Get(':slug/threads')
@HttpCode(HttpStatus.OK)
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60000 } })
@ApiOperation({
  summary: 'List threads in a workspace for the authenticated user',
})
@ApiResponse({ status: 200, description: 'Threads listed successfully' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 403, description: 'Forbidden' })
async listThreads(
  @Request() request: ExpressRequestWithUser,
  @Param('slug') workspaceSlug: string,
): Promise<unknown> {
  if (!request.user) {
    throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
  }
  const userId = request.user.id;
  return this.threadService.listThreads(workspaceSlug, userId);
}
```

You'll need `@Get` imported from `@nestjs/common` if not already.

Note: `listThreads` is local-only (no upstream call), so it does NOT need the orchestrator pattern — but the workspace slug must still belong to the user. The simplest enforcement is to look up the user's `chatWorkspaceSlug` via the provisioning service and reject if it doesn't match. Add this check before calling `threadService.listThreads`:

```typescript
const mapping = await this.userProvisioningService.getWorkspaceMappingForUser(
  userId,
);
if (!mapping || mapping.workspaceSlug !== workspaceSlug) {
  throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
}
```

This requires `AnythingLLMUserProvisioningService` to be available on `this`. It already is (imported at line 27 of the file per Task 1 findings).

### Step 2: Add `DELETE :slug/thread/:threadSlug`

```typescript
@Delete(':slug/thread/:threadSlug')
@HttpCode(HttpStatus.NO_CONTENT)
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@Throttle({ default: { limit: 30, ttl: 60000 } })
@ApiOperation({
  summary: 'Delete a thread (proxies upstream, soft-deletes local mirror)',
})
@ApiResponse({ status: 204, description: 'Thread deleted' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 403, description: 'Forbidden' })
@ApiResponse({ status: 404, description: 'Thread not found' })
async deleteThread(
  @Request() request: ExpressRequestWithUser,
  @Param('slug') workspaceSlug: string,
  @Param('threadSlug') threadSlug: string,
  @Res({ passthrough: true }) response: Response,
): Promise<void> {
  const startTime = Date.now();
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);

  const requesterContext = request.user
    ? this.mapUserToRequesterContext(request.user)
    : undefined;

  const upstreamResponse = await this.threadService.deleteThread(
    workspaceSlug,
    threadSlug,
    requesterContext,
  );
  const durationMs = Date.now() - startTime;
  this.logEndpointCall(
    `/v1/workspace/${workspaceSlug}/thread/${threadSlug}`,
    AnythingLLMOperation.THREAD_DELETE,
    request,
    upstreamResponse.status,
    durationMs,
    requestId,
  );

  if (!upstreamResponse.ok) {
    if (upstreamResponse.status === 401)
      throw new HttpException('Unauthorized', 401);
    if (upstreamResponse.status === 403)
      throw new HttpException('Forbidden', 403);
    if (upstreamResponse.status === 404)
      throw new HttpException('Thread not found', 404);
    throw new HttpException('Delete failed', HttpStatus.BAD_GATEWAY);
  }
}
```

### Step 3: Add `GET :slug/thread/:threadSlug/chats`

```typescript
@Get(':slug/thread/:threadSlug/chats')
@HttpCode(HttpStatus.OK)
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60000 } })
@ApiOperation({ summary: 'Get thread chat history' })
@ApiResponse({ status: 200, description: 'Chat history returned' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 403, description: 'Forbidden' })
@ApiResponse({ status: 404, description: 'Thread not found' })
async getThreadChats(
  @Request() request: ExpressRequestWithUser,
  @Param('slug') workspaceSlug: string,
  @Param('threadSlug') threadSlug: string,
  @Res({ passthrough: true }) response: Response,
): Promise<unknown> {
  const startTime = Date.now();
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);

  const requesterContext = request.user
    ? this.mapUserToRequesterContext(request.user)
    : undefined;

  const upstreamResponse = await this.threadService.getThreadHistory(
    workspaceSlug,
    threadSlug,
    requesterContext,
  );
  const durationMs = Date.now() - startTime;
  this.logEndpointCall(
    `/v1/workspace/${workspaceSlug}/thread/${threadSlug}/chats`,
    AnythingLLMOperation.THREAD_HISTORY,
    request,
    upstreamResponse.status,
    durationMs,
    requestId,
  );

  if (!upstreamResponse.ok) {
    if (upstreamResponse.status === 401)
      throw new HttpException('Unauthorized', 401);
    if (upstreamResponse.status === 403)
      throw new HttpException('Forbidden', 403);
    if (upstreamResponse.status === 404)
      throw new HttpException('Thread not found', 404);
    throw new HttpException(
      'Failed to fetch chat history',
      HttpStatus.BAD_GATEWAY,
    );
  }

  return upstreamResponse.json();
}
```

### Step 4: Lint

Run: `npm run lint -- src/anythingllm/workspace/anythingllm-workspace.controller.ts`

### Step 5: Boot the app to confirm wiring

Run: `timeout 30 npm run start:dev 2>&1 | head -60 || true`

Expected: Nest starts successfully. Look for log lines indicating the three new routes are registered:
- `GET /api/v1/anythingllm/v1/workspace/:slug/threads`
- `DELETE /api/v1/anythingllm/v1/workspace/:slug/thread/:threadSlug`
- `GET /api/v1/anythingllm/v1/workspace/:slug/thread/:threadSlug/chats`

If any of the three routes fails to register, STOP and report BLOCKED with the relevant error.

### Step 6: Commit

```bash
git add -- src/anythingllm/workspace/anythingllm-workspace.controller.ts
git commit -m "feat(anythingllm): add list/delete/chats thread routes to workspace controller"
```

---

## Task 5: Augment `/auth/me` with `chatWorkspaceSlug` (TDD)

**Files modified:**
- `src/auth/auth.service.ts`
- `src/auth/auth.controller.ts` (Swagger schema)
- The `/auth/me` response DTO (verify location in Task 1)
- `src/auth/auth.service.spec.ts` (or wherever existing tests live)

### Step 1: Write failing test for `me()` returning workspace slug

Locate the existing test for `auth.service.me()` (run `grep -rn "auth.service.me\|me(" src/auth/auth.service.spec.ts | head -5` if unsure). Add a new test in the appropriate describe block:

```typescript
it('should include chatWorkspaceSlug in the me response when the user has a workspace mapping', async () => {
  const jwtPayload = { id: 42, role: { id: 1 }, sessionId: 'sess', iat: 0, exp: 0 };
  mockUserService.findById.mockResolvedValue({ id: 42, email: 'u@example.com' });
  mockProvisioningService.getWorkspaceMappingForUser.mockResolvedValue({
    keystoneUserId: '42',
    anythingllmUserId: 100,
    workspaceId: 5,
    workspaceSlug: 'user-42-ws',
  });
  const result = await authService.me(jwtPayload);
  expect(result).toMatchObject({
    id: 42,
    email: 'u@example.com',
    chatWorkspaceSlug: 'user-42-ws',
  });
});

it('should set chatWorkspaceSlug to null when the user has no workspace mapping', async () => {
  const jwtPayload = { id: 42, role: { id: 1 }, sessionId: 'sess', iat: 0, exp: 0 };
  mockUserService.findById.mockResolvedValue({ id: 42, email: 'u@example.com' });
  mockProvisioningService.getWorkspaceMappingForUser.mockResolvedValue(null);
  const result = await authService.me(jwtPayload);
  expect(result).toMatchObject({
    id: 42,
    chatWorkspaceSlug: null,
  });
});
```

You'll need to add `mockProvisioningService` to the test setup. Refer to existing patterns for mocking services in `auth.service.spec.ts`.

If `auth.service.spec.ts` does not exist, this test goes in whatever spec file currently tests `me()` (or create a new one). If neither exists, report BLOCKED — we may need to design the test scaffolding separately.

### Step 2: Run test — confirm it fails

Run: `npm test -- --testPathPattern=auth.service.spec`

Expected: the two new tests fail (chatWorkspaceSlug is not present in the response).

### Step 3: Update `auth.service.me()`

Find the existing method (around line 474 per Task 1 findings). It currently returns `Promise<NullableType<User>>`. Update it to return an object with `chatWorkspaceSlug`.

The exact shape depends on whether there's an existing DTO. Two paths:

**Path A (no DTO file exists, returns User entity directly):**

Define a return type inline or in a new file:

```typescript
export interface AuthMeResponse extends User {
  chatWorkspaceSlug: string | null;
}
```

Change `me()` to:

```typescript
async me(userJwtPayload: JwtPayloadType): Promise<AuthMeResponse | null> {
  const user = await /* existing user lookup */;
  if (!user) return null;
  const mapping =
    await this.anythingllmUserProvisioningService.getWorkspaceMappingForUser(
      userJwtPayload.id,
    );
  return {
    ...user,
    chatWorkspaceSlug: mapping ? mapping.workspaceSlug : null,
  };
}
```

You'll need to inject `AnythingLLMUserProvisioningService` into `AuthService`. Update its constructor accordingly. If a circular-dependency error surfaces (Auth → AnythingLLM → Auth?), use `forwardRef` per existing patterns in the codebase.

**Path B (DTO file already exists):**

Extend the existing DTO and update the service to populate the new field. Match the existing style.

### Step 4: Update the controller / Swagger schema

In `src/auth/auth.controller.ts`, update the `/me` handler's `@ApiOkResponse` (or equivalent decorator) to reflect the new response type:

```typescript
@ApiOkResponse({ type: AuthMeResponse })
```

Or if the existing controller uses `NullableType<User>` for the return type, switch to the new type.

### Step 5: Run tests

Run: `npm test -- --testPathPattern=auth.service.spec`
Expected: all tests pass.

Then run the full suite to catch any regressions:

Run: `npm test`
Expected: all previously-passing tests still pass.

### Step 6: Lint

Run: `npm run lint -- src/auth/`

### Step 7: Commit

```bash
git add -- src/auth/auth.service.ts src/auth/auth.controller.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): augment /me response with chatWorkspaceSlug from provisioning"
```

(If you created a new DTO file, include it in the `git add`.)

---

## Task 6: Verify (and if needed, switch) stream-chat throttle to per-user

**Files modified:**
- Possibly `src/anythingllm/workspace/anythingllm-workspace.controller.ts` (only if throttle needs switching)

### Step 1: Inspect current scope

Per Task 1's findings, identify:
- The `@Throttle` decorator (if any) on the existing `POST :slug/thread/:threadSlug/stream-chat` handler
- The default `ThrottlerGuard` tracker (typically IP-based via `req.ip`)

If the route uses the global default and the default tracker is IP-based, this means N users behind one NAT share a quota. That's the spec's stated concern.

### Step 2: Decide action

- **If current tracker is already per-user:** no code change. Add a smoke test in the existing controller spec asserting two different users from the same IP each get their own quota. Skip to Step 4.
- **If current tracker is IP-based:** override the tracker on the stream-chat handler. The cleanest path is a custom `@SkipThrottle()` + manual rate-limiting in the handler, OR a custom `ThrottlerGuard` subclass with `getTracker(req)` returning `req.user?.id ?? req.ip`. The latter is preferred — wire it via `@UseGuards(UserThrottlerGuard)` on the stream-chat route.

If the route has no `@Throttle` at all, add `@Throttle({default: {limit:60, ttl:60000}})` and use whatever the global tracker is (only if it's already per-user). Otherwise, build the custom tracker.

### Step 3: Implement (if needed)

Concrete implementation depends on Step 1 findings. If a custom guard is needed:

Create `src/anythingllm/workspace/guards/user-throttler.guard.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`);
  }
}
```

Wire it on the stream-chat handler:

```typescript
@UseGuards(AuthGuard('jwt'), UserThrottlerGuard)
```

Register the guard in the workspace module providers.

### Step 4: Test

Add a controller spec test verifying the tracker resolves to `user:<id>` for authenticated requests and `ip:<ip>` for unauthenticated. Or, if implementation didn't change, add a documentation comment on the route explaining the current behavior and commit only the comment.

### Step 5: Commit

```bash
git add -- src/anythingllm/workspace/
git commit -m "fix(anythingllm): use per-user throttle key for stream-chat to prevent NAT sharing"
```

If no implementation change was needed (already per-user), skip the commit OR commit only the test:

```bash
git add -- <test file>
git commit -m "test(anythingllm): assert stream-chat throttle is per-user"
```

---

## Task 7: E2e tests for the three new routes + `/auth/me`

**Files created:**
- `test/anythingllm/thread-routes.e2e-spec.ts`
- `test/auth/me-with-workspace.e2e-spec.ts`

E2e infrastructure is the same as C3 used. Use `createTestUser` from `test/utils/test-helpers.ts` and `APP_URL` from `test/utils/constants.ts`.

Like C3, the e2e suite focuses on **wiring + authorization + isolation**, not exhaustive correctness — service-level unit tests cover those.

### Step 1: Create `test/anythingllm/thread-routes.e2e-spec.ts`

```typescript
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { createTestUser, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

describe('AnythingLLM Thread Routes (E2E)', () => {
  let userA: TestUser;
  let userB: TestUser;
  let userAWorkspaceSlug: string;

  beforeAll(async () => {
    userA = await createTestUser(RoleEnum.user, 'threads-a');
    userB = await createTestUser(RoleEnum.user, 'threads-b');
    // Fetch userA's workspace slug from /me — exercise the augmentation
    const meResp = await request(APP_URL)
      .get('/api/v1/auth/me')
      .auth(userA.token, { type: 'bearer' });
    userAWorkspaceSlug = meResp.body.chatWorkspaceSlug;
  }, 60000);

  describe('GET /:slug/threads', () => {
    it('should return 401 without an Authorization header', async () => {
      await request(APP_URL)
        .get(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/threads`,
        )
        .expect(401);
    });

    it('should return 200 with an empty array for a fresh user with no threads', async () => {
      const res = await request(APP_URL)
        .get(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/threads`,
        )
        .auth(userA.token, { type: 'bearer' })
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([]);
    });

    it('should return 403 when user B tries to list user A workspace threads', async () => {
      await request(APP_URL)
        .get(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/threads`,
        )
        .auth(userB.token, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('DELETE /:slug/thread/:threadSlug', () => {
    it('should return 401 without an Authorization header', async () => {
      await request(APP_URL)
        .delete(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/thread/non-existent`,
        )
        .expect(401);
    });

    it('should return 404 for a non-existent thread (with valid JWT)', async () => {
      await request(APP_URL)
        .delete(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/thread/non-existent-${Date.now()}`,
        )
        .auth(userA.token, { type: 'bearer' })
        .expect(404);
    });
  });

  describe('GET /:slug/thread/:threadSlug/chats', () => {
    it('should return 401 without an Authorization header', async () => {
      await request(APP_URL)
        .get(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/thread/non-existent/chats`,
        )
        .expect(401);
    });

    it('should return 404 for a non-existent thread', async () => {
      await request(APP_URL)
        .get(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/thread/non-existent-${Date.now()}/chats`,
        )
        .auth(userA.token, { type: 'bearer' })
        .expect(404);
    });
  });
});
```

### Step 2: Create `test/auth/me-with-workspace.e2e-spec.ts`

```typescript
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { createTestUser, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

describe('GET /auth/me with chatWorkspaceSlug (E2E)', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(RoleEnum.user, 'me-ws');
  }, 60000);

  it('should include chatWorkspaceSlug in the response', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/auth/me')
      .auth(user.token, { type: 'bearer' })
      .expect(200);
    expect(res.body).toHaveProperty('chatWorkspaceSlug');
    // For a freshly-provisioned user with workspace, slug is a non-empty string
    if (res.body.chatWorkspaceSlug !== null) {
      expect(typeof res.body.chatWorkspaceSlug).toBe('string');
      expect(res.body.chatWorkspaceSlug.length).toBeGreaterThan(0);
    }
  });

  it('should preserve existing /me fields (regression check)', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/auth/me')
      .auth(user.token, { type: 'bearer' })
      .expect(200);
    // The existing User shape (whatever fields it has) must still be present.
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('email');
  });
});
```

### Step 3: Lint

Run: `npm run lint -- test/anythingllm/thread-routes.e2e-spec.ts test/auth/me-with-workspace.e2e-spec.ts`

### Step 4: Run e2e if possible

If keystone is running locally (or if the docker-e2e stack is up):

Run: `npm run test:e2e -- --testPathPattern="(thread-routes|me-with-workspace).e2e-spec"`

If the suite cannot run locally, that's expected — CI will run it on the next push. Report DONE_WITH_CONCERNS.

### Step 5: Commit

```bash
git add -- test/anythingllm/thread-routes.e2e-spec.ts test/auth/me-with-workspace.e2e-spec.ts
git commit -m "test(c4): add e2e tests for thread routes and /me workspace augmentation"
```

---

## Task 8: Final verification

No code changes. Verification only.

- [ ] **Step 1: Run full unit + integration suite**

Run: `npm test`
Expected: all tests pass. Total should be ≥ 148 + new tests from Tasks 2/3/5/6.

- [ ] **Step 2: Lint**

Run: `npm run lint -- src/anythingllm/ src/auth/ test/anythingllm/ test/auth/`
Expected: no errors.

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: no NEW errors (pre-existing baseline preserved).

- [ ] **Step 4: Boot the app and inspect Swagger**

Run: `timeout 30 npm run start:dev 2>&1 | head -80 || true`

Verify in the route registration log:
- `GET /api/v1/anythingllm/v1/workspace/:slug/threads`
- `DELETE /api/v1/anythingllm/v1/workspace/:slug/thread/:threadSlug`
- `GET /api/v1/anythingllm/v1/workspace/:slug/thread/:threadSlug/chats`
- `GET /api/v1/auth/me` — confirm Swagger schema now includes `chatWorkspaceSlug`

- [ ] **Step 5: Verify no Claude / `.claude` attribution**

Run: `git log --since="1 day ago" --pretty=%B | grep -iE "claude|anthropic|co-authored|generated with" || echo "(clean)"`
Expected: `(clean)`.

- [ ] **Step 6: Report C4 ready for PR**

Report:
- Number of commits added
- Total test count delta
- Notable issues or deviations
- Whether C4 is ready to open a PR (per the C-spec's "three sequential PRs" decision)

---

## Self-Review Notes (for the engineer executing this plan)

- **DRY:** The three new routes share a near-identical orchestrator-pattern shape. Resist the urge to extract a helper — three call sites at 30-40 LOC each is below the abstraction threshold for this codebase.
- **YAGNI:** No new tables, no new auth flows, no new policy operations beyond what the orchestrator already needs (`THREAD_LIST` may not even be needed — `listThreads` is keystone-side-only and uses workspace-ownership lookup instead).
- **TDD:** Every service-layer change has the test → fail → implement → pass → commit cycle.
- **Scope creep guards:** Do NOT introduce a new thread-list cache, redesign the AnythingLLM client, or refactor the workspace controller's logging utilities. Stay surgical.
- **Branch:** Stay on `vignesh-changes` in keystone-core-api.
- **Pre-staged file discipline:** Use explicit `git add -- <paths>` for every commit. The `M package-lock.json` working-tree change predates this work and must NOT be staged.
- **Standing rule:** No commit may reference Claude, Anthropic, `.claude/`, or include a Co-Authored-By trailer.
- **Commitlint:** 100-char header limit. All commit messages in this plan are within the limit.
