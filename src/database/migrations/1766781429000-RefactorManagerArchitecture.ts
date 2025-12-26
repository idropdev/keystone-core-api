import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/**
 * Migration to refactor Manager architecture:
 * - Remove ManagerOrganization concept
 * - Consolidate ManagerInstance into Manager
 * - Add manager identity fields to invitations
 * - Move verification to manager level
 */
export class RefactorManagerArchitecture1766781429000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Add manager identity fields to manager_invitations
    // Start with display_name as nullable, populate existing rows, then make NOT NULL
    await queryRunner.addColumn(
      'manager_invitations',
      new TableColumn({
        name: 'display_name',
        type: 'varchar',
        length: '255',
        isNullable: true, // Start nullable, will be set to NOT NULL after data migration
      }),
    );

    // Populate display_name for existing invitations
    await queryRunner.query(`
      UPDATE manager_invitations 
      SET display_name = COALESCE(
        (SELECT name FROM manager_organizations WHERE id = manager_invitations.organization_id),
        'Manager Invitation ' || id::text
      )
      WHERE display_name IS NULL;
    `);

    // Now make it NOT NULL
    await queryRunner.query(`
      ALTER TABLE manager_invitations 
      ALTER COLUMN display_name SET NOT NULL;
    `);

    await queryRunner.addColumn(
      'manager_invitations',
      new TableColumn({
        name: 'legal_name',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_invitations',
      new TableColumn({
        name: 'address',
        type: 'varchar',
        length: '500',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_invitations',
      new TableColumn({
        name: 'latitude',
        type: 'decimal',
        precision: 10,
        scale: 8,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_invitations',
      new TableColumn({
        name: 'longitude',
        type: 'decimal',
        precision: 11,
        scale: 8,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_invitations',
      new TableColumn({
        name: 'phone_number',
        type: 'varchar',
        length: '50',
        isNullable: true,
      }),
    );

    // Step 2: Add verification and identity fields to manager_instances
    // Check which columns already exist (from AddManagerInstanceProfileFields migration)
    const instanceTable = await queryRunner.getTable('manager_instances');
    const existingColumns = instanceTable?.columns.map((col) => col.name) || [];
    
    const hasDisplayName = existingColumns.includes('display_name');
    const hasPhone = existingColumns.includes('phone');
    const hasPhoneNumber = existingColumns.includes('phone_number');
    const hasOperatingHours = existingColumns.includes('operating_hours');

    // Add display_name if it doesn't exist
    if (!hasDisplayName) {
      await queryRunner.addColumn(
        'manager_instances',
        new TableColumn({
          name: 'display_name',
          type: 'varchar',
          length: '255',
          isNullable: true, // Start as nullable, will be set to NOT NULL after data migration
        }),
      );
    } else {
      // If it exists, make sure it's nullable for now (in case it was NOT NULL)
      await queryRunner.query(`
        ALTER TABLE manager_instances 
        ALTER COLUMN display_name DROP NOT NULL;
      `);
    }

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'legal_name',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'address',
        type: 'varchar',
        length: '500',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'latitude',
        type: 'decimal',
        precision: 10,
        scale: 8,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'longitude',
        type: 'decimal',
        precision: 11,
        scale: 8,
        isNullable: true,
      }),
    );

    // Handle phone_number: rename 'phone' to 'phone_number' if it exists, otherwise add it
    if (hasPhone && !hasPhoneNumber) {
      await queryRunner.query(`
        ALTER TABLE manager_instances 
        RENAME COLUMN phone TO phone_number;
      `);
    } else if (!hasPhone && !hasPhoneNumber) {
      await queryRunner.addColumn(
        'manager_instances',
        new TableColumn({
          name: 'phone_number',
          type: 'varchar',
          length: '50',
          isNullable: true,
        }),
      );
    }
    // If phone_number already exists, do nothing

    // Add operating_hours if it doesn't exist
    if (!hasOperatingHours) {
      await queryRunner.addColumn(
        'manager_instances',
        new TableColumn({
          name: 'operating_hours',
          type: 'varchar',
          length: '500',
          isNullable: true,
        }),
      );
    }

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'timezone',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'verification_status',
        type: 'varchar',
        length: '50',
        default: "'pending'",
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'verified_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'verified_by_admin_id',
        type: 'integer',
        isNullable: true,
      }),
    );

    // Step 3: Migrate verification status from organizations to instances
    await queryRunner.query(`
      UPDATE manager_instances mi
      SET 
        verification_status = COALESCE(mo.verification_status, 'pending'),
        verified_at = mo.verified_at,
        verified_by_admin_id = mo.verified_by
      FROM manager_organizations mo
      WHERE mi.organization_id = mo.id;
    `);

    // Step 4: Migrate display_name from existing profile fields if available
    // (This handles existing data that might have display_name from AddManagerInstanceProfileFields migration)
    await queryRunner.query(`
      UPDATE manager_instances
      SET display_name = COALESCE(NULLIF(display_name, ''), 'Manager ' || id::text)
      WHERE display_name IS NULL OR display_name = '';
    `);

    // Now make display_name NOT NULL
    await queryRunner.query(`
      ALTER TABLE manager_instances 
      ALTER COLUMN display_name SET NOT NULL;
    `);

    // Step 5: Create foreign key for verified_by_admin_id
    await queryRunner.createForeignKey(
      'manager_instances',
      new TableForeignKey({
        columnNames: ['verified_by_admin_id'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Step 6: Create indexes for new fields
    await queryRunner.createIndex(
      'manager_instances',
      new TableIndex({
        name: 'IDX_manager_instances_verification_status',
        columnNames: ['verification_status'],
      }),
    );

    // Step 7: Remove organization_id from manager_invitations
    // First make it nullable, then set to NULL for all rows
    await queryRunner.query(`
      ALTER TABLE manager_invitations 
      ALTER COLUMN organization_id DROP NOT NULL;
    `);

    await queryRunner.query(`
      UPDATE manager_invitations 
      SET organization_id = NULL;
    `);

    // Drop the foreign key
    const invitationTable = await queryRunner.getTable('manager_invitations');
    const orgForeignKey = invitationTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('organization_id') !== -1,
    );
    if (orgForeignKey) {
      await queryRunner.dropForeignKey('manager_invitations', orgForeignKey);
    }

    // Drop the index
    await queryRunner.dropIndex(
      'manager_invitations',
      'IDX_manager_invitations_organization_id',
    );

    // Drop the column
    await queryRunner.dropColumn('manager_invitations', 'organization_id');

    // Step 8: Remove organization_id from manager_instances
    // First make it nullable, then set to NULL for all rows
    await queryRunner.query(`
      ALTER TABLE manager_instances 
      ALTER COLUMN organization_id DROP NOT NULL;
    `);

    await queryRunner.query(`
      UPDATE manager_instances 
      SET organization_id = NULL;
    `);

    // Drop the foreign key
    const instanceTableForFk = await queryRunner.getTable('manager_instances');
    const instanceOrgForeignKey = instanceTableForFk?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('organization_id') !== -1,
    );
    if (instanceOrgForeignKey) {
      await queryRunner.dropForeignKey('manager_instances', instanceOrgForeignKey);
    }

    // Drop the unique index that includes organization_id
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_manager_instances_organization_user_active";',
    );

    // Drop the index
    await queryRunner.dropIndex(
      'manager_instances',
      'IDX_manager_instances_organization_id',
    );

    // Drop the column
    await queryRunner.dropColumn('manager_instances', 'organization_id');

    // Step 9: Rename manager_instances to managers
    await queryRunner.renameTable('manager_instances', 'managers');

    // Step 10: Update foreign key references in documents table
    // (This will be handled by the foreign key constraint name change)
    await queryRunner.query(`
      DO $$
      BEGIN
        -- Rename foreign key constraint if it exists
        IF EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'FK_documents_origin_manager_id_manager_instances'
        ) THEN
          ALTER TABLE documents 
          RENAME CONSTRAINT FK_documents_origin_manager_id_manager_instances 
          TO FK_documents_origin_manager_id_managers;
        END IF;
      END $$;
    `);

    // Step 11: Drop manager_organizations table (after all references are removed)
    await queryRunner.dropTable('manager_organizations', true);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse the migration - this is complex and may not be fully reversible
    // Recreate manager_organizations table
    await queryRunner.query(`
      CREATE TABLE manager_organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        verification_status VARCHAR(50) DEFAULT 'pending' NOT NULL,
        verified_at TIMESTAMP,
        verified_by INTEGER,
        created_at TIMESTAMP DEFAULT now() NOT NULL,
        updated_at TIMESTAMP DEFAULT now() NOT NULL,
        deleted_at TIMESTAMP,
        CONSTRAINT FK_manager_organizations_verified_by 
          FOREIGN KEY (verified_by) REFERENCES "user"(id) ON DELETE SET NULL
      );
    `);

    // Rename managers back to manager_instances
    await queryRunner.renameTable('managers', 'manager_instances');

    // Add organization_id back to manager_instances
    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'organization_id',
        type: 'integer',
        isNullable: true, // Allow null during migration
      }),
    );

    // Add organization_id back to manager_invitations
    await queryRunner.addColumn(
      'manager_invitations',
      new TableColumn({
        name: 'organization_id',
        type: 'integer',
        isNullable: true, // Allow null during migration
      }),
    );

    // Remove new fields from manager_invitations
    await queryRunner.dropColumn('manager_invitations', 'phone_number');
    await queryRunner.dropColumn('manager_invitations', 'longitude');
    await queryRunner.dropColumn('manager_invitations', 'latitude');
    await queryRunner.dropColumn('manager_invitations', 'address');
    await queryRunner.dropColumn('manager_invitations', 'legal_name');
    await queryRunner.dropColumn('manager_invitations', 'display_name');

    // Remove new fields from manager_instances
    await queryRunner.dropIndex(
      'manager_instances',
      'IDX_manager_instances_verification_status',
    );

    const instanceTable = await queryRunner.getTable('manager_instances');
    const verifiedByFk = instanceTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('verified_by_admin_id') !== -1,
    );
    if (verifiedByFk) {
      await queryRunner.dropForeignKey('manager_instances', verifiedByFk);
    }

    await queryRunner.dropColumn('manager_instances', 'verified_by_admin_id');
    await queryRunner.dropColumn('manager_instances', 'verified_at');
    await queryRunner.dropColumn('manager_instances', 'verification_status');
    await queryRunner.dropColumn('manager_instances', 'timezone');
    await queryRunner.dropColumn('manager_instances', 'operating_hours');
    await queryRunner.dropColumn('manager_instances', 'phone_number');
    await queryRunner.dropColumn('manager_instances', 'longitude');
    await queryRunner.dropColumn('manager_instances', 'latitude');
    await queryRunner.dropColumn('manager_instances', 'address');
    await queryRunner.dropColumn('manager_instances', 'legal_name');
    await queryRunner.dropColumn('manager_instances', 'display_name');
  }
}

