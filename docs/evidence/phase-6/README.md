# Phase 6 evidence — failure demonstration

Per PLAN §9 Phase 6 / §12 (definition of done). All runs use
`AGENT_MODE=mock` against the real Docker Compose stack
(`infra/temporal/docker-compose.yaml`) with real Temporal, real
PostgreSQL, real MinIO, real host workers, and a real HTTP `POST/GET
/runs`. Every scenario below is a genuine live run through
`agentRunWorkflow`, not a unit test — evidenced by the exported workflow
history JSON alongside each write-up.

| Scenario | Evidence |
|---|---|
| Happy path (baseline) | [`happy-path.md`](./happy-path.md) |
| 1 — worker restart mid-run | [`scenario-1-worker-restart.md`](./scenario-1-worker-restart.md) |
| 2 — model failure and retry | [`scenario-2-transient-failure-retry.md`](./scenario-2-transient-failure-retry.md) |
| 3 — invalid agent JSON (non-retryable) | [`scenario-3-invalid-agent-json.md`](./scenario-3-invalid-agent-json.md) |
| 4 — invalid patch | [`scenario-4-invalid-patch.md`](./scenario-4-invalid-patch.md) |
| 5 — failed tests | [`scenario-5-failed-tests.md`](./scenario-5-failed-tests.md) |

Each `.md` links its own `*-run-summary.json` (the `GET /runs/:id`
response) and `*-history.json` (the exported Temporal workflow history).

## How the evidence was produced

Mock mode's opencode stand-in (`agent-runtime/src/opencode-adapter.ts`)
never touches the filesystem or varies its output, so on its own it
cannot exercise a transient retry, a non-retryable malformed-output
failure, a real patch for `validatePatch` to accept or reject, or an
activity slow enough to `kill -9` its worker mid-flight. A small,
contained, opt-in fault-injection module —
[`packages/worker/src/activities/evidence-fault-injection.ts`](../../../packages/worker/src/activities/evidence-fault-injection.ts)
— adds exactly the five `EVIDENCE_*` env-var hooks needed, each a no-op
unless its env var is set, wired into `run-agent.ts` only. Production
behaviour and every one of the 97 pre-existing unit/integration tests are
unaffected (verified: `pnpm exec vitest run` still passes 97/97 after
these changes).

## Infra notes

- MinIO's committed port (9000) conflicts with an unrelated container on
  this host. A throwaway, uncommitted `docker-compose` override
  (`ports: !override [...]`, kept outside the repo) remaps it to
  9500/9501 for this evidence session only; the committed compose file is
  untouched.
- The host `temporal` CLI (and the one bundled in `temporal-admin-tools`)
  fail to reach the pinned server 1.29.7 with `context deadline exceeded`
  — a pre-existing, already-documented version mismatch (see
  `infra/temporal/.env` and `apps/run-api/scripts/register-search-attributes.js`).
  History exports instead use `tctl workflow show --output_filename`
  (bundled in the same `temporal-admin-tools` container, which already
  works for search-attribute registration) and `docker compose cp` to
  retrieve the file.

## Bugs discovered and fixed

Getting even the happy path to run live surfaced two real, previously
undiscovered defects — `make e2e` was still a stub (see `Makefile`), so no
gate had ever exercised a live `POST /runs` before this task:

1. **`RunId` search-attribute name collision** — PLAN §4.2 named a custom
   search attribute `RunId`, colliding with Temporal's reserved system
   attribute of the same name; every workflow start failed with
   `INVALID_ARGUMENT: RunId attribute can't be set in SearchAttributes`.
   Renamed to `TaskRunId` (`packages/agent-contracts/src/search-attributes.ts`,
   `apps/run-api/scripts/register-search-attributes.js`).
2. **Coder retries reused a half-committed ephemeral workspace** —
   `run-agent.ts` hardcoded `attempt: 1` for `createWorkspace(...)`
   instead of the real Temporal attempt number, defeating
   `createWorkspace`'s documented "a retry never inherits a half-applied
   patch from a crashed attempt" guarantee (PLAN §5.3) on every real
   retry. Reproduced live while capturing scenario 1; fixed by reading
   `Context.current().info.attempt`.

Full detail and comments are in the diff and in
[`happy-path.md`](./happy-path.md)'s "Bugs found and fixed" section.
