# AnythingLLM Endpoint Onboarding Guide

Quick reference for adding new AnythingLLM endpoints to Keystone.

## 1-Liner Workflow

To add a new upstream endpoint:

1. **Add registry entry** → 2. **Create/update DTOs** → 3. **Add service method** → 4. **Add controller route** → 5. **Add E2E test**

---

## Step 1: Add Registry Entry

Add endpoint definition to `src/anythingllm/registry/anythingllm-endpoints.registry.ts`:

```typescript
[AnythingLLMAdminEndpointIds.NEW_ENDPOINT]: {
  id: AnythingLLMAdminEndpointIds.NEW_ENDPOINT,
  method: 'POST',
  path: '/v1/admin/new-endpoint/:id',
  auth: 'serviceIdentity',
  requestSchema: NewEndpointRequestSchema, // null if no body
  responseSchema: NewEndpointResponseSchema,
  tags: ['admin', 'category'],
  timeoutMs: 10000,
},
```

Add the ID constant:
```typescript
export const AnythingLLMAdminEndpointIds = {
  // ... existing
  NEW_ENDPOINT: 'admin.newEndpoint',
} as const;
```

---

## Step 2: Create/Update DTOs

Add schemas to `src/anythingllm/registry/schemas/`:

```typescript
// admin-new.schema.ts
import { IsString, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NewEndpointRequestSchema {
  @ApiProperty()
  @IsString()
  name: string;
}

export class NewEndpointResponseSchema {
  @ApiProperty()
  @IsNumber()
  id: number;
  
  @ApiProperty()
  success: boolean;
}
```

Export from `src/anythingllm/registry/schemas/index.ts`.

---

## Step 3: Add Service Method

Add to `src/anythingllm/admin/anythingllm-admin.service.ts`:

```typescript
async newEndpoint(
  endpointId: number,
  request: NewEndpointRequestSchema,
): Promise<RegistryCallResult<NewEndpointResponseSchema>> {
  return this.registryClient.call<
    NewEndpointResponseSchema,
    NewEndpointRequestSchema
  >(AnythingLLMAdminEndpointIds.NEW_ENDPOINT, {
    params: { id: endpointId },
    body: request,
  });
}
```

---

## Step 4: Add Controller Route

Add to `src/anythingllm/admin/anythingllm-admin.controller.ts`:

```typescript
@Post('new-endpoint/:id')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Description of new endpoint' })
@ApiParam({ name: 'id', type: Number })
@ApiResponse({ status: 200, type: NewEndpointResponseSchema })
async newEndpoint(
  @Param('id', ParseIntPipe) id: number,
  @Body() body: NewEndpointRequestSchema,
): Promise<NewEndpointResponseSchema> {
  try {
    const result = await this.adminService.newEndpoint(id, body);
    return result.data;
  } catch (error) {
    throw this.handleError(error);
  }
}
```

---

## Step 5: Add E2E Tests

Add to `test/anythingllm/admin-proxy.e2e-spec.ts`:

```typescript
describe('New Endpoint', () => {
  it('should call new endpoint successfully', async () => {
    if (skipTests || !anythingllmBaseUrl) return;

    const response = await request(app.getHttpServer())
      .post('/api/anythingllm/admin/new-endpoint/1')
      .set('Authorization', `Bearer ${await getServiceToken()}`)
      .send({ name: 'test' })
      .expect(200);

    expect(response.body).toHaveProperty('success');
  });

  it('should reject user JWT', async () => {
    if (skipTests || !anythingllmBaseUrl) return;

    await request(app.getHttpServer())
      .post('/api/anythingllm/admin/new-endpoint/1')
      .set('Authorization', `Bearer ${getMockUserJwt()}`)
      .expect((res) => expect([401, 403]).toContain(res.status));
  });
});
```

---

## Verification Checklist

- [ ] Registry entry has correct method, path, and schemas
- [ ] DTOs use class-validator decorators
- [ ] Service method has proper typing
- [ ] Controller has Swagger decorations
- [ ] E2E test covers happy path and auth rejection
- [ ] Run `npm run build` to verify TypeScript compilation
- [ ] Run `npm run test:e2e -- --testPathPattern=admin-proxy` to verify tests

---

## File Reference

| Component | Location |
|-----------|----------|
| Endpoint Registry | `src/anythingllm/registry/anythingllm-endpoints.registry.ts` |
| Schemas | `src/anythingllm/registry/schemas/` |
| Admin Service | `src/anythingllm/admin/anythingllm-admin.service.ts` |
| Admin Controller | `src/anythingllm/admin/anythingllm-admin.controller.ts` |
| E2E Tests | `test/anythingllm/admin-proxy.e2e-spec.ts` |
