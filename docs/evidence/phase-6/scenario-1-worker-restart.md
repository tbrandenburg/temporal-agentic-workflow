# Phase 6 — scenario 1: worker restart mid-run

Kill -9 the `agent-default` worker while `runAgent` (coder) is in flight,
restart it, and show the workflow completes by **continuing** from
persisted history rather than restarting from zero (PLAN §9 Phase 6 /
definition-of-done criterion 2, §12).

## Setup

Same stack as [happy path](./happy-path.md), worker started with two
Phase-6-only test hooks (`evidence-fault-injection.ts`):

```bash
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  EVIDENCE_CODER_EDIT=safe EVIDENCE_DELAY_MS=20000 EVIDENCE_DELAY_ROLE=coder \
  node packages/worker/dist/main.js
```

`EVIDENCE_DELAY_MS`/`EVIDENCE_DELAY_ROLE` make the coder's `runAgent`
activity sleep 20s before returning — mock mode otherwise resolves
instantly, giving no window to `kill -9` mid-activity.

## Commands and timeline

```bash
curl -s -X POST http://localhost:3301/runs -H 'content-type: application/json' -d '{
  "repository": "local/fixture", "task_class": "feature",
  "instruction": "Phase 6 scenario 1 worker restart mid-run v2"
}'
# => run_id 01M248K5524ET4CQJ61V344VG8

# poll GET /runs/:id until run_status == "coding" (coder activity started)
date -u +%H:%M:%S.%3N   # 23:38:47.195
kill -9 <worker-pid>    # 23:38:47.205 — worker killed while coder is sleeping
ps aux | grep main.js   # confirms no agent-default worker running

# restart, same env
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  EVIDENCE_CODER_EDIT=safe EVIDENCE_DELAY_MS=20000 EVIDENCE_DELAY_ROLE=coder \
  node packages/worker/dist/main.js &
# restarted and RUNNING by 23:39:00

curl -s http://localhost:3301/runs/01M248K5524ET4CQJ61V344VG8   # polled to completion
```

## Result

`GET /runs/:id` → `workflow_status: "COMPLETED"`, `run_status: "succeeded"`.
Full response: [`scenario-1-run-summary.json`](./scenario-1-run-summary.json).

## History proves continuation, not restart-from-zero

[`scenario-1-history.json`](./scenario-1-history.json), 47 events.

- Events 1–15 (`WorkflowExecutionStarted` → `initializeRun` →
  `runAgent`(planner) `ActivityTaskCompleted`) all carry
  `Identity: "1908895@tom-nuc7"` — the **original, killed** worker
  process. These events are untouched in the exported history: the
  planner's result was never re-executed.
- Event 20 (`ActivityTaskScheduled`, coder `runAgent`) was in flight when
  the worker died.
- Event 21 (`ActivityTaskStarted`) shows:
  ```json
  {
    "attempt": 2,
    "identity": "1910460@tom-nuc7",
    "lastFailure": {
      "message": "activity Heartbeat timeout",
      "failureInfo": { "timeoutFailureInfo": { "timeoutType": "Heartbeat" } }
    }
  }
  ```
  `1910460` is the **restarted** worker's PID — the coder activity's
  *second* attempt, redelivered after the original worker stopped
  heartbeating (`heartbeatTimeout: 30s` in `activity-options.ts`), not a
  fresh workflow execution. Everything from event 22 onward
  (`validatePatch`, reviewer, `publishRunSummary`,
  `WorkflowExecutionCompleted`) is served by the new worker process.
- Total history length: 47 events for a 6-activity workflow — normal size,
  no duplication of the planner/initializeRun work.

## Bug found and fixed along the way

The first attempt at this scenario failed the retried coder activity with
`git commit --quiet -m baseline` → `nothing to commit, working tree
clean`, because `run-agent.ts` hardcoded `attempt: 1` for the coder's
`createWorkspace(...)` call regardless of the real Temporal retry count,
so the retry reused the still-populated `ws-1` directory from the killed
attempt instead of getting its own `ws-2`. Fixed by reading
`Context.current().info.attempt` from `@temporalio/activity` — see the
happy-path doc's "Bugs found" section for the full comment and the diff.
