# Config-gap follow-up: Web UI menu tour findings

Follow-up to the full menu tour (`docs/evidence/demo/menu-tour/`). Two gaps were found;
one is fixed by dynamic config, the other is a server-version limitation that dynamic
config cannot address.

## 1. Worker Heartbeats — config fix applied, partial improvement

**Before:** `infra/temporal/dynamicconfig/development-sql.yaml` didn't set
`frontend.workerHeartbeatsEnabled`, so the top-level **Workers** page showed a static
"Worker Heartbeats Disabled" placeholder instead of any real data.

**Fix:** added `frontend.workerHeartbeatsEnabled: true` to the dynamic config.

**After:** the placeholder is gone — confirming the flag is read and applied — but the
page (and the new "Workers" tab on each task queue) now fails with
`method ListWorkers not supported` (`01-workers-after-fix.png`,
`02-taskqueue-workers-still-ok.png`). This is the pinned `temporalio/auto-setup:1.29.7`
server not implementing the `ListWorkers` RPC that Web UI 2.53.3 expects for this
feature — the same root cause documented for `auto-setup:1.31.2` not existing upstream
(see `docs/PLAN.md` deviations). Upgrading the server image is out of scope for this PoC
(explicitly deferred to Phase 7's TS/SDK version spike), so this remains a known
limitation, not a bug in our stack.

**What still works, unaffected:** the per-task-queue **Pollers** tab (the actually
load-bearing worker visibility for this project — proves `agent-default` and
`tool-validation` have live pollers, and that `external-action` has zero) continues to
show correct, real data (`03-pollers-tab-still-ok.png`).

## 2. Schedule count 501 — not fixable via dynamic config

**Before/after:** `GET /api/v1/namespaces/default/schedule-count` still returns
`501 Not Implemented` (`04-schedules-501-persists.png`), with or without the heartbeat
config change. This confirms it's an unrelated RPC gap in the same pinned server version,
not a dynamic-config toggle. The Schedules page itself still renders correctly ("0
Schedules") despite the console error — cosmetic only, no functional impact, and this
PoC doesn't use Schedules.

## Verification

Both screenshots were captured against a freshly booted stack with a real completed
workflow run (`agent-run/01M2630F88Q2H3N7D9JF7VY710`), on `main`, after the dynamic
config change and a full worker/API restart to pick it up.
