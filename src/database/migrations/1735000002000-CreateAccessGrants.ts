import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableCheck,
} from 'typeorm';

export class CreateAccessGrants1735000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create access_grants table
    await queryRunner.createTable(
      new Table({
        name: 'access_grants',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'document_id',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
          {
            name: 'subject_type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'subject_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'grant_type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'granted_by_type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'granted_by_id',
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
            name: 'revoked_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'revoked_by_type',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'revoked_by_id',
            type: 'integer',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create foreign key to documents table
    await queryRunner.createForeignKey(
      'access_grants',
      new TableForeignKey({
        columnNames: ['document_id'],
        referencedTableName: 'documents',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create CHECK constraints for enum values
    await queryRunner.query(`
      ALTER TABLE access_grants
      ADD CONSTRAINT check_subject_type
      CHECK (subject_type IN ('user', 'manager'));
    `);

    await queryRunner.query(`
      ALTER TABLE access_grants
      ADD CONSTRAINT check_grant_type
      CHECK (grant_type IN ('owner', 'delegated', 'derived'));
    `);

    await queryRunner.query(`
      ALTER TABLE access_grants
      ADD CONSTRAINT check_granted_by_type
      CHECK (granted_by_type IN ('user', 'manager'));
    `);

    await queryRunner.query(`
      ALTER TABLE access_grants
      ADD CONSTRAINT check_revoked_by_type
      CHECK (revoked_by_type IS NULL OR revoked_by_type IN ('user', 'manager'));
    `);

    // Create unique constraint on (document_id, subject_type, subject_id) where revoked_at IS NULL
    // This prevents duplicate active grants for the same subject
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_access_grants_document_subject_active"
      ON access_grants (document_id, subject_type, subject_id)
      WHERE revoked_at IS NULL;
    `);

    // Create indexes for common queries
    await queryRunner.createIndex(
      'access_grants',
      new TableIndex({
        name: 'IDX_access_grants_document_id',
        columnNames: ['document_id'],
      }),
    );

    await queryRunner.createIndex(
      'access_grants',
      new TableIndex({
        name: 'IDX_access_grants_subject_type_subject_id',
        columnNames: ['subject_type', 'subject_id'],
      }),
    );

    await queryRunner.createIndex(
      'access_grants',
      new TableIndex({
        name: 'IDX_access_grants_revoked_at',
        columnNames: ['revoked_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      'access_grants',
      'IDX_access_grants_revoked_at',
    );
    await queryRunner.dropIndex(
      'access_grants',
      'IDX_access_grants_subject_type_subject_id',
    );
    await queryRunner.dropIndex(
      'access_grants',
      'IDX_access_grants_document_id',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_access_grants_document_subject_active";',
    );

    // Drop CHECK constraints
    await queryRunner.query(`
      ALTER TABLE access_grants
      DROP CONSTRAINT IF EXISTS check_revoked_by_type;
    `);
    await queryRunner.query(`
      ALTER TABLE access_grants
      DROP CONSTRAINT IF EXISTS check_granted_by_type;
    `);
    await queryRunner.query(`
      ALTER TABLE access_grants
      DROP CONSTRAINT IF EXISTS check_grant_type;
    `);
    await queryRunner.query(`
      ALTER TABLE access_grants
      DROP CONSTRAINT IF EXISTS check_subject_type;
    `);

    // Drop table (foreign keys will be dropped automatically)
    await queryRunner.dropTable('access_grants', true);
  }
}

