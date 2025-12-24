import { Module } from '@nestjs/common';
import { RelationalManagerPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

// NOTE: Managers are currently only supported in relational databases
// TODO: Add document database support if needed in the future
@Module({
  imports: [
    RelationalManagerPersistenceModule,
  ],
  controllers: [],
  providers: [],
  exports: [RelationalManagerPersistenceModule],
})
export class ManagersModule {}

