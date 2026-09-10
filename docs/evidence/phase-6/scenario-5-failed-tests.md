# Phase 6 — scenario 5: failed tests

A patch that applies cleanly but breaks the fixture repo's test suite:
show `ValidationResult.status = "failed"`, confirm the reviewer role still
ran, and confirm the overall run outcome is `failed` — the reviewer
structurally cannot override the deterministic gate (PLAN §9 Phase 6, and
`agent-run.workflow.ts`'s own comment: "The reviewer structurally cannot
override a failed deterministic gate").

## Setup

```bash
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  EVIDENCE_CODER_EDIT=break-tests \
  node packages/worker/dist/main.js
```

`EVIDENCE_CODER_EDIT=break-tests` (`evidence-fault-injection.ts`) edits
`fixtures/sample-repo/src/greet.js` in the coder's seeded workspace to
return `Goodbye, ${name}!` instead of `Hello, ${name}!` — a real,
syntactically valid change that `git apply`/format/lint all accept, but
that `greet.test.js`'s `assert.equal(greet('world'), 'Hello, world!')`
fails.

## Command

```bash
curl -s -X POST http://localhost:3301/runs -H 'content-type: application/json' -d '{
  "repository": "local/fixture", "task_class": "feature",
  "instruction": "Phase 6 scenario 5 failed tests"
}'
# => run_id 01M248YF019PY55ZP3DE2R1V7W
```

## Result

`GET /runs/:id` → `workflow_status: "COMPLETED"` (not `FAILED` —
`validatePatch`'s failing-test path fails the *result*, not the activity;
see `validate-patch.ts`: "Steps 5 and 6 fail the result... without
throwing"), `run_status: "failed"`. Full response:
[`scenario-5-run-summary.json`](./scenario-5-run-summary.json).

Relevant excerpt of `summary.validation`:

```json
{
  "status": "failed",
  "steps": [
    { "name": "allowlist", "status": "passed" },
    { "name": "apply", "status": "passed" },
    { "name": "format", "status": "passed" },
    { "name": "lint", "status": "passed" },
    { "name": "test", "status": "failed", "output_ref": "artifact://runs/.../validation/test.log" },
    { "name": "secret-scan", "status": "passed" }
  ],
  "violations": [{ "step": "test", "severity": "error", "message": "test check failed" }]
}
```

`summary.review.agent == "reviewer"` and `summary.review.status ==
"success"` — the reviewer role ran (`agentRunWorkflow` always runs it
regardless of `validation.status`) — but `summary.status == "failed"`,
computed solely from `validation.status`, per the workflow's own comment
that the outcome below is "computed from `validation.status`, not from
anything the reviewer says."

## History

[`scenario-5-history.json`](./scenario-5-history.json), 47 events — same
shape as the happy path (planner → coder → validatePatch → **reviewer** →
publishRunSummary → `WorkflowExecutionCompleted`), confirming the reviewer
activity (events 34–36) executed and completed normally even though
`validatePatch` (events 27–29) returned a failed result rather than
throwing.
