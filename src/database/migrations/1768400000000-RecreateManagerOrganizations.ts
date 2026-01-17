import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/**
 * Migration: RecreateManagerOrganizations
 *
 * SYSTEM-100: Organization Structure with Auto-Assignment
 *
 * This migration:
 * 1. Recreates manager_organizations table (was removed in RefactorManagerArchitecture)
 * 2. Adds organization_id FK to managers table
 */
export class RecreateManagerOrganizations1768400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Create manager_organizations table if it doesn't exist
    const tableExists = await queryRunner.hasTable('manager_organizations');

    if (!tableExists) {
      await queryRunner.query(`
        CREATE TABLE manager_organizations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          verification_status VARCHAR(50) DEFAULT 'pending' NOT NULL,
          verified_at TIMESTAMP,
          verified_by INTEGER,
          created_at TIMESTAMP DEFAULT now() NOT NULL,
          updated_at TIMESTAMP DEFAULT now() NOT NULL,
          deleted_at TIMESTAMP,
          CONSTRAINT FK_manager_organizations_verified_by 
            FOREIGN KEY (verified_by) REFERENCES "user"(id) ON DELETE SET NULL
        );
      `);

      // Create index on name
      await queryRunner.createIndex(
        'manager_organizations',
        new TableIndex({
          name: 'IDX_manager_organizations_name',
          columnNames: ['name'],
        }),
      );

      // Create index on verification_status
      await queryRunner.createIndex(
        'manager_organizations',
        new TableIndex({
          name: 'IDX_manager_organizations_verification_status',
          columnNames: ['verification_status'],
        }),
      );
    }

    // Step 2: Add organization_id to managers table if it doesn't exist
    const managersTable = await queryRunner.getTable('managers');
    const hasOrgColumn = managersTable?.columns.find(
      (col) => col.name === 'organization_id',
    );

    if (!hasOrgColumn) {
      await queryRunner.addColumn(
        'managers',
        new TableColumn({
          name: 'organization_id',
          type: 'integer',
          isNullable: true,
        }),
      );

      // Create index on organization_id
      await queryRunner.createIndex(
        'managers',
        new TableIndex({
          name: 'IDX_managers_organization_id',
          columnNames: ['organization_id'],
        }),
      );

      // Create foreign key
      await queryRunner.createForeignKey(
        'managers',
        new TableForeignKey({
          columnNames: ['organization_id'],
          referencedTableName: 'manager_organizations',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove organization_id FK from managers
    const managersTable = await queryRunner.getTable('managers');
    const orgFk = managersTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('organization_id') !== -1,
    );
    if (orgFk) {
      await queryRunner.dropForeignKey('managers', orgFk);
    }

    // Drop index
    await queryRunner.dropIndex('managers', 'IDX_managers_organization_id');

    // Drop column
    await queryRunner.dropColumn('managers', 'organization_id');

    // Drop manager_organizations indexes
    await queryRunner.dropIndex(
      'manager_organizations',
      'IDX_manager_organizations_name',
    );
    await queryRunner.dropIndex(
      'manager_organizations',
      'IDX_manager_organizations_verification_status',
    );

    // Drop table
    await queryRunner.dropTable('manager_organizations', true);
  }
}
