# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Purpose of this project

This is a proof of concept that runs an agentic coding pipeline —
**planner → coder → deterministic validation → reviewer** — as a durable
[Temporal](https://temporal.io) workflow. It exists to prove three things:

1. **Durability.** A multi-minute, multi-role agent run survives a worker crash and
   resumes without re-executing completed steps — Temporal owns this, not custom code.
2. **Compact state.** Only summaries and `artifact://` references cross into workflow
   history. Full patches, logs, and model output live in an S3-compatible artifact store
   (MinIO locally), never in Temporal's persisted state.
3. **A deterministic gate the reviewer cannot override.** The coder's patch must pass a
   real apply/allowlist/format/lint/test/secret-scan pipeline before the reviewer sees it,
   and the workflow — not the reviewer — decides the run outcome.

It deliberately does **not** create PRs, write to target repositories, or deploy anything.
Full design rationale is in [`docs/INITIAL.md`](docs/INITIAL.md); the phased
implementation plan with acceptance evidence per phase is in [`docs/PLAN.md`](docs/PLAN.md).

## Repository layout

See the table in [`README.md`](README.md#repository-layout). In short: `apps/run-api` is
the HTTP surface, `packages/workflows` + `packages/worker` are the Temporal side,
`packages/agent-runtime` wraps `opencode run`, `packages/agent-contracts` is the single
source of truth for every payload shape (Zod → generated JSON Schema), `packages/agent-tools`
is the deterministic validation gate, and `packages/artifact-store` is the S3/MinIO client.

## How to develop here

### One-time setup

```bash
make install   # pnpm install --frozen-lockfile
```

### Everyday loop

```bash
make build     # tsc -b across all workspace packages (project references)
make lint      # biome check --write (lint + format, single tool)
make test      # vitest unit + integration — fast, mocked/stubbed, no live stack needed
```

Run these three before considering any change done. `make test` must stay fast
(seconds, not minutes) because it never touches Docker or real `opencode` — it uses
`AGENT_MODE=mock`, `TestWorkflowEnvironment`, and real-but-local stub binaries instead of
module mocks (per the testing pyramid in `docs/PLAN.md` §10).

### Running the full stack locally

```bash
make up          # docker compose up (Postgres, Temporal, Temporal UI, MinIO) +
                  # wait-healthy + register the 5 custom search attributes
make worker      # host process: agent-default queue (planner/coder/reviewer + summary)
make worker-val  # host process: tool-validation queue (validatePatch)
make api         # host process: Run API on :3300
make run         # shorthand for `up` + a reminder to start worker/worker-val/api
make stop        # kill host worker/api processes + docker compose down
make down        # docker compose down only
```

Workers and the API run as host processes, not in Docker — they spawn `opencode`
subprocesses and need the host's `opencode` auth/config.

Temporal Web UI: [http://localhost:8233](http://localhost:8233). MinIO console:
`localhost:9001` (default `minioadmin`/`minioadmin`, see `infra/temporal/.env`).

**Known host-specific caveat:** MinIO's default port 9000 can collide with other local
services. If `make up` fails on the MinIO container, remap the two port lines in
`infra/temporal/docker-compose.yaml` locally (do not commit that change) and set
`ARTIFACT_STORE_ENDPOINT` accordingly for `make worker`/`make worker-val`.

### Schemas

```bash
make schemas   # regenerate schemas/*.schema.json from the Zod contracts
```

`schemas/` is generated and committed. Any change to `packages/agent-contracts/src/*.ts`
must be followed by `make schemas` and the diff committed — CI-equivalent check:
`make schemas && git diff --exit-code schemas/` must be clean.

### Full Make target reference

| Target | What it does |
|---|---|
| `make install` | `pnpm install --frozen-lockfile` |
| `make build` | `tsc -b` across all workspace packages |
| `make lint` | `biome check --write .` (lint + format) |
| `make test` | `vitest run` — unit + integration, mock/stub only, excludes gates |
| `make schemas` | Regenerate `schemas/*.schema.json` from the Zod contracts |
| `make up` | `docker compose up -d` (Postgres, Temporal, UI, MinIO) + wait-healthy + register search attributes |
| `make down` | `docker compose down` |
| `make worker` | Run the `agent-default` worker (host process) |
| `make worker-val` | Run the `tool-validation` worker (host process) |
| `make api` | Run the Run API on `:3300` (host process) |
| `make run` | `up` + a reminder to start `worker`/`worker-val`/`api` in separate terminals |
| `make stop` | Kill host worker/api processes + `docker compose down` |
| `make e2e` | All non-mocked gates G1–G5 against the live stack (`GATE=n` for one) — **not yet automated**, see `docs/evidence/` for manual gate evidence instead |
| `make e2e-ui` | Playwright UI gate (GU) against the Temporal UI on `:8233` — **not yet automated**, see `docs/evidence/ui/` for manual GU evidence instead |
| `make clean` | Remove `dist/`, `.turbo/`, `tmp/`, and stray `*.tsbuildinfo` files |

`make e2e`/`make e2e-ui` are honest stubs today: the gates named in `docs/PLAN.md` §9 were
executed and captured manually (see `docs/evidence/phase-6/` and `docs/evidence/ui/phase-6/`)
rather than wired into an automated `e2e/` harness. Building that harness is real
follow-up work, not done yet.

### Environment variables worth knowing

| Variable | Effect |
|---|---|
| `AGENT_MODE` | `mock` (default) — no `opencode` spawned, deterministic fixtures. `real` — spawns real `opencode run`. |
| `AGENT_MODEL_ALLOWLIST` | Comma-separated list of allowed `requested_model` values (empty = no restriction) |
| `ARTIFACT_STORE_ENDPOINT` | S3-compatible endpoint for `packages/artifact-store` (defaults to `http://localhost:9000`, MinIO) |
| `PAYLOAD_CODEC` | `identity` (default) or `aes-gcm` — Temporal payload encryption, see `packages/worker/src/codec/` |
| `PORT` | Run API port (default `3300`) |

## Conventions

- **TypeScript is pinned to 5.9.3.** Do not upgrade to satisfy an SDK peer dependency —
  the Temporal workflow bundler's compatibility with TS 6/7 is an explicit, isolated
  Phase 7 spike in `docs/PLAN.md`, not a casual bump.
- **Workflow code stays pure.** `packages/workflows/src/agent-run.workflow.ts` must have
  no file I/O, network calls, `Date.now()`, or `Math.random()` — all of that lives in
  activities (`packages/worker/src/activities/*`). A replay-determinism test
  (`packages/workflows/src/__tests__/replay.test.ts`) enforces this indirectly.
- **Non-retryable errors are real classes, not renamed `Error`s.** Temporal's
  `RetryPolicy.nonRetryableErrorTypes` matches on `error.constructor.name` — setting
  `.name` on a plain `Error` does not register as non-retryable.
- **Never put full patches, logs, or conversations into an `AgentResult`/`ValidationResult`.**
  `summary` is capped (2 KiB) and `artifact_refs` values must match the `artifact://`
  URI pattern — this is enforced by the Zod schema, not just convention.
- **Tests avoid mocks where a real thing is cheap and fast.** `agent-runtime` tests spawn
  real stub Node scripts as fake `opencode` binaries; `agent-tools` tests use real `git`
  against real temp directories. Reserve mocking for genuinely expensive/external things
  (a live MinIO, a live model call) that already have their own real-mode tests elsewhere.

## Testing pyramid

- **Unit (~50%)** — contract validation, result normalization, allowlist/patch parsing,
  secret scanning, prompt composition. No mocks needed.
- **Integration (~30%)** — activities against real ephemeral git workspaces and a stub
  `opencode` binary on `PATH`; workflows under `TestWorkflowEnvironment` (time-skipping).
- **E2E (manual today)** — full stack, zero mocks: real Temporal, real Postgres, real
  MinIO, real host workers, real HTTP, real `opencode run`. Captured as evidence under
  `docs/evidence/` rather than an automated suite — see the caveat on `make e2e` above.

Any workflow code change must replay the recorded history in
`packages/workflows/src/__tests__/fixtures/agent-run-history.json` cleanly, or regenerate
it deliberately via `packages/workflows/scripts/generate-replay-fixture.ts` if the change
is an intentional behavior change, not a refactor.
