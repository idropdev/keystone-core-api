import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Migration: Create AnythingLLM User Mappings Table
 *
 * Creates the anythingllm_user_mappings table to store the mapping between
 * Keystone users and AnythingLLM users/workspaces.
 */
export class CreateAnythingLLMUserMappings1767000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'anythingllm_user_mappings',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'keystone_user_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'anythingllm_user_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'workspace_slug',
            type: 'varchar',
            length: '255',
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

    // Create indexes
    await queryRunner.createIndex(
      'anythingllm_user_mappings',
      new TableIndex({
        name: 'IDX_anythingllm_user_mappings_keystone_user_id',
        columnNames: ['keystone_user_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'anythingllm_user_mappings',
      new TableIndex({
        name: 'IDX_anythingllm_user_mappings_workspace_slug',
        columnNames: ['workspace_slug'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      'anythingllm_user_mappings',
      'IDX_anythingllm_user_mappings_workspace_slug',
    );
    await queryRunner.dropIndex(
      'anythingllm_user_mappings',
      'IDX_anythingllm_user_mappings_keystone_user_id',
    );

    // Drop table
    await queryRunner.dropTable('anythingllm_user_mappings', true);
  }
}

