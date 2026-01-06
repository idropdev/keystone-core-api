import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
  TableIndex,
  TableCheck,
} from 'typeorm';

export class AddTemporaryManagerToDocuments1768000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Make origin_manager_id nullable (if it has a NOT NULL constraint)
    // Check if column exists and is nullable
    const table = await queryRunner.getTable('documents');
    const originManagerColumn = table?.findColumnByName('origin_manager_id');
    
    if (originManagerColumn && !originManagerColumn.isNullable) {
      await queryRunner.query(
        `ALTER TABLE documents ALTER COLUMN origin_manager_id DROP NOT NULL`,
      );
    }

    // 2. Add temporary_manager_id column
    await queryRunner.addColumn(
      'documents',
      new TableColumn({
        name: 'temporary_manager_id',
        type: 'integer',
        isNullable: true,
        default: null,
      }),
    );

    // 3. Handle existing documents with NULL origin_manager_id
    // For documents that have NULL origin_manager_id, set temporary_manager_id to user_id
    // This assumes those documents were uploaded by users before the manager system
    await queryRunner.query(
      `UPDATE documents 
       SET temporary_manager_id = user_id 
       WHERE origin_manager_id IS NULL AND temporary_manager_id IS NULL`,
    );

    // 4. Add foreign key constraint for temporary_manager_id
    await queryRunner.createForeignKey(
      'documents',
      new TableForeignKey({
        columnNames: ['temporary_manager_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL', // If user is deleted, set to NULL
      }),
    );

    // 5. Add check constraint: exactly one of origin_manager_id or temporary_manager_id must be set
    // This will now pass because we've ensured all existing documents have at least one set
    await queryRunner.query(
      `ALTER TABLE documents 
       ADD CONSTRAINT CHK_documents_origin_exclusive 
       CHECK (
         (origin_manager_id IS NOT NULL AND temporary_manager_id IS NULL) OR
         (origin_manager_id IS NULL AND temporary_manager_id IS NOT NULL)
       )`,
    );

    // 6. Add index on temporary_manager_id for fast lookups
    await queryRunner.createIndex(
      'documents',
      new TableIndex({
        name: 'IDX_documents_temporary_manager_id',
        columnNames: ['temporary_manager_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.dropIndex('documents', 'IDX_documents_temporary_manager_id');

    // Drop check constraint
    await queryRunner.query(
      `ALTER TABLE documents DROP CONSTRAINT IF EXISTS CHK_documents_origin_exclusive`,
    );

    // Drop foreign key
    const table = await queryRunner.getTable('documents');
    const temporaryManagerFk = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('temporary_manager_id') !== -1,
    );

    if (temporaryManagerFk) {
      await queryRunner.dropForeignKey('documents', temporaryManagerFk);
    }

    // Drop column
    await queryRunner.dropColumn('documents', 'temporary_manager_id');

    // Restore NOT NULL constraint on origin_manager_id if needed
    // Note: This might fail if there are NULL values, so we'll leave it nullable
    // The application logic should ensure origin_manager_id is set for existing documents
  }
}

