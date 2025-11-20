import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';

import { HomeService } from './home.service';

@ApiTags('Home')
@Controller()
export class HomeController {
  constructor(private service: HomeService) {}

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
}
