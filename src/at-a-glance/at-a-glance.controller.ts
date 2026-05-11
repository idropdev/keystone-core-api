import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AtAGlanceService } from './at-a-glance.service';
import { AtAGlanceSummaryDto } from './dto/at-a-glance-summary.dto';

@ApiTags('At-a-Glance')
@Controller({ path: 'at-a-glance', version: '1' })
export class AtAGlanceController {
  constructor(private readonly atAGlanceService: AtAGlanceService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Aggregated at-a-glance dashboard summary',
    description:
      "Returns counts and top-3 samples per medical category, derived from the requesting user's document-extracted fields.",
  })
  @ApiOkResponse({ type: AtAGlanceSummaryDto })
  @ApiUnauthorizedResponse({ description: 'JWT missing or invalid' })
  async getSummary(@Request() request: any): Promise<AtAGlanceSummaryDto> {
    return this.atAGlanceService.getSummaryForUser(request.user.id);
  }
}
