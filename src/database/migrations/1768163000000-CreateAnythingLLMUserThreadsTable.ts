import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnythingLLMUserThreadsTable1768163000000
  implements MigrationInterface
{
  name = 'CreateAnythingLLMUserThreadsTable1768163000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create anythingllm_user_threads table
    await queryRunner.query(
      `CREATE TABLE "anythingllm_user_threads" (
        "id" SERIAL NOT NULL,
        "keystone_user_id" character varying(255) NOT NULL,
        "anythingllm_user_id" integer NOT NULL,
        "workspace_slug" character varying(255) NOT NULL,
        "thread_slug" character varying(255) NOT NULL,
        "thread_name" character varying(500),
        "workspace_id" integer,
        "message_count" integer NOT NULL DEFAULT 0,
        "last_message_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_anythingllm_user_threads" PRIMARY KEY ("id")
      )`,
    );

    // Create indexes for efficient queries
    await queryRunner.query(
      `CREATE INDEX "IDX_anythingllm_user_threads_keystone_user_id" ON "anythingllm_user_threads" ("keystone_user_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anythingllm_user_threads_anythingllm_user_id" ON "anythingllm_user_threads" ("anythingllm_user_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anythingllm_user_threads_workspace_slug" ON "anythingllm_user_threads" ("workspace_slug")`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_anythingllm_user_threads_thread_slug" ON "anythingllm_user_threads" ("thread_slug")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anythingllm_user_threads_last_message_at" ON "anythingllm_user_threads" ("last_message_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anythingllm_user_threads_deleted_at" ON "anythingllm_user_threads" ("deleted_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(
      `DROP INDEX "public"."IDX_anythingllm_user_threads_deleted_at"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_anythingllm_user_threads_last_message_at"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_anythingllm_user_threads_thread_slug"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_anythingllm_user_threads_workspace_slug"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_anythingllm_user_threads_anythingllm_user_id"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_anythingllm_user_threads_keystone_user_id"`,
    );

    // Drop table
    await queryRunner.query(`DROP TABLE "anythingllm_user_threads"`);
  }
}
