# GU — Playwright UI checklist (PLAN §9.8), Phase 6 full execution

Executed against a freshly-`docker compose up`'d stack (postgres, temporal, temporal-ui,
temporal-admin-tools; MinIO on remapped local ports 9500/9501 due to a host port-9000
conflict with an unrelated container — see `docs/evidence/phase-6/README.md`). Seeded
with the three run outcomes the checklist requires: one **completed** feature run, one
**failed** run (real `PatchApplyFailedError`), and one **cancelled** run (real
`POST /runs/:id/cancel` mid-`coding`).

Run IDs used:
- Completed: `agent-run/01M24AJ22BDWBKE2HV6TAS64S0` (`task_class=feature`)
- Failed: `agent-run/01M24ABYXCMQZ4WD2JR8HEBE9V`
- Cancelled: `agent-run/01M24APDZ0BTVY4JE6W54827P7`

All screenshots are accessibility-snapshot-driven (MCP Playwright), captured as evidence
per PLAN §9.8 — not DOM assertions.

## Checklist results

| # | Action | Observed | Screenshot |
|---|---|---|---|
| 1 | Navigate `localhost:8233` | UI loads, `default` namespace selected, no error banner | [`01-landing.png`](./01-landing.png) |
| 2 | Open workflows list | 20 workflows listed, IDs of the form `agent-run/<ULID>` (plus earlier `pingWorkflow`/manual-test runs from Phases 1–3) | [`02-list.png`](./02-list.png) |
| 3 | Filter `RunStatus="succeeded"` | Returns exactly the 7 completed runs, all status `Completed` | [`03-filter-runstatus.png`](./03-filter-runstatus.png) |
| 4 | Filter `TaskClass="feature"` | Returns 13 runs (mixed Completed/Failed) — proves `TaskClass` is independently indexed, not just `RunStatus` | [`04-filter-taskclass.png`](./04-filter-taskclass.png) |
| 5 | Completed run detail page | Status `Completed`; Search Attributes tab shows `Repository`, `RunStatus`, `TaskClass`, `TaskRunId` (see note below on naming) with correct values; start/end/duration present | [`05-detail-summary.png`](./05-detail-summary.png) |
| 6 | Event History (compact) | Ordered sequence `initializeRun → runAgent(planner) → runAgent(coder) → validatePatch → runAgent(reviewer) → publishRunSummary`; `validatePatch` attributed to `tool-validation` queue, everything else to `agent-default` | [`06-history-compact.png`](./06-history-compact.png) |
| 7 | Expand coder's `ActivityTaskCompleted` | Payload contains **only** `summary`, `confidence`, `artifact_refs` (`artifact://runs/.../coder/patch.diff`), `metrics` — no diff text, no logs, no conversation | [`07-payload-compact.png`](./07-payload-compact.png) |
| 8 | Failed run failure event | `PatchApplyFailedError` typed name + readable message (`git apply failed: error: No valid patches in input`) visible; attempt **1** (matches non-retryable classification) | [`08-failure.png`](./08-failure.png) |
| 9 | Cancelled run | Status `Cancelled`; history shows `ActivityTaskCancelRequested` (event 25) — see caveat below | [`09-cancelled.png`](./09-cancelled.png) |
| 10 | Workers / task queue view | `agent-default`: 1 worker/poller. `tool-validation`: 1 worker/poller (Activity Handler only, no Workflow Task Handler — correct). `external-action`: **0 workers** | [`10a-workers-agent-default.png`](./10a-workers-agent-default.png), [`10b-workers-external-action-zero.png`](./10b-workers-external-action-zero.png) |
| 11 | Console errors (level `error`) | 2 errors found, both self-inflicted during this session (see below), **not** a defect in the application under test | see below |

## Naming deviation (carried from Phase 6 code evidence)

PLAN §4.2 names the run-identifying attribute `RunId`. It collided with Temporal's
reserved system search attribute of the same name (workflow start failed until this was
found in Phase 6). The attribute was renamed to `TaskRunId` — see
`packages/agent-contracts/src/search-attributes.ts` and
`docs/evidence/phase-6/scenario-1-worker-restart.md` for the full story. Step 5 above
reflects this: `TaskRunId`, not `RunId`, is the attribute shown.

## Step 9 caveat (found during this GU session, documented not hidden)

The cancelled run's coder-role activity actually shows as `ActivityTaskCompleted`
(event 27), not `ActivityTaskCanceled`, even though `ActivityTaskCancelRequested`
(event 25) is present and the **workflow** itself closed `Cancelled`. Root cause: this
seed run used `AGENT_MODE=mock` with the Phase 6 `EVIDENCE_DELAY_MS` test hook to create
a cancellation window — that hook is a bare `setTimeout`, not wired to the activity's
`cancellationSignal()`, so it runs to completion regardless of the cancel request; only
the *workflow* observes and honors the cancellation.

This is a limitation of the **evidence-only mock delay hook**, not of the real
cancellation mechanism: the real SIGTERM→grace→SIGKILL subprocess-kill path (real child
process, real PID gone, `cancelled()`/`CancelledFalure` correctly thrown) was already
proven directly in Phase 5 with a real spawned stub binary — see
`packages/worker/src/__tests__/run-agent-cancellation.test.ts` and the Phase 5 handoff.
A stricter version of this GU run would use `AGENT_MODE=real` against a real slow
`opencode` call to see `ActivityTaskCanceled` in this exact screenshot; substituting mock
mode here was a deliberate cost/time tradeoff already flagged as acceptable per
PLAN §9.8's own precedent (Phases 1–5 also documented similar substitutions).

## Step 11 detail

Two console errors were captured, both caused by my own exploratory navigation to a
route that doesn't exist in Temporal UI 2.53.3 (`/summary` instead of `/timeline` or
`/history`) before I found the correct route — the UI's own 404 handling, not a defect
surfaced by the application under test. No console errors were observed on any of the
routes actually used for steps 1–10 above.

## Failure-condition check (PLAN §9.8)

None of the four listed failure conditions triggered:
- Steps 3–4 returned real, non-empty, correctly-filtered results.
- Step 7 showed no large payload.
- Step 9 showed `ActivityTaskCancelRequested` (partial pass — see caveat above for the
  activity-level completion nuance).
- Step 10 showed zero pollers on `external-action`.
