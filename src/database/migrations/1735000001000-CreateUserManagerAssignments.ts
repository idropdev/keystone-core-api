import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateUserManagerAssignments1735000001000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create user_manager_assignments table
    await queryRunner.createTable(
      new Table({
        name: 'user_manager_assignments',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'user_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'manager_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'assigned_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'assigned_by',
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

    // Create foreign keys
    await queryRunner.createForeignKey(
      'user_manager_assignments',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'user_manager_assignments',
      new TableForeignKey({
        columnNames: ['manager_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'user_manager_assignments',
      new TableForeignKey({
        columnNames: ['assigned_by'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Create unique constraint on (user_id, manager_id) where deleted_at IS NULL
    // This prevents duplicate active assignments
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_user_manager_assignments_user_manager_active"
      ON user_manager_assignments (user_id, manager_id)
      WHERE deleted_at IS NULL;
    `);

    // Create indexes for common queries
    await queryRunner.createIndex(
      'user_manager_assignments',
      new TableIndex({
        name: 'IDX_user_manager_assignments_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_manager_assignments',
      new TableIndex({
        name: 'IDX_user_manager_assignments_manager_id',
        columnNames: ['manager_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_manager_assignments',
      new TableIndex({
        name: 'IDX_user_manager_assignments_deleted_at',
        columnNames: ['deleted_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      'user_manager_assignments',
      'IDX_user_manager_assignments_deleted_at',
    );
    await queryRunner.dropIndex(
      'user_manager_assignments',
      'IDX_user_manager_assignments_manager_id',
    );
    await queryRunner.dropIndex(
      'user_manager_assignments',
      'IDX_user_manager_assignments_user_id',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_user_manager_assignments_user_manager_active";',
    );

    // Drop table (foreign keys will be dropped automatically)
    await queryRunner.dropTable('user_manager_assignments', true);
  }
}

