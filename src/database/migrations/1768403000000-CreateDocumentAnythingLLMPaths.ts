import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentAnythingLLMPaths1768403000000
  implements MigrationInterface
{
  name = 'CreateDocumentAnythingLLMPaths1768403000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "document_anythingllm_paths" (
        "id" SERIAL NOT NULL,
        "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
        "workspace_slug" character varying(255) NOT NULL,
        "anythingllm_doc_path" character varying(500) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_anythingllm_paths" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_document_anythingllm_paths_document_workspace" UNIQUE ("document_id", "workspace_slug")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_document_anythingllm_paths_document_id" ON "document_anythingllm_paths" ("document_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_document_anythingllm_paths_workspace_slug" ON "document_anythingllm_paths" ("workspace_slug")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_document_anythingllm_paths_workspace_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_document_anythingllm_paths_document_id"`,
    );
    await queryRunner.query(`DROP TABLE "document_anythingllm_paths"`);
  }
}

