#!/usr/bin/env bash
#
# backfill-anythingllm-refusal-text.sh
#
# One-time backfill to normalize the AnythingLLM queryRefusalResponse text
# across all workspaces.
#
# Context: Workspaces 1, 3-7 were provisioned before the 2026-05-18 Atlas
# prompt rollout and still carry the original refusal text "I don't have
# enough grounded context to answer confidently. Please add more detail or
# documents I can search". Workspaces 8+ carry the friendlier "I haven't
# seen anything about that in your records yet..." text that the current
# provisioning code emits. This script flips the older workspaces to the
# friendlier text so UAT testers see a consistent voice regardless of when
# their account was created.
#
# Companion to backfill-anythingllm-chatmode.sh — runs after that script
# has already taken effect. Idempotent: re-running is a no-op once all
# workspaces hold the new text.
#
# Prereqs: gcloud (authenticated against healthatlas-dev-vp), gsutil, sqlite3.

set -euo pipefail

BUCKET="gs://healthatlas-dev-vp-anythingllm-storage"
LOCAL_DB="/tmp/anythingllm.db"
BACKUP_DB="/tmp/anythingllm.db.bak-refusal-$(date +%Y%m%d-%H%M%S)"

echo "==> Downloading current SQLite DB"
gsutil cp "$BUCKET/anythingllm.db" "$LOCAL_DB"
cp "$LOCAL_DB" "$BACKUP_DB"
echo "    Backup saved at $BACKUP_DB"

echo "==> Pre-state: distinct refusal texts"
sqlite3 "$LOCAL_DB" "SELECT COUNT(*) AS workspaces, substr(queryRefusalResponse, 1, 60) AS text_prefix FROM workspaces GROUP BY queryRefusalResponse;"

echo "==> Applying UPDATE (single transaction)"
sqlite3 "$LOCAL_DB" <<'SQL'
BEGIN TRANSACTION;

UPDATE workspaces
SET queryRefusalResponse = 'I haven''t seen anything about that in your records yet. If you upload the document or test result, I can help you make sense of it.'
WHERE queryRefusalResponse LIKE '%grounded context%';

COMMIT;
SQL

echo "==> Post-state: every workspace's refusal text"
sqlite3 "$LOCAL_DB" "SELECT id, name, substr(queryRefusalResponse, 1, 80) FROM workspaces ORDER BY id;"

echo "==> Post-state: distinct refusal texts (should be a single row now)"
sqlite3 "$LOCAL_DB" "SELECT COUNT(*) AS workspaces, substr(queryRefusalResponse, 1, 60) AS text_prefix FROM workspaces GROUP BY queryRefusalResponse;"

echo "==> Re-uploading modified DB"
gsutil cp "$LOCAL_DB" "$BUCKET/anythingllm.db"

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
