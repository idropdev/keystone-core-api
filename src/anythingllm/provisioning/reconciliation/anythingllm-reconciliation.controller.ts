import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../../roles/roles.guard';
import { Roles } from '../../../roles/roles.decorator';
import { RoleEnum } from '../../../roles/roles.enum';
import { AnythingLLMReconciliationService } from './anythingllm-reconciliation.service';
import { ReconciliationReport } from './anythingllm-reconciliation.service';

/**
 * Reconciliation Report DTO
 */
export class ReconciliationReportDto implements ReconciliationReport {
  orphanedMappings: Array<{
    mappingId: number;
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
  }>;
  orphanedAnythingLLMUsers: Array<{
    anythingllmUserId: number;
    externalId: string;
    username: string;
  }>;
  usersWithoutWorkspaces: Array<{
    mappingId: number;
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
  }>;
  timestamp: Date;
}

/**
 * AnythingLLM Reconciliation Controller
 *
 * Provides endpoints for reconciliation operations:
 * - GET /status - Get reconciliation report (read-only)
 * - POST /fix-orphaned-mapping/:id - Fix specific orphan (requires confirmation)
 *
 * All operations require admin role and use delegated tokens (HS256).
 */
@ApiTags('AnythingLLM Reconciliation')
@Controller({
  path: 'admin/anythingllm/reconciliation',
  version: '1',
})
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
@Roles(RoleEnum.admin)
export class AnythingLLMReconciliationController {
  constructor(
    private readonly reconciliationService: AnythingLLMReconciliationService,
  ) {}

  /**
   * Get reconciliation report (read-only)
   *
   * Returns a report of all inconsistencies between Keystone and AnythingLLM:
   * - Orphaned mappings
   * - Orphaned AnythingLLM users
   * - Users without workspace assignments
   *
   * @returns Reconciliation report
   */
  @Get('status')
  @ApiOperation({
    summary: 'Get reconciliation report',
    description:
      'Returns a report of all inconsistencies between Keystone and AnythingLLM. Read-only operation.',
  })
  @ApiResponse({
    status: 200,
    description: 'Reconciliation report',
    type: ReconciliationReportDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  async getReconciliationStatus(): Promise<ReconciliationReportDto> {
    const report = await this.reconciliationService.reconcile();
    return report;
  }

  /**
   * Fix orphaned mapping
   * Deletes the orphaned mapping
   *
   * @param id - Mapping ID to delete
   */
  @Post('fix-orphaned-mapping/:id')
  @ApiOperation({
    summary: 'Fix orphaned mapping',
    description:
      'Deletes an orphaned mapping (mapping exists but AnythingLLM user does not). Requires confirmation.',
  })
  @ApiResponse({
    status: 200,
    description: 'Orphaned mapping deleted successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  @ApiResponse({
    status: 404,
    description: 'Mapping not found',
  })
  async fixOrphanedMapping(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean; message: string }> {
    await this.reconciliationService.fixOrphanedMapping(id);
    return {
      success: true,
      message: `Orphaned mapping ${id} deleted successfully`,
    };
  }
}
