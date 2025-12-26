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
}
