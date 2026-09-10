# Phase 6 — scenario 4: invalid patch

Corrupt the coder's real `git diff` output before `validatePatch` sees it,
and show `PatchApplyFailedError` plus a clean (fully disposed) ephemeral
workspace (PLAN §9 Phase 6; builds on the Phase 4 `validate-patch.test.ts`
unit coverage of `PatchApplyFailedError`, but exercised here through the
live workflow end to end, not just the unit test).

## Setup

```bash
AGENT_MODE=mock ARTIFACT_STORE_ENDPOINT=http://localhost:9500 \
  EVIDENCE_CODER_EDIT=safe EVIDENCE_CORRUPT_PATCH=1 \
  node packages/worker/dist/main.js
```

`EVIDENCE_CODER_EDIT=safe` makes the coder produce a real, valid `git
diff` (as in the happy path). `EVIDENCE_CORRUPT_PATCH=1`
(`evidence-fault-injection.ts`) then mangles that real diff's hunk-header
line counts (`@@ -1,4 +1,4 @@` → `@@ -1,99 +1,99 @@`) before it's stored
as the `patch` artifact — corrupting an otherwise-genuine diff rather than
hand-writing a fake one that would bypass the real `git diff` code path
every other scenario exercises.

## Command

```bash
curl -s -X POST http://localhost:3301/runs -H 'content-type: application/json' -d '{
  "repository": "local/fixture", "task_class": "feature",
  "instruction": "Phase 6 scenario 4 invalid patch"
}'
# => run_id 01M248WBE044G55X68XPQDH6YZ
```

## Result

`GET /runs/:id` → `workflow_status: "FAILED"`. Worker log:

```
error: [Error: Activity task failed] {
  [cause]: PatchApplyFailedError: git apply failed: error: corrupt patch at line 11
      at applyPatch (.../agent-tools/dist/patch.js:34:15)
      at async validatePatch (.../worker/dist/activities/validate-patch.js:89:13)
      ...
}
```

## Clean workspace confirmed

Both ephemeral directories for this run are present but **empty** —
`workspace.dispose()` in `validate-patch.ts`'s `finally` block ran on the
error path, per its documented "workspace is always disposed in `finally`,
on every exit path":

```bash
$ find tmp/runs/01M248WBE044G55X68XPQDH6YZ -maxdepth 3
tmp/runs/01M248WBE044G55X68XPQDH6YZ
$ find /tmp/agent-run-coder-workspaces/01M248WBE044G55X68XPQDH6YZ -maxdepth 3
/tmp/agent-run-coder-workspaces/01M248WBE044G55X68XPQDH6YZ
```
(no children under either — both the coder's `run-agent.ts` workspace and
`validatePatch`'s own ephemeral workspace disposed cleanly.)

## History

[`scenario-4-history.json`](./scenario-4-history.json), 33 events:
planner → coder (both succeed, coder produces the corrupted patch
artifact) → `validatePatch` (events 27–29):

```json
{ "eventId": "28", "eventType": "ActivityTaskStarted",
  "activityTaskStartedEventAttributes": { "attempt": 1 } }
{ "eventId": "29", "eventType": "ActivityTaskFailed",
  "activityTaskFailedEventAttributes": {
    "failure": { "message": "git apply failed: error: corrupt patch at line 11", ... }
  }
}
```

Single attempt, then `WorkflowExecutionFailed` (event 33) —
`PatchApplyFailedError` is in `validatePatch`'s `nonRetryableErrorTypes`
(`activity-options.ts`), matching PLAN §5.2's non-retryable pair.
