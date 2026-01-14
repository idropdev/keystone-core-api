import { Module } from '@nestjs/common';
import { DatabaseConfig } from '../../../../database/config/database-config.type';
import databaseConfig from '../../../../database/config/database.config';
import { RelationalAnythingLLMProvisioningPersistenceModule } from './relational/relational-persistence.module';

// Currently only relational database is supported for user mappings
// Document database support can be added later if needed
const infrastructurePersistenceModule = (databaseConfig() as DatabaseConfig)
  .isDocumentDatabase
  ? undefined // Document database not yet supported - provisioning will not work
  : RelationalAnythingLLMProvisioningPersistenceModule;

@Module({
  imports: infrastructurePersistenceModule
    ? [infrastructurePersistenceModule]
    : [],
  exports: infrastructurePersistenceModule
    ? [infrastructurePersistenceModule]
    : [],
})
export class AnythingLLMProvisioningPersistenceModule {}
