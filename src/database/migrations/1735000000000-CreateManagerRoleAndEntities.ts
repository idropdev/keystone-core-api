import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class CreateManagerRoleAndEntities1735000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add manager role to roles table
    await queryRunner.query(`
      INSERT INTO role (id, name) 
      VALUES (3, 'Manager') 
      ON CONFLICT (id) DO NOTHING;
    `);

    // Create manager_organizations table
    await queryRunner.createTable(
      new Table({
        name: 'manager_organizations',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'verification_status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'verified_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'verified_by',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create foreign key for verified_by
    await queryRunner.createForeignKey(
      'manager_organizations',
      new TableForeignKey({
        columnNames: ['verified_by'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Create indexes for manager_organizations
    await queryRunner.createIndex(
      'manager_organizations',
      new TableIndex({
        name: 'IDX_manager_organizations_name',
        columnNames: ['name'],
      }),
    );

    await queryRunner.createIndex(
      'manager_organizations',
      new TableIndex({
        name: 'IDX_manager_organizations_verification_status',
        columnNames: ['verification_status'],
      }),
    );

    await queryRunner.createIndex(
      'manager_organizations',
      new TableIndex({
        name: 'IDX_manager_organizations_deleted_at',
        columnNames: ['deleted_at'],
      }),
    );

    // Create manager_instances table
    await queryRunner.createTable(
      new Table({
        name: 'manager_instances',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'organization_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'user_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create foreign keys for manager_instances
    await queryRunner.createForeignKey(
      'manager_instances',
      new TableForeignKey({
        columnNames: ['organization_id'],
        referencedTableName: 'manager_organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'manager_instances',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create unique constraint on (organization_id, user_id, deleted_at)
    // Note: PostgreSQL doesn't support NULL in unique constraints the same way,
    // so we'll create a partial unique index instead
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_manager_instances_organization_user_active"
      ON manager_instances (organization_id, user_id)
      WHERE deleted_at IS NULL;
    `);

    // Create indexes for manager_instances
    await queryRunner.createIndex(
      'manager_instances',
      new TableIndex({
        name: 'IDX_manager_instances_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    await queryRunner.createIndex(
      'manager_instances',
      new TableIndex({
        name: 'IDX_manager_instances_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'manager_instances',
      new TableIndex({
        name: 'IDX_manager_instances_deleted_at',
        columnNames: ['deleted_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      'manager_instances',
      'IDX_manager_instances_deleted_at',
    );
    await queryRunner.dropIndex(
      'manager_instances',
      'IDX_manager_instances_user_id',
    );
    await queryRunner.dropIndex(
      'manager_instances',
      'IDX_manager_instances_organization_id',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_manager_instances_organization_user_active";',
    );

    // Drop tables
    await queryRunner.dropTable('manager_instances', true);
    await queryRunner.dropTable('manager_organizations', true);

    // Remove manager role (optional - may want to keep for data integrity)
    // await queryRunner.query(`DELETE FROM role WHERE id = 3;`);
  }
}
