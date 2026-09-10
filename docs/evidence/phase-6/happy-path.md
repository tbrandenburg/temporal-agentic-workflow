# Phase 6 — happy path (baseline, for completeness)

One clean end-to-end run, `AGENT_MODE=mock`, no fault injection, so the
five failure scenarios below have a known-good baseline to diff against.

## Setup

```bash
docker compose -f infra/temporal/docker-compose.yaml up -d
./infra/temporal/register-search-attributes.sh
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  EVIDENCE_CODER_EDIT=safe node packages/worker/dist/main.js &
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  node packages/worker/dist/validation-worker.js &
PORT=3301 node apps/run-api/dist/server.js &
```

`EVIDENCE_CODER_EDIT=safe` is a Phase-6-only, opt-in test hook (see
`packages/worker/src/activities/evidence-fault-injection.ts`) that makes
the coder role's mock output actually edit the seeded workspace
(`fixtures/sample-repo/src/greet.js`, keeping the test-asserted string
intact) so `git diff` produces a genuine patch artifact — mock mode's
opencode stand-in otherwise never touches the filesystem, so there would
be nothing for `validatePatch` to act on at all.

## Command

```bash
curl -s -X POST http://localhost:3301/runs -H 'content-type: application/json' -d '{
  "repository": "local/fixture",
  "task_class": "feature",
  "instruction": "Phase 6 happy-path evidence run v3"
}'
# => {"run_id":"01M248AV3EHD7APT6B5N7QKRJB","workflow_id":"agent-run/01M248AV3EHD7APT6B5N7QKRJB","run_status":"initializing"}

curl -s http://localhost:3301/runs/01M248AV3EHD7APT6B5N7QKRJB
```

## Result

`GET /runs/:id` → `workflow_status: "COMPLETED"`, `run_status: "succeeded"`.
Full response: [`happy-path-run-summary.json`](./happy-path-run-summary.json).

- `plan`/`code`/`review` all `status: "success"`.
- `validation.status: "passed"`, all 6 steps (`allowlist`, `apply`,
  `format`, `lint`, `test`, `secret-scan`) `passed`.
- `artifact_manifest` lists 4 presigned MinIO URLs (patch + 3 validation
  logs) — criterion 4 of the definition of done (§12).

## History

[`happy-path-history.json`](./happy-path-history.json) — 47 compact
events: `initializeRun` → `runAgent`(planner) → `runAgent`(coder) →
`validatePatch` → `runAgent`(reviewer) → `publishRunSummary` →
`WorkflowExecutionCompleted`, each activity a single successful attempt.

## Bugs found and fixed to get this far

Both were genuine, previously-undiscovered defects — no live `POST /runs`
had ever been exercised against a real Temporal server before this task
(`make e2e` was still a stub; see Makefile). Both are one-line-cause, one
targeted fix; see the diff for full comments.

1. **`RunId` search-attribute name collision.** PLAN §4.2 named the
   business search attribute `RunId`, but Temporal reserves that exact
   name for the *system* attribute holding the real workflow Run ID.
   `client.workflow.start(...)` failed every single time with
   `INVALID_ARGUMENT: RunId attribute can't be set in SearchAttributes`.
   The registration script's "already registered" check passed (it *is*
   registered — as a system, not custom, attribute), which is why this
   was invisible until a live start was attempted. Fixed by renaming to
   `TaskRunId` in `packages/agent-contracts/src/search-attributes.ts` and
   `apps/run-api/scripts/register-search-attributes.js`.
2. **Coder retries reused a half-committed workspace.** `run-agent.ts`
   hardcoded `attempt: 1` for `createWorkspace(...)`, instead of the real
   Temporal activity attempt number. `createWorkspace`'s own docstring
   says a retry must get a fresh `ws-<attempt>` directory "so a retry
   never inherits a half-applied patch from a crashed attempt" (PLAN
   §5.3) — the hardcoded `1` defeated that on every real retry, so a
   second attempt's `git commit` failed with "nothing to commit" against
   the still-initialized directory from attempt 1. Reproduced live in
   scenario 1 below; fixed by reading `Context.current().info.attempt`.
