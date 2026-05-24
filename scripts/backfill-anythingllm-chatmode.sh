#!/usr/bin/env bash
#
# backfill-anythingllm-chatmode.sh
#
# One-time backfill for the AnythingLLM chatMode-query fix
# (spec: docs/superpowers/specs/2026-05-24-anythingllm-chatmode-query-design.md).
#
# - Flips chatMode='query' on all 9 user workspaces in the GCS-mounted SQLite DB
# - Deletes the dev rag-test workspace (id=2) + its document linkage + its
#   document_vectors rows + workspace_users + workspace_chats
# - Re-uploads the modified DB to the GCS bucket
# - Deletes the orphan sample_med_doc.pdf JSON from custom-documents/
# - Restarts the AnythingLLM Cloud Run service via env-var bump
#
# Idempotent: safe to re-run if any step fails mid-way. A timestamped backup
# of the original DB is kept at /tmp/anythingllm.db.bak-<ts> for rollback.
#
# Prereqs:
#   - gcloud CLI authenticated against project healthatlas-dev-vp
#   - gsutil available
#   - sqlite3 available

set -euo pipefail

BUCKET="gs://healthatlas-dev-vp-anythingllm-storage"
LOCAL_DB="/tmp/anythingllm.db"
BACKUP_DB="/tmp/anythingllm.db.bak-$(date +%Y%m%d-%H%M%S)"

echo "==> Downloading current SQLite DB"
gsutil cp "$BUCKET/anythingllm.db" "$LOCAL_DB"
cp "$LOCAL_DB" "$BACKUP_DB"
echo "    Backup saved at $BACKUP_DB"

echo "==> Pre-state read"
sqlite3 "$LOCAL_DB" "SELECT id, name, chatMode FROM workspaces ORDER BY id;"
echo ""
sqlite3 "$LOCAL_DB" "SELECT COUNT(*) AS document_vectors_count FROM document_vectors;"

echo "==> Applying transactional changes"
sqlite3 "$LOCAL_DB" <<'SQL'
BEGIN TRANSACTION;

UPDATE workspaces
SET chatMode = 'query'
WHERE name LIKE 'Workspace for user%';

DELETE FROM document_vectors
WHERE docId IN (SELECT docId FROM workspace_documents WHERE workspaceId = 2);
DELETE FROM workspace_documents WHERE workspaceId = 2;
DELETE FROM workspace_users    WHERE workspace_id = 2;
DELETE FROM workspace_chats    WHERE workspaceId = 2;
DELETE FROM workspaces         WHERE id = 2;

COMMIT;
SQL

echo "==> Post-state verification"
sqlite3 "$LOCAL_DB" "SELECT id, name, chatMode FROM workspaces ORDER BY id;"
echo ""
sqlite3 "$LOCAL_DB" "SELECT COUNT(*) AS document_vectors_count FROM document_vectors;"

echo "==> Re-uploading modified DB"
gsutil cp "$LOCAL_DB" "$BUCKET/anythingllm.db"

echo "==> Deleting orphan sample_med_doc.pdf JSON"
gsutil rm "$BUCKET/documents/custom-documents/sample_med_doc.pdf-6575a1c7-08f1-4c6a-a6ac-02fb2f54ecee.json" || \
  echo "    (already deleted or never existed — fine)"

echo "==> Restarting AnythingLLM Cloud Run (env-var bump)"
gcloud run services update anythingllm \
  --region=us-central1 \
  --project=healthatlas-dev-vp \
  --update-env-vars "FORCE_RESTART_TS=$(date +%s)"

echo ""
echo "Done. New AnythingLLM revision is live in ~30 seconds."
echo "Backup retained at: $BACKUP_DB"
echo ""
echo "Rollback if needed:"
echo "  gsutil cp $BACKUP_DB $BUCKET/anythingllm.db"
echo "  gcloud run services update anythingllm --region=us-central1 \\"
echo "    --project=healthatlas-dev-vp --update-env-vars FORCE_RESTART_TS=\$(date +%s)"
