import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/**
 * Migration: CreateAccessRequests
 *
 * SYSTEM-100: Access Request Workflow
 *
 * Creates the access_requests table for managers to request
 * document access from origin managers.
 */
export class CreateAccessRequests1768401000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create access_requests table
    await queryRunner.createTable(
      new Table({
        name: 'access_requests',
        columns: [
          {
            name: 'id',
            type: 'serial',
            isPrimary: true,
          },
          {
            name: 'document_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'requested_by_manager_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
          },
          {
            name: 'request_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'reviewed_by_manager_id',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'reviewed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'review_notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'access_requests',
      new TableIndex({
        name: 'IDX_access_requests_document_id',
        columnNames: ['document_id'],
      }),
    );

    await queryRunner.createIndex(
      'access_requests',
      new TableIndex({
        name: 'IDX_access_requests_requested_by_manager_id',
        columnNames: ['requested_by_manager_id'],
      }),
    );

    await queryRunner.createIndex(
      'access_requests',
      new TableIndex({
        name: 'IDX_access_requests_status',
        columnNames: ['status'],
      }),
    );

    // Create FK to documents
    await queryRunner.createForeignKey(
      'access_requests',
      new TableForeignKey({
        columnNames: ['document_id'],
        referencedTableName: 'documents',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create FK to managers (requested_by)
    await queryRunner.createForeignKey(
      'access_requests',
      new TableForeignKey({
        columnNames: ['requested_by_manager_id'],
        referencedTableName: 'managers',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FKs
    const table = await queryRunner.getTable('access_requests');
    const fks = table?.foreignKeys || [];
    for (const fk of fks) {
      await queryRunner.dropForeignKey('access_requests', fk);
    }

    // Drop indexes
    await queryRunner.dropIndex(
      'access_requests',
      'IDX_access_requests_document_id',
    );
    await queryRunner.dropIndex(
      'access_requests',
      'IDX_access_requests_requested_by_manager_id',
    );
    await queryRunner.dropIndex(
      'access_requests',
      'IDX_access_requests_status',
    );

    // Drop table
    await queryRunner.dropTable('access_requests');
  }
}
