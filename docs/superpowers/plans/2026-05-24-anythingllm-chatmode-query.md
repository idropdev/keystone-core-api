# AnythingLLM chatMode → query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop AnythingLLM chat from hallucinating medical content by flipping all workspaces from `chatMode='chat'` to `'query'`, fixing the persistent root cause in the provisioning code, and cleaning up the dev `rag-test` artifacts.

**Architecture:** Three coordinated changes — (1) source-code one-liner in Keystone's workspace-provisioning service so future workspaces are born in `query` mode; (2) one-time bash script doing a transactional SQLite backfill on the GCS-mounted AnythingLLM DB + GCS file cleanup + Cloud Run restart; (3) Zilliz collection cleanup for the 9 orphan chunk embeddings. Test plan is manual QA only — no new automated tests.

**Tech Stack:** NestJS / TypeScript (Keystone), Jest, bash + sqlite3 + gsutil + gcloud, Zilliz REST API.

**Spec:** [docs/superpowers/specs/2026-05-24-anythingllm-chatmode-query-design.md](../specs/2026-05-24-anythingllm-chatmode-query-design.md)

**Repo state:** Working dir `/Users/vigneshponraj/Documents/github/dropdev/keystone-core-api`, branch `vignesh-changes`, spec committed at `641d64b`. All 198 Jest tests pass.

**Commit-message rule:** Never reference Claude, Anthropic, or `.claude` in any commit message or PR body. (Per project-wide convention.)

---

## File map

| File | Action | Purpose |
|---|---|---|
| `src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts:476` | Modify (1 line) | Source-code default for new workspaces |
| `test/anythingllm/workspace-provisioning.unit.spec.ts:134` | Modify (1 line) | Parity with source; assertion against `createWorkspace` call args |
| `test/anythingllm/document-upload.e2e-spec.ts:358` | Modify (1 line) | Parity with source; e2e workspace payload |
| `scripts/backfill-anythingllm-chatmode.sh` | Create | One-time idempotent backfill + cleanup + restart |
| `PHASE2A_NOTES.md` (workspace root, NOT in any repo) | Modify | Mark Known Issue #12 FIXED, add new revision log line |
| `~/.claude/projects/.../memory/project_personal_dev_roadmap.md` | Modify | Phase I item update |

**Pre-existing drift NOT addressed by this plan:** The two test files referenced above also contain stale assertions about the old workspace prompt (`'citation-first assistant'`) and old refusal text (`"don't have enough grounded context"`) from before the 2026-05-18 Atlas-prompt fix. These assertions are independent of the chatMode change and were already broken before this work started. They live in `test/` outside Jest's `rootDir: "src"`, so they only execute via `npm run test:e2e` (which is not in any pre-commit gate). Flag this as a separate follow-up; do not fix here.

---

## Task 1: Flip provisioning source code default

**Files:**
- Modify: `src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts:476`
- Modify: `test/anythingllm/workspace-provisioning.unit.spec.ts:134`
- Modify: `test/anythingllm/document-upload.e2e-spec.ts:358`

- [ ] **Step 1: Confirm exactly three files reference the old value**

Run:
```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
grep -rn "chatMode:[[:space:]]*['\"]chat['\"]" src test 2>/dev/null | grep -v node_modules
```

Expected output (exactly three lines, in this order):
```
src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts:476:          chatMode: 'chat',
test/anythingllm/document-upload.e2e-spec.ts:358:              chatMode: 'chat',
test/anythingllm/workspace-provisioning.unit.spec.ts:134:          chatMode: 'chat',
```

If a fourth file appears, stop and report — the spec assumed only these three sites. If fewer than three, the code has already drifted from when the plan was written.

- [ ] **Step 2: Flip the source code default**

Open `src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts`. At line 476, inside the `createWorkspace` call within `createWorkspaceForUser`, change:

```typescript
chatMode: 'chat',
```

to:

```typescript
chatMode: 'query',
```

No other lines in that file change. The `openAiPrompt`, `queryRefusalResponse`, `similarityThreshold: 0.68`, and `openAiTemp: 0.2` fields are already correct.

- [ ] **Step 3: Flip the matching unit test assertion**

