import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CloudLoggingClient } from './infrastructure/cloud-logging.client';
import { AuditQueryService } from './audit-query.service';
import { AuditController } from './audit.controller';

@Module({
  providers: [AuditService, CloudLoggingClient, AuditQueryService],
  controllers: [AuditController],
  exports: [AuditService, CloudLoggingClient],
})
export class AuditModule {}
