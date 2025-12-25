import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CloudLoggingClient } from './infrastructure/cloud-logging.client';

@Module({
  providers: [AuditService, CloudLoggingClient],
  exports: [AuditService, CloudLoggingClient],
})
export class AuditModule {}
