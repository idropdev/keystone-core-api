import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
} from 'typeorm';

/**
 * Migration to support document-scoped manager authority.
 *
 * This migration makes origin_manager_id nullable to allow users to upload
 * documents without assigned managers. When a user uploads without a manager,
 * they become the temporary origin manager for that document only.
 *
 * Once a manager is assigned to a document, origin_manager_id becomes non-null
 * and the user loses manager-level authority (irreversible).
 */
export class MakeOriginManagerNullableForDocumentScopedAuthority1768000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The column is already nullable from the AddOriginManagerToDocuments migration,
    // but we need to ensure the foreign key constraint allows NULL values.
    // TypeORM foreign keys with nullable columns should already allow NULL,
    // but we'll verify and document the intent.

    // Ensure the foreign key constraint allows NULL values
    // (This should already be the case, but we're being explicit)
    const table = await queryRunner.getTable('documents');
    const originManagerColumn = table?.findColumnByName('origin_manager_id');

    if (originManagerColumn && !originManagerColumn.isNullable) {
      // Make it nullable if it's not already
      await queryRunner.changeColumn(
        'documents',
        'origin_manager_id',
        new TableColumn({
          name: 'origin_manager_id',
          type: 'integer',
          isNullable: true,
        }),
      );
    }

    // STEP 1: Fix existing data - migrate documents that have both origin fields as NULL
    // For documents created before origin_manager_id existed, set origin_user_context_id = user_id
    // This makes the uploading user the temporary origin manager (backward compatible)
    await queryRunner.query(`
      UPDATE documents 
      SET origin_user_context_id = user_id
      WHERE origin_manager_id IS NULL 
        AND origin_user_context_id IS NULL
        AND user_id IS NOT NULL;
    `);

    // STEP 2: Add a check constraint to ensure that either origin_manager_id OR origin_user_context_id is set
    // This ensures documents always have an origin authority
    // Note: We do this AFTER fixing existing data to avoid constraint violations
    await queryRunner.query(`
      ALTER TABLE documents 
      ADD CONSTRAINT chk_documents_has_origin_authority 
      CHECK (
        origin_manager_id IS NOT NULL OR origin_user_context_id IS NOT NULL
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the check constraint
    await queryRunner.query(`
      ALTER TABLE documents 
      DROP CONSTRAINT IF EXISTS chk_documents_has_origin_authority;
    `);

    // Note: We don't make origin_manager_id NOT NULL in the down migration
    // because there may be documents with NULL origin_manager_id that need
    // to be migrated first. This is a data migration concern.
  }
}

