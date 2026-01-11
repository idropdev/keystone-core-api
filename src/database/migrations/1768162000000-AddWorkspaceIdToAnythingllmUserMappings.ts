import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkspaceIdToAnythingllmUserMappings1768162000000
  implements MigrationInterface
{
  name = 'AddWorkspaceIdToAnythingllmUserMappings1768162000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add workspace_id column to anythingllm_user_mappings table
    await queryRunner.query(
      `ALTER TABLE "anythingllm_user_mappings" ADD "workspace_id" integer`,
    );

    // Add index on workspace_id for efficient lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_anythingllm_user_mappings_workspace_id" ON "anythingllm_user_mappings" ("workspace_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove index
    await queryRunner.query(
      `DROP INDEX "public"."IDX_anythingllm_user_mappings_workspace_id"`,
    );

    // Remove workspace_id column
    await queryRunner.query(
      `ALTER TABLE "anythingllm_user_mappings" DROP COLUMN "workspace_id"`,
    );
  }
}
