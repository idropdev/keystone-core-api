import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddDeletionRequestType
 *
 * SYSTEM-100: Deletion Request Workflow
 *
 * Extends the revocation_requests table to support deletion_request type.
 * This allows users to request document deletion through the revocation workflow.
 *
 * NOTE: This migration checks if the table exists before running.
 * If revocation_requests doesn't exist yet, it will be handled by the entity definition.
 */
export class AddDeletionRequestType1768402000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if revocation_requests table exists
    const tableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'revocation_requests'
      );
    `);

    if (!tableExists[0]?.exists) {
      console.log(
        '[Migration AddDeletionRequestType] revocation_requests table does not exist yet, skipping...',
      );
      return;
    }

    // Drop the existing CHECK constraint on requestType
    await queryRunner.query(`
      ALTER TABLE revocation_requests
      DROP CONSTRAINT IF EXISTS "CHK_revocation_requests_requestType"
    `);

    // PostgreSQL: Try alternative constraint name patterns
    await queryRunner.query(`
      DO $$
      DECLARE
        constraint_name TEXT;
      BEGIN
        SELECT conname INTO constraint_name
        FROM pg_constraint
        WHERE conrelid = 'revocation_requests'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%request_type%';
        
        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE revocation_requests DROP CONSTRAINT %I', constraint_name);
        END IF;
      END
      $$;
    `);

    // Add the new CHECK constraint with deletion_request
    await queryRunner.query(`
      ALTER TABLE revocation_requests
      ADD CONSTRAINT "CHK_revocation_requests_requestType"
      CHECK ("request_type" IN ('self_revocation', 'user_revocation', 'manager_revocation', 'deletion_request'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check if revocation_requests table exists
    const tableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'revocation_requests'
      );
    `);

    if (!tableExists[0]?.exists) {
      return;
    }

    // Drop the new constraint
    await queryRunner.query(`
      ALTER TABLE revocation_requests
      DROP CONSTRAINT IF EXISTS "CHK_revocation_requests_requestType"
    `);

    // Restore original constraint (without deletion_request)
    await queryRunner.query(`
      ALTER TABLE revocation_requests
      ADD CONSTRAINT "CHK_revocation_requests_requestType"
      CHECK ("request_type" IN ('self_revocation', 'user_revocation', 'manager_revocation'))
    `);
  }
}
