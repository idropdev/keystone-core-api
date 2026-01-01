import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddOriginManagerToDocuments1735000003000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add origin_manager_id column (NOT NULL, but we'll allow DEFAULT 0 temporarily for existing rows)
    // NOTE: In production, you should migrate existing documents to have a valid origin_manager_id
    // before making this NOT NULL. For now, we use DEFAULT 0 as a temporary measure.
    await queryRunner.addColumn(
      'documents',
      new TableColumn({
        name: 'origin_manager_id',
        type: 'integer',
        isNullable: true, // Temporarily nullable for migration safety
        default: null,
      }),
    );

    // Add origin_user_context_id column (nullable - optional)
    await queryRunner.addColumn(
      'documents',
      new TableColumn({
        name: 'origin_user_context_id',
        type: 'integer',
        isNullable: true,
      }),
    );

    // Create foreign key constraint for origin_manager_id
    // NOTE: origin_manager_id references manager_instances.id, not user.id
    await queryRunner.createForeignKey(
      'documents',
      new TableForeignKey({
        columnNames: ['origin_manager_id'],
        referencedTableName: 'manager_instances',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT', // Prevent deletion of manager if documents exist
      }),
    );

    // Create foreign key constraint for origin_user_context_id
    await queryRunner.createForeignKey(
      'documents',
      new TableForeignKey({
        columnNames: ['origin_user_context_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL', // If user is deleted, set to NULL
      }),
    );

    // Create index on origin_manager_id for fast lookups
    await queryRunner.createIndex(
      'documents',
      new TableIndex({
        name: 'IDX_documents_origin_manager_id',
        columnNames: ['origin_manager_id'],
      }),
    );

    // NOTE: After migrating existing documents to have valid origin_manager_id values,
    // you should make the column NOT NULL by running:
    // ALTER TABLE documents ALTER COLUMN origin_manager_id SET NOT NULL;
    // This should be done in a separate migration after data migration is complete.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('documents', 'IDX_documents_origin_manager_id');

    // Drop foreign keys (they will be automatically dropped when columns are removed)
    const table = await queryRunner.getTable('documents');
    const originManagerFk = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('origin_manager_id') !== -1,
    );
    const originUserContextFk = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('origin_user_context_id') !== -1,
    );

    if (originManagerFk) {
      await queryRunner.dropForeignKey('documents', originManagerFk);
    }
    if (originUserContextFk) {
      await queryRunner.dropForeignKey('documents', originUserContextFk);
    }

    // Drop columns
    await queryRunner.dropColumn('documents', 'origin_user_context_id');
    await queryRunner.dropColumn('documents', 'origin_manager_id');
  }
}
