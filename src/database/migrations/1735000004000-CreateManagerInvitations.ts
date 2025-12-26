import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateManagerInvitations1735000004000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create manager_invitations table
    await queryRunner.createTable(
      new Table({
        name: 'manager_invitations',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'organization_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'invited_by_admin_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'token',
            type: 'varchar',
            length: '255',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: false,
          },
          {
            name: 'accepted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
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
        ],
      }),
      true,
    );

    // Create foreign key to manager_organizations
    await queryRunner.createForeignKey(
      'manager_invitations',
      new TableForeignKey({
        columnNames: ['organization_id'],
        referencedTableName: 'manager_organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create foreign key to users (admin who invited)
    await queryRunner.createForeignKey(
      'manager_invitations',
      new TableForeignKey({
        columnNames: ['invited_by_admin_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // Create indexes
    await queryRunner.createIndex(
      'manager_invitations',
      new TableIndex({
        name: 'IDX_manager_invitations_email',
        columnNames: ['email'],
      }),
    );

    await queryRunner.createIndex(
      'manager_invitations',
      new TableIndex({
        name: 'IDX_manager_invitations_token',
        columnNames: ['token'],
      }),
    );

    await queryRunner.createIndex(
      'manager_invitations',
      new TableIndex({
        name: 'IDX_manager_invitations_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'manager_invitations',
      new TableIndex({
        name: 'IDX_manager_invitations_organization_id',
        columnNames: ['organization_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      'manager_invitations',
      'IDX_manager_invitations_organization_id',
    );
    await queryRunner.dropIndex(
      'manager_invitations',
      'IDX_manager_invitations_status',
    );
    await queryRunner.dropIndex(
      'manager_invitations',
      'IDX_manager_invitations_token',
    );
    await queryRunner.dropIndex(
      'manager_invitations',
      'IDX_manager_invitations_email',
    );

    // Drop table (foreign keys will be dropped automatically)
    await queryRunner.dropTable('manager_invitations', true);
  }
}

