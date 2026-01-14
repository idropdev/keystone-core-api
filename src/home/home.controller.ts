import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';

import { HomeService } from './home.service';
import { HealthService } from './health.service';

@ApiTags('Home')
@Controller()
export class HomeController {
  constructor(
    private service: HomeService,
    private healthService: HealthService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get Application Information',
    description:
      'Get basic information about the API, including version, name, and status. This is a public endpoint.',
  })
  @ApiOkResponse({
    description: 'Application information',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Keystone Core API' },
        version: { type: 'string', example: '1.0.0' },
        description: { type: 'string' },
      },
    },
  })
  appInfo() {
    return this.service.appInfo();
  }

  @Get('health/gcp')
  @ApiOperation({
    summary: 'GCP Storage Health Check',
    description:
      'Check if GCP Cloud Storage is accessible and authenticated. Returns health status of GCP storage adapter.',
  })
  @ApiOkResponse({
    description: 'GCP health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        bucket: { type: 'string', example: 'healthatlas-documents-prod' },
        accessible: { type: 'boolean', example: true },
        error: { type: 'string', nullable: true },
      },
    },
  })
  async gcpHealth() {
    return this.healthService.checkGcpHealth();
  }

  @Get('health/anythingllm')
  @ApiOperation({
    summary: 'AnythingLLM Service Identity Health Check',
    description:
      'Check if Keystone can communicate with AnythingLLM using service identity authentication. Verifies token minting, connectivity, and authentication.',
  })
  @ApiOkResponse({
    description: 'AnythingLLM health status',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['healthy', 'unhealthy', 'degraded'],
          example: 'healthy',
        },
        endpoint: {
          type: 'string',
          example: '/v1/admin/is-multi-user-mode',
        },
        reachable: { type: 'boolean', example: true },
        authenticated: { type: 'boolean', example: true },
        responseTime: { type: 'number', example: 123 },
        error: { type: 'string', nullable: true },
        timestamp: { type: 'string', example: '2025-01-27T10:30:00Z' },
      },
    },
  })
  async anythingllmHealth() {
    return this.healthService.checkAnythingLLMHealth();
  }
}
