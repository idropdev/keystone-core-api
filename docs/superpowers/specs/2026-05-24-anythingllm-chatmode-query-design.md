# AnythingLLM chatMode → query (stop hallucination) — Design

**Date:** 2026-05-24
**Status:** Approved design, ready for implementation plan
**Context:** UAT TestFlight prep. The Top Insights chat is inventing medical
content for users whose AnythingLLM workspace has no documents — a credibility
blocker for external testers.

## Problem

During UAT-clean landing QA on 2026-05-24, the Top Insights chat returned a
plausible-sounding but completely fabricated medication list ("Lisinopril 10mg
tablet… Amlodipine 5mg tablet… Atorvastatin 20mg tablet… from your Medication
List document, last updated October 26, 2023") for a user whose At A Glance
screen showed a different, real medication list (Lisinopril 40mg, ASA 81mg,
Furosemide 40mg) — extracted by the Gemini entity extractor from the user's
actual upload.

Diagnosis confirmed via the AnythingLLM SQLite DB at
`gs://healthatlas-dev-vp-anythingllm-storage/anythingllm.db`:

1. **Every real-user workspace has zero documents linked** — no medical upload
   has ever been ingested into AnythingLLM's vector DB for any user. This is
   the intentional PHI-pipeline split (medical upload → OCR → Postgres only;
   AnythingLLM workspaces are separate).
2. **The only document anywhere in AnythingLLM** (`sample_med_doc.pdf`, a 2004
   Pamela Rogers H&P uploaded 2026-05-17 during thin-slice testing) is linked
   ONLY to a dev workspace named `rag-test`, not to any user workspace. Its
   content does not contain "Lisinopril 10mg" or "October 26 2023" — the chat
   output is a pure training-data hallucination.
3. **All workspaces have `chatMode = 'chat'`** (set by the provisioning code
   at `anythingllm-user-provisioning.service.ts:476`). In `chat` mode,
   AnythingLLM lets the LLM answer from its general training when RAG returns
   no context. In `query` mode, AnythingLLM returns the configured
   `queryRefusalResponse` text without calling the LLM at all.

The workspace prompt already includes "Do NOT invent answers" — Gemini is
ignoring that instruction. `query` mode enforces the refusal at the
AnythingLLM layer instead of relying on the LLM to honor the prompt.

This design covers Fix A only: stop the hallucination by switching every
workspace to `query` mode. Wiring real uploads into AnythingLLM ingestion
(Fix B) is a separate design exercise with HIPAA implications and is
deliberately deferred.

## Decisions (from brainstorming)

- **Fix A only.** Stop the hallucination now; chat becomes correctly refusing
  on empty workspaces. Fix B (bridging upload → AnythingLLM) is its own
  workstream — gives time for HIPAA review of PHI embeddings in Zilliz.
- **Direct SQLite UPDATE on the GCS-mounted DB.** AnythingLLM's REST API
  requires a key registered in the `api_keys` table, which is currently empty.
  Generating one requires the admin UI (admin password unknown) and resetting
  the password requires the same SQLite hackery, so direct SQLite is the
  smallest path.
- **Cleanup included.** Delete the dev `rag-test` workspace, its
  `workspace_documents` row, its 9 `document_vectors` rows, the orphan
  `sample_med_doc.pdf-*.json` from `custom-documents/`, and the Zilliz
  collection holding the 9 chunk embeddings (if cleanly identifiable —
  orphan vectors are harmless if we can't drop the collection cleanly).
- **Persistent root-cause fix in source.** Without changing line 476 of
  `anythingllm-user-provisioning.service.ts`, any new workspace created in
  the future (new signup, account reset) regresses to `chat` mode.
- **Cloud Run restart after re-upload.** AnythingLLM mounts the GCS bucket as
  a volume. Prisma holds a connection pool with prepared statements. Restart
  bumps the pool and forces a fresh read of the modified DB.
- **Dormant user workspaces (1, 3, 4, 5, 6, 8, 9) left alone.** No chats, no
  docs, no active users. Harmless once flipped to `query` mode. Cleaner to
  leave them than to surgically delete.

## Architecture

### The three coordinated changes

1. **Persistent fix (source code, deployed):**
   `keystone-core-api/src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts:476`
   `chatMode: 'chat'` → `chatMode: 'query'`. New Cloud Run revision.

2. **One-time backfill (operational, scripted):** Direct
   `UPDATE workspaces SET chatMode='query'` on `anythingllm.db`. Same script
   also removes the dev `rag-test` workspace + its `workspace_documents`
   row + its 9 `document_vectors` rows + its `workspace_users` row + its
   3 `workspace_chats` rows. Re-uploads the file. Restarts AnythingLLM
   Cloud Run via an env-var bump so the mounted file is re-read.

3. **One-time cleanup (operational, GCS + Zilliz):** Delete orphan
   `sample_med_doc.pdf-6575a1c7-08f1-4c6a-a6ac-02fb2f54ecee.json` from
   `gs://healthatlas-dev-vp-anythingllm-storage/documents/custom-documents/`.
   Drop the Zilliz collection holding the 9 chunk embeddings if identifiable
   from the collections list (collection name follows AnythingLLM workspace
   slug pattern — confirm at runtime).

### Why these three together

- Source code alone leaves 9 existing workspaces hallucinating (including
  the active `Workspace for user 7` which is the current test account).
- Backfill alone reverts on the next workspace creation.
- Cleanup is the belt-and-braces step that removes a real patient's H&P
  from the dev environment.

### Before vs after behavior

| Scenario | Before (chatMode=`chat`, 0 docs) | After (chatMode=`query`, 0 docs) |
|---|---|---|
| "What medications am I prescribed?" | Gemini hallucinates Lisinopril 10mg + Amlodipine + Atorvastatin + "Medication List, Oct 26 2023" | Returns `queryRefusalResponse` verbatim: "I haven't seen anything about that in your records yet. If you upload the document or test result, I can help you make sense of it." No LLM call. |
| "How is your knee feeling?" | Already returns the correct refusal (prompt's pronoun fix handles this question type) | Identical refusal text, now driven by mode-level guard instead of prompt-following. Defense in depth. |
| Once docs are in the workspace (post Fix B) | RAG returns chunks → LLM grounds | Identical — `query` only differs from `chat` when RAG returns nothing. |

## Components & exact changes

### 1. Source code change

`keystone-core-api/src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts`,
line 476, inside the `createWorkspaceForUser` method's `createWorkspace` call:

```diff
- chatMode: 'chat',
+ chatMode: 'query',
```

Single line. Surrounding fields (`openAiPrompt`, `queryRefusalResponse`,
`similarityThreshold = 0.68`, `openAiTemp = 0.2`) are already correct.

Before committing, grep for any test that hard-codes the old value:

```bash
grep -rn "chatMode.*['\"]chat['\"]" keystone-core-api/src --include="*.ts"
grep -rn "chatMode.*['\"]chat['\"]" keystone-core-api/test --include="*.ts" 2>/dev/null
```

Any match that asserts `chatMode === 'chat'` flips to `'query'`. If no
matches, no test changes.

### 2. Backfill script

Single bash script, idempotent (re-runnable if any step fails mid-way):

```bash
#!/usr/bin/env bash
set -euo pipefail

BUCKET="gs://healthatlas-dev-vp-anythingllm-storage"
LOCAL_DB="/tmp/anythingllm.db"
BACKUP_DB="/tmp/anythingllm.db.bak-$(date +%Y%m%d-%H%M%S)"

# 1. Download current DB + keep timestamped backup
gsutil cp "$BUCKET/anythingllm.db" "$LOCAL_DB"
cp "$LOCAL_DB" "$BACKUP_DB"
echo "Backup at $BACKUP_DB"

# 2. Apply changes in one transaction
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

# 3. Verify
echo "=== Post-update workspaces ==="
sqlite3 "$LOCAL_DB" "SELECT id, name, chatMode FROM workspaces ORDER BY id;"
echo "=== Post-update document_vectors count ==="
sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM document_vectors;"

# 4. Re-upload
gsutil cp "$LOCAL_DB" "$BUCKET/anythingllm.db"

# 5. Delete orphan doc JSON
gsutil rm "$BUCKET/documents/custom-documents/sample_med_doc.pdf-6575a1c7-08f1-4c6a-a6ac-02fb2f54ecee.json" || true

# 6. Restart Cloud Run via env-var bump
gcloud run services update anythingllm \
  --region=us-central1 \
  --project=healthatlas-dev-vp \
  --update-env-vars "FORCE_RESTART_TS=$(date +%s)"

echo "Done. Restart live in ~30s."
```

Expected post-update state:
- 9 user workspaces remain, all `chatMode = 'query'`.
- `rag-test` workspace deleted.
- `document_vectors` count drops from 9 → 0.
- `custom-documents/` directory empty.

### 3. Zilliz cleanup (separate step, runs after restart verified)

The 9 chunk embeddings for `sample_med_doc.pdf` live in a Zilliz collection
keyed on the rag-test workspace slug. AnythingLLM follows a deterministic
naming convention (workspace slug as collection name) but the exact form
must be confirmed at runtime by listing collections.

```bash
ZILLIZ_TOKEN=$(gcloud secrets versions access latest --secret=ZILLIZ_API_TOKEN \
  --project=healthatlas-dev-vp)
ZILLIZ_URL="https://in03-9af4505647d5486.serverless.gcp-us-west1.cloud.zilliz.com"

# List collections to find the rag-test one
curl -sS -H "Authorization: Bearer $ZILLIZ_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$ZILLIZ_URL/v2/vectordb/collections/list" -d '{}' | python3 -m json.tool

# Drop the rag-test collection (name confirmed from list above)
# curl -X POST "$ZILLIZ_URL/v2/vectordb/collections/drop" \
#   -H "Authorization: Bearer $ZILLIZ_TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"collectionName":"<rag-test-collection-name>"}'
```

If the collection name can't be cleanly identified from the list, the
9 orphan vectors stay in Zilliz. Harmless — they're no longer referenced
by anything in AnythingLLM's SQLite, and Zilliz free-tier storage is
unaffected by 9 unused vectors.

## Error handling

| Failure point | Effect | Recovery |
|---|---|---|
| `sqlite3` UPDATE / DELETE fails inside `BEGIN…COMMIT` | Transaction rolls back; local DB unchanged | Re-run the script. No partial state. |
| `gsutil cp` of modified DB fails | Bucket still holds original DB; `$BACKUP_DB` also local | Re-run the script. |
| `gcloud run services update` fails | Cloud Run keeps serving previous revision (default behavior) | Read deploy logs: `gcloud run revisions logs read`. Most likely cause is corrupted SQLite. Restore from `$BACKUP_DB`, re-upload, retry. |
| New revision crashes on startup | Cloud Run automatically routes traffic to previous healthy revision | Same as above — restore from backup. |
| Test users somehow created new accounts post-deploy with `chat` mode | Possible if Cloud Run is still serving the old Keystone revision | Verify Cloud Run shows the new Keystone revision is receiving traffic; check `gcloud run revisions list` |

Disaster recovery — two commands to revert:
```bash
gsutil cp /tmp/anythingllm.db.bak-<timestamp> gs://healthatlas-dev-vp-anythingllm-storage/anythingllm.db
gcloud run services update anythingllm --region=us-central1 --project=healthatlas-dev-vp \
  --update-env-vars "FORCE_RESTART_TS=$(date +%s)"
```

## Test plan

Manual QA only. Two scenarios in the iOS simulator after deploy + backfill +
restart, plus one source-code sanity check.

### Scenario 1 — Refusal works for empty workspace (the actual fix)

1. Open iOS simulator, sign in as the same account that produced the
   hallucinations (workspace 7 user).
2. On Top Insights, ask: *"What medications am I currently prescribed?"*
3. **Expected:** chat returns exactly: *"I haven't seen anything about that in
   your records yet. If you upload the document or test result, I can help
   you make sense of it."* — verbatim, no improvisation.
4. Try a few more empty-workspace prompts: *"Show me my conditions"*,
   *"What's my blood type?"*, *"List my allergies."*
5. **Expected:** same refusal each time. No invented content, no fake dates,
   no plausible-but-wrong medication lists.

### Scenario 2 — Behavior unchanged for grounded-question-shape prompts

1. Ask: *"How is your knee feeling after your last treatment?"*
2. **Expected:** same refusal as Scenario 1. (Without docs in the workspace,
   `query` mode treats every question the same.) Confirms nothing regressed
   for question shapes the prompt was already handling.

### Sanity check — source-code fix landed correctly

After the Keystone deploy completes, register a brand-new test user (any new
email via the signup flow) and verify the new workspace lands in `query` mode:

```bash
gsutil cp gs://healthatlas-dev-vp-anythingllm-storage/anythingllm.db /tmp/post-fix.db
sqlite3 /tmp/post-fix.db "SELECT id, name, chatMode FROM workspaces ORDER BY id DESC LIMIT 1;"
```

**Expected:** newest workspace row has `chatMode = 'query'`.

### What UAT testers should never see post-fix

- The phrase "October 26, 2023" in any chat response
- Drug names that aren't in the user's actual records (Amlodipine, Metformin,
  Atorvastatin all came from the hallucination — none are in any user's docs)
- "Based on your records, you are currently prescribed..." when the user has
  uploaded nothing or only docs unrelated to the question

If any of these surface, that's a regression — most likely the source code
change didn't deploy, or the backfill script's transaction didn't commit.

## Failure modes

| Symptom | Likely cause | Recovery |
|---|---|---|
| Chat still hallucinates post-restart | Restart didn't pick up new DB — Cloud Run instance still cached. Check that the env-var bump created a new revision. | `gcloud run revisions list --service=anythingllm` — if no new revision since the bump, retry the `services update` command. |
| Chat returns refusal but message text is wrong / blank | A workspace had blank `queryRefusalResponse`. We didn't backfill that field because workspace 10 already had it correct, but the assumption might be wrong for others. | `sqlite3 ... "SELECT id, name, queryRefusalResponse FROM workspaces"` — backfill any blank rows with the standard text from the workspace prompt. |
| New signup post-deploy creates a workspace in `chat` mode | Cloud Run is still serving the old Keystone revision (deploy didn't promote) | `gcloud run revisions list --service=keystone` and check traffic split. Promote the new revision if needed. |
| Zilliz cleanup deletes the wrong collection | Mistook a user workspace's collection name for the rag-test one | Restore from any pre-deletion Zilliz backup (free tier has no automated backups — risk lives at the moment of the drop command). **Mitigation:** confirm the collection's vector count = 9 before dropping; verify it doesn't contain references to user workspace IDs. |

## Rollback

Source code (Keystone repo):
```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git revert <commit-sha>
# rebuild + deploy
```

SQLite + GCS state:
```bash
gsutil cp /tmp/anythingllm.db.bak-<timestamp> \
  gs://healthatlas-dev-vp-anythingllm-storage/anythingllm.db
gcloud run services update anythingllm --region=us-central1 \
  --project=healthatlas-dev-vp \
  --update-env-vars "FORCE_RESTART_TS=$(date +%s)"
```

The orphan `sample_med_doc.pdf-*.json` is unrecoverable once deleted unless
the GCS bucket has versioning enabled (it does not by default in this env).
Acceptable — the file is a public sample doc from a Word document, not
unique data.

## Out of scope (YAGNI)

- **Fix B (medical upload → AnythingLLM ingestion).** Its own design pass.
  HIPAA implications around PHI embeddings in Zilliz. Deferred until after
  the hallucination fix is verified.
- **Deleting dormant user workspaces (1, 3, 4, 5, 6, 8, 9).** No chats,
  no docs, no active users. Once flipped to `query` mode they're harmless.
  Cleaner to leave than to surgically purge.
- **Backfilling `queryRefusalResponse` on all workspaces.** Verified set on
  workspace 10 during diagnosis; assumed correct elsewhere since they came
  through the same provisioning code path. If any are blank post-deploy,
  surface as a follow-up — not gating the hallucination fix.
- **Provisioning a working AnythingLLM API key.** Not needed for Approach 1.
  Future work if we want admin-API-driven workspace operations.
- **Generating an Atlas admin password reset.** Same reason — not needed.
- **Rebuilding TestFlight.** Same as the UAT-clean landing fix — picks up at
  next IPA build automatically.
- **Anything in HealthAtlas (iOS app) code.** Backend-only change. iOS just
  consumes the new refusal text via the existing chat endpoint.
