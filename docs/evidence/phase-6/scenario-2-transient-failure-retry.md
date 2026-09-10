# Phase 6 — scenario 2: model failure and retry

Force the planner role's `runAgent` activity to fail transiently, then
succeed, and show both the retry attempts and the eventual success in the
exported workflow history (PLAN §9 Phase 6).

## Setup

```bash
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  EVIDENCE_TRANSIENT_FAILS=2 EVIDENCE_TRANSIENT_ROLE=planner \
  EVIDENCE_CODER_EDIT=safe \
  node packages/worker/dist/main.js
```

`EVIDENCE_TRANSIENT_FAILS=2` (`evidence-fault-injection.ts`) throws a
plain `Error` — retryable by `activity-options.ts`'s default
classification (no match in `nonRetryableErrorTypes`) — for the planner
role's first 2 attempts, then lets the 3rd through. `runAgent`'s retry
policy allows up to 3 attempts, so this exercises retry-then-succeed
without exhausting the policy.

## Command

```bash
curl -s -X POST http://localhost:3301/runs -H 'content-type: application/json' -d '{
  "repository": "local/fixture", "task_class": "feature",
  "instruction": "Phase 6 scenario 2 transient failure and retry v2"
}'
# => run_id 01M248REVHXH685FYT9CKW2RKA
```

## Result

`GET /runs/:id` → `workflow_status: "COMPLETED"`, `run_status: "succeeded"`.
Full response: [`scenario-2-run-summary.json`](./scenario-2-run-summary.json).

## History shows the retries and the eventual success

[`scenario-2-history.json`](./scenario-2-history.json). The planner's
`runAgent` activity (event 13 `ActivityTaskScheduled`) resolves in a
single compact `ActivityTaskStarted`/`ActivityTaskCompleted` pair (events
14/15) — Temporal folds failed-and-retried attempts of the *same*
activity into one `ActivityTaskStarted` event carrying the final attempt
number and the immediately-preceding failure:

```json
{
  "eventId": "14",
  "eventType": "ActivityTaskStarted",
  "activityTaskStartedEventAttributes": {
    "attempt": 3,
    "lastFailure": {
      "message": "[evidence] simulated transient failure, attempt 2/2",
      "stackTrace": "Error: [evidence] simulated transient failure, attempt 2/2\n    at maybeThrowTransient (.../evidence-fault-injection.js:45:15)\n    at runAgent (.../run-agent.js:85:60)\n..."
    }
  }
}
```

`attempt: 3` with a `lastFailure` from "attempt 2/2" proves both prior
attempts (1 and 2) failed and were retried server-side before this,
the third, succeeded — confirmed by the immediately following event 15
`ActivityTaskCompleted` with a real `AgentResult` payload. Worker log
(`worker-s2b.log`) independently shows both `[WARN] Activity failed`
entries for attempts 1 and 2 with the matching messages, ~5s and ~10s
apart (the `initialInterval: 5s, backoffCoefficient: 2` retry policy from
`activity-options.ts`).

The rest of the workflow (coder → validate → reviewer → publish) then
proceeds normally to `WorkflowExecutionCompleted`.