Open `test/anythingllm/workspace-provisioning.unit.spec.ts`. At line 134, inside the `expect.objectContaining` block, change:

```typescript
chatMode: 'chat',
```

to:

```typescript
chatMode: 'query',
```

Leave the other assertions in that block untouched (`openAiPrompt: expect.stringContaining('citation-first assistant')` and `queryRefusalResponse: expect.stringContaining("don't have enough grounded context")` are stale-but-pre-existing drift, out of scope here).

- [ ] **Step 4: Flip the matching e2e test payload**

Open `test/anythingllm/document-upload.e2e-spec.ts`. At line 358, inside the `.send({...})` workspace-creation payload, change:

```typescript
chatMode: 'chat',
```

to:

```typescript
chatMode: 'query',
```

- [ ] **Step 5: Verify the change site count**

Run the same grep again:
```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
grep -rn "chatMode:[[:space:]]*['\"]chat['\"]" src test 2>/dev/null | grep -v node_modules
```

Expected: no output (zero matches).

Also confirm the new value is in place:
```bash
grep -rn "chatMode:[[:space:]]*['\"]query['\"]" src test 2>/dev/null | grep -v node_modules
```

Expected: three lines, one per file modified above.

- [ ] **Step 6: Run the Jest test suite**

Run:
```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
npm test
```

