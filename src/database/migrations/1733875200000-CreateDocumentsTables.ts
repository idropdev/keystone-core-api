import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateDocumentsTables1733875200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension if not already enabled
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Create documents table
    await queryRunner.createTable(
      new Table({
        name: 'documents',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'document_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'raw_file_uri',
            type: 'varchar',
            length: '500',
            isNullable: false,
          },
          {
            name: 'processed_file_uri',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            name: 'ocr_json_output',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'extracted_text',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'confidence',
            type: 'decimal',
            precision: 5,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'file_name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'file_size',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'mime_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'page_count',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'retry_count',
            type: 'integer',
            default: 0,
            isNullable: false,
          },
          {
            name: 'uploaded_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'processing_started_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'processed_at',
            type: 'timestamp',
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
          {
            name: 'scheduled_deletion_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create foreign key to users table
    await queryRunner.createForeignKey(
      'documents',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create indexes for common queries
    await queryRunner.createIndex(
      'documents',
      new TableIndex({
        name: 'IDX_documents_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'documents',
      new TableIndex({ name: 'IDX_documents_status', columnNames: ['status'] }),
    );

    await queryRunner.createIndex(
      'documents',
      new TableIndex({
        name: 'IDX_documents_document_type',
        columnNames: ['document_type'],
      }),
    );

    await queryRunner.createIndex(
      'documents',
      new TableIndex({
        name: 'IDX_documents_deleted_at',
        columnNames: ['deleted_at'],
      }),
    );

    await queryRunner.createIndex(
      'documents',
      new TableIndex({
        name: 'IDX_documents_scheduled_deletion_at',
        columnNames: ['scheduled_deletion_at'],
      }),
    );

    await queryRunner.createIndex(
      'documents',
      new TableIndex({
        name: 'IDX_documents_processing_started_at',
        columnNames: ['processing_started_at'],
      }),
    );

    // Create extracted_fields table
    await queryRunner.createTable(
      new Table({
        name: 'extracted_fields',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'document_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'field_key',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'field_value',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'field_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'confidence',
            type: 'decimal',
            precision: 5,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'start_index',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'end_index',
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
        ],
      }),
      true,
    );

    // Create foreign key to documents table
    await queryRunner.createForeignKey(
      'extracted_fields',
      new TableForeignKey({
        columnNames: ['document_id'],
        referencedTableName: 'documents',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create indexes
    await queryRunner.createIndex(
      'extracted_fields',
      new TableIndex({
        name: 'IDX_extracted_fields_document_id',
        columnNames: ['document_id'],
      }),
    );

    await queryRunner.createIndex(
      'extracted_fields',
      new TableIndex({
        name: 'IDX_extracted_fields_field_key',
        columnNames: ['field_key'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('extracted_fields', true);
    await queryRunner.dropTable('documents', true);
  }
}
