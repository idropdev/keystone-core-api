import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProcessingMethodToDocuments1763063600497
  implements MigrationInterface
{
  name = 'AddProcessingMethodToDocuments1763063600497';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_c7481daf5059307842edef74d73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_fields" DROP CONSTRAINT "FK_5104677e7d6f444a82bee67e895"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_documents_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_documents_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_documents_document_type"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_documents_deleted_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_documents_scheduled_deletion_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_documents_processing_started_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_extracted_fields_document_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_extracted_fields_field_key"`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "documents"."processing_method" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7481daf5059307842edef74d7" ON "documents" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b882920680255cd1f3fcca0efe" ON "documents" ("document_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_709389d904fa03bdf5ec84998d" ON "documents" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_93b47b82789896e47f46c68fe1" ON "documents" ("processing_started_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08148bd32b0595201d1beb9265" ON "documents" ("deleted_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7cc7da4597fcaed15cb46aea8" ON "documents" ("scheduled_deletion_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5104677e7d6f444a82bee67e89" ON "extracted_fields" ("document_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45f398550939997a56ad326b86" ON "extracted_fields" ("field_key") `,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_c7481daf5059307842edef74d73" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_fields" ADD CONSTRAINT "FK_5104677e7d6f444a82bee67e895" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "extracted_fields" DROP CONSTRAINT "FK_5104677e7d6f444a82bee67e895"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_c7481daf5059307842edef74d73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45f398550939997a56ad326b86"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5104677e7d6f444a82bee67e89"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7cc7da4597fcaed15cb46aea8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08148bd32b0595201d1beb9265"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_93b47b82789896e47f46c68fe1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_709389d904fa03bdf5ec84998d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b882920680255cd1f3fcca0efe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7481daf5059307842edef74d7"`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "documents"."processing_method" IS 'Method used to process document: NONE, DIRECT_EXTRACTION, OCR_SYNC, OCR_BATCH'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_extracted_fields_field_key" ON "extracted_fields" ("field_key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_extracted_fields_document_id" ON "extracted_fields" ("document_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_processing_started_at" ON "documents" ("processing_started_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_scheduled_deletion_at" ON "documents" ("scheduled_deletion_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_deleted_at" ON "documents" ("deleted_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_document_type" ON "documents" ("document_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_status" ON "documents" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_user_id" ON "documents" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_fields" ADD CONSTRAINT "FK_5104677e7d6f444a82bee67e895" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_c7481daf5059307842edef74d73" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