Expected: `Tests: 198 passed, 198 total` (or the current count if it's drifted). No failures. The pre-commit hook will run this again on commit — both runs should match.

If a test fails because of a `chatMode` assertion outside the two files we changed, stop and report — that means there's a fourth assertion site we missed.

- [ ] **Step 7: Commit**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git add src/anythingllm/provisioning/anythingllm-user-provisioning.service.ts \
        test/anythingllm/workspace-provisioning.unit.spec.ts \
        test/anythingllm/document-upload.e2e-spec.ts
git commit -m "fix(anythingllm): provision workspaces in query mode to stop hallucinations"
```

Expected: pre-commit hook runs linting + Jest, both pass. One commit on `vignesh-changes`, 3 files changed, 3 insertions(+), 3 deletions(-).

---

## Task 2: Write the one-time backfill script

**Files:**
- Create: `scripts/backfill-anythingllm-chatmode.sh`

- [ ] **Step 1: Create the script file**

Create `scripts/backfill-anythingllm-chatmode.sh` with this exact content:

```bash
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
```

- [ ] **Step 2: Make the script executable**

Run:
```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
chmod +x scripts/backfill-anythingllm-chatmode.sh
```

- [ ] **Step 3: Lint the script (syntax check, do NOT execute)**

Run:
```bash
bash -n scripts/backfill-anythingllm-chatmode.sh
```

Expected: no output, exit code 0. This parses the script without running it — catches syntax errors before we touch the live system.

- [ ] **Step 4: Commit the script**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git add scripts/backfill-anythingllm-chatmode.sh
git commit -m "chore(scripts): one-time AnythingLLM chatMode backfill + rag-test cleanup"
```

Expected: pre-commit hook passes (the script isn't TypeScript so it's not linted/tested by the hook anyway). One commit, 1 file added.

---

## Task 3 (USER): Pre-flight check

Claude cannot run the deploy or the backfill script — both touch the live GCP environment. Tasks 3-7 are operator steps.

- [ ] **Step 1: Confirm branch state is clean**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git status
git log --oneline -5
```

Expected: branch `vignesh-changes`, working tree clean, last 2 commits are the source-code fix and the backfill script from Tasks 1-2 above. The spec commit `641d64b` should be the third-most-recent.

- [ ] **Step 2: Confirm the active Keystone Cloud Run revision before deploy**

```bash
gcloud run services describe keystone --region=us-central1 \
  --project=healthatlas-dev-vp --format="value(status.latestReadyRevisionName)"
```

Note this revision name — you'll compare against it after deploy to confirm the new revision rolled out. (Per [PHASE2A_NOTES.md](../../../PHASE2A_NOTES.md), the current revision should be `keystone-00009-dkq` from the Apple Sign-In audience fix.)

- [ ] **Step 3: Confirm `gcloud` and `gsutil` are authenticated**

```bash
gcloud config list account --format="value(core.account)"
gcloud config list project --format="value(core.project)"
```

Expected: account `healthatlas915@gmail.com`, project `healthatlas-dev-vp`. If different, run `gcloud auth login` and `gcloud config set project healthatlas-dev-vp`.

---

## Task 4 (USER): Deploy Keystone with the source-code fix

- [ ] **Step 1: Submit a Cloud Build for the new image**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
gcloud builds submit --config=cloudbuild.yaml --project=healthatlas-dev-vp
```

Expected: build completes in ~3-5 minutes, exits 0. The build pushes a new image tagged `:latest` to Artifact Registry at `us-central1-docker.pkg.dev/healthatlas-dev-vp/keystone/keystone`.

If the build fails, read the Cloud Build log link printed at the start of the output and fix before continuing. The Jest pre-commit hook in Task 1 should have caught most TS errors locally, so a build failure here is most likely a `pubspec.lock`-equivalent issue or a Cloud Build config drift — not the source change itself.

- [ ] **Step 2: Roll the Cloud Run service to the new image**

```bash
gcloud run services update keystone \
  --image=us-central1-docker.pkg.dev/healthatlas-dev-vp/keystone/keystone:latest \
  --region=us-central1 \
  --project=healthatlas-dev-vp
```

Expected: a new revision `keystone-NNNNN-xxx` is created (probably `keystone-00010-...`). The command exits with `Done.` and prints the new revision name.

- [ ] **Step 3: Verify the new revision is serving traffic**

```bash
gcloud run services describe keystone --region=us-central1 \
  --project=healthatlas-dev-vp --format="value(status.latestReadyRevisionName)"
```

Expected: a different revision name than the one captured in Task 3 Step 2.

Then check it's actually receiving traffic:
```bash
gcloud run services describe keystone --region=us-central1 \
  --project=healthatlas-dev-vp --format="value(status.traffic)"
```

Expected: 100% traffic on the new revision.

- [ ] **Step 4: Spot-check Keystone is healthy**

```bash
curl -sS https://keystone-634361481663.us-central1.run.app/api/v1/health 2>&1 | head -5
```

Expected: a 200 OK with a JSON health payload. If 5xx, read Cloud Run logs:
```bash
gcloud run services logs read keystone --region=us-central1 \
  --project=healthatlas-dev-vp --limit=50
```

---

## Task 5 (USER): Run the backfill script

- [ ] **Step 1: Confirm the SQLite DB pre-state matches expectations**

(Optional but recommended — sanity-checks before mutation.)

```bash
gsutil cp gs://healthatlas-dev-vp-anythingllm-storage/anythingllm.db /tmp/pre-backfill.db
sqlite3 /tmp/pre-backfill.db "SELECT id, name, chatMode FROM workspaces ORDER BY id;"
```

Expected: 10 workspaces, all with `chatMode = chat`. (Workspace 2 is `rag-test`; 1, 3-10 are `Workspace for user N`.)

```bash
sqlite3 /tmp/pre-backfill.db "SELECT COUNT(*) FROM document_vectors;"
```

Expected: `9` (the chunks from `sample_med_doc.pdf`).

```bash
gsutil ls gs://healthatlas-dev-vp-anythingllm-storage/documents/custom-documents/
```

Expected: a single file ending in `sample_med_doc.pdf-6575a1c7-08f1-4c6a-a6ac-02fb2f54ecee.json`.

- [ ] **Step 2: Execute the backfill script**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
./scripts/backfill-anythingllm-chatmode.sh
```

Expected console output (compressed):
```
==> Downloading current SQLite DB
    Backup saved at /tmp/anythingllm.db.bak-20260524-NNNNNN
==> Pre-state read
1|Workspace for user 8|chat
2|rag-test|chat
3|Workspace for user 9|chat
4|Workspace for user 4|chat
5|Workspace for user 5|chat
6|Workspace for user 6|chat
7|Workspace for user 7|chat
8|Workspace for user 8|chat
9|Workspace for user 9|chat
10|Workspace for user 10|chat

9
==> Applying transactional changes
==> Post-state verification
1|Workspace for user 8|query
3|Workspace for user 9|query
4|Workspace for user 4|query
5|Workspace for user 5|query
6|Workspace for user 6|query
7|Workspace for user 7|query
8|Workspace for user 8|query
9|Workspace for user 9|query
10|Workspace for user 10|query

0
==> Re-uploading modified DB
==> Deleting orphan sample_med_doc.pdf JSON
==> Restarting AnythingLLM Cloud Run (env-var bump)

Done. New AnythingLLM revision is live in ~30 seconds.
Backup retained at: /tmp/anythingllm.db.bak-20260524-NNNNNN
```

Key expectations to verify:
- 9 workspaces remain (workspace id=2 is gone).
- Every remaining workspace shows `chatMode = query`.
- `document_vectors` count drops from 9 to 0.
- `gcloud run services update anythingllm` exits 0.

If anything looks wrong mid-script, the local `$BACKUP_DB` and the bucket's original DB are both intact until the re-upload step — see the rollback block at the bottom of the script.

- [ ] **Step 3: Wait for the AnythingLLM new revision to be live**

```bash
sleep 30
gcloud run services describe anythingllm --region=us-central1 \
  --project=healthatlas-dev-vp --format="value(status.latestReadyRevisionName,status.traffic)"
```

Expected: the latest revision is new (different from before the env-var bump) and serving 100% traffic.

- [ ] **Step 4: Confirm the modified DB is what's mounted**

```bash
gsutil cp gs://healthatlas-dev-vp-anythingllm-storage/anythingllm.db /tmp/post-backfill.db
sqlite3 /tmp/post-backfill.db "SELECT id, name, chatMode FROM workspaces ORDER BY id;"
```

Expected: exactly 9 rows, no row with id=2, every `chatMode = query`. Matches the in-script post-state read.

---

## Task 6 (USER): Zilliz collection cleanup

- [ ] **Step 1: List Zilliz collections**

```bash
ZILLIZ_TOKEN=$(gcloud secrets versions access latest --secret=ZILLIZ_API_TOKEN \
  --project=healthatlas-dev-vp)
ZILLIZ_URL="https://in03-9af4505647d5486.serverless.gcp-us-west1.cloud.zilliz.com"

curl -sS -H "Authorization: Bearer $ZILLIZ_TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "$ZILLIZ_URL/v2/vectordb/collections/list" \
     -d '{}' | python3 -m json.tool
```

Expected: a JSON list of collection names. AnythingLLM uses the workspace slug as the collection name. Look for a collection whose name corresponds to `rag-test` (literally `rag_test` or `rag-test` or similar — Zilliz collection names may have dashes converted to underscores).

- [ ] **Step 2: Inspect the candidate collection to confirm it has 9 vectors**

(Replace `<collection-name>` with the name from Step 1.)

```bash
curl -sS -H "Authorization: Bearer $ZILLIZ_TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "$ZILLIZ_URL/v2/vectordb/collections/describe" \
     -d '{"collectionName":"<collection-name>"}' | python3 -m json.tool
```

Then count the rows:
```bash
curl -sS -H "Authorization: Bearer $ZILLIZ_TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "$ZILLIZ_URL/v2/vectordb/entities/query" \
     -d '{"collectionName":"<collection-name>","filter":"","outputFields":["id"],"limit":100}' \
     | python3 -m json.tool | head -40
```

Expected: 9 entities. **STOP** if the count is different — that means the collection isn't the rag-test one and we'd be dropping live user data.

- [ ] **Step 3: Drop the collection**

```bash
curl -sS -H "Authorization: Bearer $ZILLIZ_TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "$ZILLIZ_URL/v2/vectordb/collections/drop" \
     -d '{"collectionName":"<collection-name>"}'
```

Expected response: `{"code":0,"data":{}}` (or similar success body).

- [ ] **Step 4: Confirm the collection is gone**

```bash
curl -sS -H "Authorization: Bearer $ZILLIZ_TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "$ZILLIZ_URL/v2/vectordb/collections/list" \
     -d '{}' | python3 -m json.tool
```

Expected: the rag-test collection is no longer in the list.

**If the collection name cannot be identified cleanly in Step 1**, skip Steps 2-4 entirely. The 9 orphan vectors stay in Zilliz — harmless, not referenced by anything, free-tier storage unaffected. Move on to Task 7.

---

## Task 7 (USER): Manual QA in iOS simulator

Per spec test plan. Two scenarios + one sanity check.

- [ ] **Step 1: Scenario 1 — Refusal works for empty workspace**

In the iOS simulator (HealthAtlas app, signed in as the same account that produced the hallucinations — the one mapped to AnythingLLM workspace 7), on the **Top Insights** tab, ask:

> What medications am I currently prescribed?

**Expected:** the chat returns exactly this refusal, verbatim:
> I haven't seen anything about that in your records yet. If you upload the document or test result, I can help you make sense of it.

No invented drug names. No "October 26, 2023". No "Based on your records, you are currently prescribed…". Repeat with a few other prompts:

- "Show me my conditions"
- "What's my blood type?"
- "List my allergies"

Each should return the same refusal. **Pass criteria:** every response is the refusal text, character-for-character.

- [ ] **Step 2: Scenario 2 — Behavior unchanged for grounded-shape prompts**

Ask:
> How is your knee feeling after your last treatment?

**Expected:** same refusal as Scenario 1. (Without docs in the workspace, `query` mode treats every question the same — there's nothing to retrieve from.) This confirms the pronoun-fix prompt behavior still applies and we didn't regress anything.

- [ ] **Step 3: Source-code sanity check — new signup gets `chatMode = query`**

Register a fresh test user via the iOS sign-up flow (any new email address — pick something like `healthatlas915+chatmode-test-<date>@gmail.com`). Complete signup so a new AnythingLLM workspace gets provisioned for them.

Then download the DB and verify:
```bash
gsutil cp gs://healthatlas-dev-vp-anythingllm-storage/anythingllm.db /tmp/post-signup.db
sqlite3 /tmp/post-signup.db "SELECT id, name, chatMode FROM workspaces ORDER BY id DESC LIMIT 1;"
```

**Expected:** newest workspace row has `chatMode = query`. Confirms the source-code fix landed and is in effect for new provisioning.

- [ ] **Step 4: Document any failures**

If any of the three checks above fail, do NOT proceed to Task 8. Use the rollback path in the script's footer (or `git revert` for the source-code commit) and report what went wrong.

---

## Task 8: Close out

- [ ] **Step 1 (Claude): Update [PHASE2A_NOTES.md](../../../PHASE2A_NOTES.md) to mark Known Issue #12 FIXED**

Edit `/Users/vigneshponraj/Documents/github/dropdev/PHASE2A_NOTES.md`. In the `### 12. Top Insights chat returns different data than At A Glance` section, change the heading to:

```markdown
### 12. Top Insights chat hallucination — FIXED 2026-05-24 (keystone-NNNNN-xxx + anythingllm-NNNNN-xxx)
```

(Insert the actual revision names from Tasks 4 and 5.)

Append a "**Fix shipped:**" block summarizing:
- Source code: `chatMode: 'chat'` → `'query'` at `anythingllm-user-provisioning.service.ts:476` + matching test files updated
- Backfill: 9 user workspaces flipped to `query` mode via direct SQLite UPDATE; `rag-test` workspace + its 9 document_vectors rows + workspace_users + workspace_chats + workspaces row all deleted; orphan `sample_med_doc.pdf-*.json` removed from `custom-documents/`; Zilliz `rag-test` collection dropped (or note "skipped — collection name not cleanly identifiable" if Step 4 of Task 6 was skipped)
- Cloud Run revisions: keystone-NNNNN-xxx (new image) + anythingllm-NNNNN-xxx (env-var bump restart)

Then in the **Phase I checklist** at line ~660-680, change item #10 from the open-issue description to:
```markdown
10. ✅ **Top Insights chat hallucination — FIXED 2026-05-24.** Stopped Gemini
    from inventing medical content for empty workspaces by switching
    `chatMode` from `chat` to `query` (provisioning code + one-time SQLite
    backfill of 9 existing user workspaces). AnythingLLM now serves the
    configured refusal text without calling the LLM when RAG returns nothing.
    Dev rag-test workspace + orphan sample_med_doc.pdf cleaned up. See
    Known Issue #12 for the full diagnosis + fix breakdown.
```

- [ ] **Step 2 (Claude): Update personal dev roadmap memory**

Edit `/Users/vigneshponraj/.claude/projects/-Users-vigneshponraj-Documents-github-dropdev/memory/project_personal_dev_roadmap.md`. Change the bullet:

```markdown
- Top Insights chat vs At A Glance data mismatch (Phase I #10, new 2026-05-24, see PHASE2A_NOTES Known Issue #12) — chat returns different meds + cites a 2023 doc; At A Glance shows the real Gemini entities. Hypothesis: AnythingLLM workspace seed-doc contamination. Diagnose before external beta.
```

to:

```markdown
- ✅ Top Insights chat hallucination (Phase I #10) — FIXED 2026-05-24. Root cause: every user workspace had zero documents AND chatMode='chat', so Gemini invented plausible content from training data. Fix: provisioning code flipped to chatMode='query' (refuses without LLM call when RAG is empty) + one-time SQLite backfill on all 9 existing workspaces + dev rag-test workspace cleanup. Full diagnosis + commits in PHASE2A_NOTES Known Issue #12.
```

- [ ] **Step 3 (Claude): Commit the close-out docs change**

Note: `PHASE2A_NOTES.md` is at the workspace root and is NOT in any git repo (it's the personal working doc). Only the keystone-core-api side has trackable commits. So this step commits nothing — just save the file edits via the Edit tool. Memory file is also not in any repo.

Verify nothing is staged that shouldn't be:
```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git status
```

Expected: working tree clean, branch `vignesh-changes` ahead of origin by 3 commits (spec + source-code + backfill-script).

- [ ] **Step 4 (Claude): Push `vignesh-changes` to origin as backup**

```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git push origin vignesh-changes
```

Expected: 3 commits pushed (`641d64b` spec + Task 1 commit + Task 2 commit). If a push protection alert fires on a leaked secret, stop and inspect the offending diff. (The spec mentions a leaked secret historically, but the commits we're pushing here shouldn't touch `env-example-relational`.)

- [ ] **Step 5 (USER): Final sanity readback**

After everything is committed and pushed:
```bash
cd /Users/vigneshponraj/Documents/github/dropdev/keystone-core-api
git log --oneline -5
```

Expected (newest first): Task 2 backfill-script commit → Task 1 source-fix commit → `641d64b` spec → existing branch history. Three new commits on top of the spec.

Open `PHASE2A_NOTES.md` and confirm Known Issue #12 reads as ✅ FIXED with the right revision numbers, and Phase I item #10 shows ✅.

Open the iOS app one more time, ask "What medications am I currently prescribed?" — confirm the refusal text is what comes back. **This is the user-facing acceptance test.** If it still hallucinates, something didn't land — most likely the Cloud Run restart in Task 5 didn't take effect.

---

## Self-review

Ran the writing-plans self-review checklist:

**1. Spec coverage:**
- Source code change (spec §Components 1) → Task 1.
- Backfill script (spec §Components 2) → Task 2 (write) + Task 5 (run).
- Zilliz cleanup (spec §Components 3) → Task 6.
- Test plan Scenario 1 + 2 + sanity check (spec §Test plan) → Task 7.
- Rollback (spec §Rollback) → script footer prints the recovery commands; Task 5/7 reference them.
- Error handling (spec §Failure modes) → script's `set -euo pipefail`, transactional SQLite, Cloud Run's default-keep-previous-revision behavior, separate Zilliz-skip path.
- Out of scope (spec §Out of scope) → no tasks for Fix B, dormant workspaces, admin password reset, TestFlight rebuild — all explicitly absent. ✅

**2. Placeholder scan:** No "TBD", "TODO", or hand-wavy steps. Every code/command step has the actual code or command. The `<collection-name>` placeholder in Task 6 is genuinely runtime-determined and the surrounding steps explain how to find it. ✅

**3. Type/name consistency:** `chatMode: 'query'` appears identically in source change, both test changes, and the SQL UPDATE. The script's bucket path matches the spec's bucket path. The orphan file name (`sample_med_doc.pdf-6575a1c7-08f1-4c6a-a6ac-02fb2f54ecee.json`) appears identically in the spec, the script, and the GCS verification step. ✅

No issues found, no rework needed.
