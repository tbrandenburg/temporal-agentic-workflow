# Phase 6 — scenario 3: invalid agent JSON

Force the planner role's mock output to fail `AgentResult` schema
validation, and show a **non-retryable** failure with exactly one attempt
— proving the retry classification in `activity-options.ts` actually
works (PLAN §5.2 / §9 Phase 6).

## Setup

```bash
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  EVIDENCE_INVALID_JSON=1 EVIDENCE_INVALID_JSON_ROLE=planner \
  node packages/worker/dist/main.js
```

`EVIDENCE_INVALID_JSON=1` (`evidence-fault-injection.ts`) repeats the
planner's mock summary text 200× before it reaches
`normalizeAgentResult`, busting `AgentResult.summary`'s real 2048-char cap
(`agent-contracts/src/agent-result.ts`) so the *real* validation path
throws `InvalidAgentOutputError` — not a hand-rolled stand-in for it.
`InvalidAgentOutputError` is declared in `runAgent`'s
`nonRetryableErrorTypes` (`activity-options.ts`).

## Command

```bash
curl -s -X POST http://localhost:3301/runs -H 'content-type: application/json' -d '{
  "repository": "local/fixture", "task_class": "feature",
  "instruction": "Phase 6 scenario 3 invalid agent JSON"
}'
# => run_id 01M248TN7ZK2ERK2QMERZSEVPT
```

## Result

`GET /runs/:id` → `workflow_status: "FAILED"` within one poll (a few
seconds) — no retry backoff delay, confirming no retries happened. Full
response: [`scenario-3-run-summary.json`](./scenario-3-run-summary.json).

## History proves exactly one attempt

[`scenario-3-history.json`](./scenario-3-history.json), 19 events:
`initializeRun` succeeds (events 6–8), then the planner's `runAgent`
(events 13–15):

```json
{ "eventId": "14", "eventType": "ActivityTaskStarted",
  "activityTaskStartedEventAttributes": { "attempt": 1 } }
{ "eventId": "15", "eventType": "ActivityTaskFailed",
  "activityTaskFailedEventAttributes": {
    "failure": {
      "message": "agent output failed AgentResult validation: [\n  {\n    \"code\": \"too_big\",\n    \"maximum\": 2048,\n    \"path\": [\"summary\"],\n    \"message\": \"summary must be capped at 2 KiB\"\n  }\n]",
      "stackTrace": "InvalidAgentOutputError: agent output failed AgentResult validation: ...\n    at normalizeAgentResult (.../result-normalizer.js:46:15)\n    at runAgent (.../run-agent.js:110:57)\n..."
    }
  }
}
```

`attempt: 1` on the (only) `ActivityTaskStarted`, immediately followed by
`ActivityTaskFailed` — no second `ActivityTaskScheduled`/`Started` for
this activity anywhere in the history — and `WorkflowExecutionFailed`
(event 19) follows directly. Compare with [scenario 2](./scenario-2-transient-failure-retry.md),
where a retryable error reaches `attempt: 3` before completing: here the
non-retryable classification stops the workflow after attempt 1, exactly
as `nonRetryableErrorTypes: ['InvalidAgentOutputError', ...]` specifies.
