# Implementation Plan — Temporal Agentic Workflow PoC

Derived from [INITIAL.md](INITIAL.md). This document turns the PoC brief into an executable plan with pinned versions, concrete file-by-file deliverables, and per-phase acceptance evidence.

**Status:** planning complete, implementation not started.
**Last verified against upstream releases:** 2026-09-09.

> This plan describes Phases 0–6: one hardcoded planner→coder→validate→reviewer
> workflow. That workflow has since been generalized into a pipeline interpreter
> that runs any named pipeline declared under `pipelines/` — see
> [`docs/PROJECTS.md`](PROJECTS.md) for that refactor's plan and rationale, and
> the repository-layout table in [`README.md`](../README.md) for the current
> structure.

---

## 1. Research summary — state of the art

### 1.1 Version landscape (verified 2026-09-09)

| Component | Latest | Chosen for PoC | Rationale |
|---|---|---|---|
| Temporal Server | 1.31.2 (2026-07-08) | **1.31.2** | Current stable server release. |
| Temporal CLI | 1.8.3 (2026-09-02) | 1.8.2 (installed locally) | Already present; bundles server 1.31.2 + UI 2.50.1 for `start-dev`. |
| Temporal UI | 2.53.3 (2026-08-13) | **2.53.3** | Current stable UI. |
| `@temporalio/*` SDK | 1.23.0 (2026-08-26) | **1.23.0** | Current TS SDK. Requires Node `>= 20.3.0`. |
| Node.js | 24.15.0 (installed) | **24.x** | Satisfies SDK engine constraint. |
| pnpm | 12.1.0 (installed) | **12.x** | Workspace-native monorepo, strict peer resolution. |
| TypeScript | 7.0.2 | **5.9.3** (pinned) | See risk note below. |
| Zod | 4.5.4 | **4.5.x** | Zod 4 emits JSON Schema natively — single source of truth for contracts. |
| Ajv | 8.20.0 | **8.20.x** | Validates emitted JSON Schemas at the process boundary. |
| Fastify | 5.12.3 | **5.12.x** | Run API; mature schema/serialization and lifecycle hooks. |
| execa | 10.0.1 | **10.x** | Subprocess control with `AbortSignal`, timeout, stream capture. |
| Vitest | 5.0.0 | **5.x** | Test runner for unit + integration. |
| Biome | 2.5.12 | **2.5.x** | Single binary lint + format, replaces ESLint + Prettier. |
| Pino | 10.3.1 | **10.x** | Structured logs with built-in redaction paths. |
| PostgreSQL | 16 (Temporal-recommended) | **16-alpine** | Temporal's own compose pins Postgres 16. |
| MinIO | RELEASE.2025-09-07T16-13-09Z | **that release** | S3-compatible local artifact store. |
| `@aws-sdk/client-s3` | 3.1129.0 | **3.x** | S3 client against MinIO; portable to real S3 later. |
| opencode | 1.18.29 (installed) | **1.18.x** | Agent runtime; `run --format json` gives machine-readable events. |

**TypeScript version risk (explicit):** `typescript@latest` is now 7.0.2, the Go-native compiler rewrite; 6.0.3 is also published as stable. The Temporal TS SDK's workflow bundler runs webpack over workflow sources, and I have **not** verified SDK 1.23.0 bundling under TS 6 or 7. This plan pins **TypeScript 5.9.3** for the PoC to eliminate that unknown, with an explicit Phase 7 spike to attempt a TS 7 upgrade and measure it. Do not treat TS 5.9.3 as a permanent choice.

### 1.2 Findings that change the INITIAL design

These are additions/corrections the research surfaced. Each is folded into the phases below.

1. **Search attributes must be explicitly registered.** Temporal does not auto-create custom search attributes. Each one (`RunId`, `Repository`, `RunStatus`, `RequestedModel`, `TaskClass`) needs `temporal operator search-attribute create --name X --type Y` against the namespace before first use, or workflow start fails. This becomes a first-class bootstrap step (`infra/temporal/register-search-attributes.sh`), not an afterthought in Phase 5.

2. **Use the typed search-attribute API, not the legacy one.** SDK 1.23 exposes `defineSearchAttributeKey(name, SearchAttributeType.KEYWORD)` plus `typedSearchAttributes` on `WorkflowOptions` and `workflowInfo()`, and `upsertSearchAttributes([{key, value}])` inside workflows. The untyped `searchAttributes: Record<string, unknown[]>` form is legacy. We use the typed API throughout so `RunStatus` transitions are type-checked.

3. **Cancellation needs `heartbeat()` + `ActivityCancellationType`.** An `opencode run` subprocess can last minutes. For workflow cancellation to actually kill it, `runAgent` must (a) call `heartbeat()` periodically so the server can deliver cancellation, (b) have `heartbeatTimeout` configured, and (c) catch `CancelledFailure` to `SIGTERM` then `SIGKILL` the child. The workflow side sets `cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED` so cleanup completes before the workflow observes cancellation. This is the single most commonly botched part of the design and gets a dedicated task.

4. **Heartbeat details enable cheap resumption.** `activityInfo().heartbeatDetails` survives worker crashes. We heartbeat a small progress token (`{phase, bytesRead, startedAt}`) so a retried `runAgent` can log what it lost rather than silently restarting blind.

5. **Time-skipping test environment.** `@temporalio/testing`'s `TestWorkflowEnvironment.createTimeSkipping()` lets us test timeout/retry behaviour without real waits. Combined with `Worker.runReplayHistory()` this gives us **determinism regression tests** — replay a recorded history against modified workflow code and assert no non-determinism error. This is the state-of-the-art safety net for evolving workflow code and is added as a Phase 3 deliverable.

6. **Zod 4 → JSON Schema removes contract drift.** Rather than hand-maintaining `schemas/*.json` alongside TS types (three sources of truth: types, schemas, validators), define Zod schemas once in `agent-contracts`, derive TS types via `z.infer`, and **generate** `schemas/*.schema.json` via a build script. A CI check regenerates and diffs to prove they never drift.

7. **Temporal's reference compose is behind.** `temporalio/docker-compose`'s `.env` still pins `TEMPORAL_VERSION=1.29.1` / `TEMPORAL_UI_VERSION=2.34.0`. We author our own compose file pinned to 1.31.2 / 2.53.3 rather than vendoring theirs, and pin every image by tag (no `latest`).

8. **Payload codec is a Phase 5 deliverable, not optional.** INITIAL flags it conditionally. Since agent summaries may quote repository content, we implement a codec interface from the start (identity codec by default, AES-GCM codec behind a flag) so enabling encryption later is a config change, not a refactor.

9. **`opencode run --format json` is the integration surface.** The installed CLI supports `--format json` (raw JSON events), `--model provider/model`, `--agent`, `--dir`, `--variant`, and `--auto` for non-interactive permission auto-approval. The adapter parses the JSON event stream rather than scraping formatted text. `--auto` is required for unattended runs but is explicitly dangerous — it is only ever used against the **ephemeral workspace copy**, never the real repo.

### 1.3 Deliberate non-goals for this PoC

Restating INITIAL's boundary so it cannot erode:

- No PR creation, no pushes, no writes to any target repository.
- No deployment of anything the agent produces.
- No multi-tenant auth on the Run API (single trusted local caller).
- No horizontal scaling / production Temporal topology.
- The `external-action` task queue is **defined but has no registered worker**, making external actions structurally impossible rather than merely disabled by a flag.

---

## 2. Target repository layout

Extends INITIAL's layout with the files research showed we need.

```
repo/
├── apps/
│   └── run-api/
│       ├── src/
│       │   ├── server.ts              # Fastify instance + plugin registration
│       │   ├── routes/runs.ts         # POST /runs, GET /runs/:id, POST /runs/:id/cancel
│       │   ├── temporal-client.ts     # singleton Client, connection lifecycle
│       │   └── config.ts              # env parsing (PORT default 3300)
│       └── package.json
├── packages/
│   ├── agent-contracts/
│   │   ├── src/
│   │   │   ├── task-request.ts        # Zod: TaskRequest
│   │   │   ├── agent-input.ts         # Zod: AgentInput (role, context, upstream)
│   │   │   ├── agent-result.ts        # Zod: AgentResult (summary, confidence, artifact_refs)
│   │   │   ├── validation-result.ts   # Zod: ValidationResult
│   │   │   ├── run-summary.ts         # Zod: RunSummary
│   │   │   ├── search-attributes.ts   # defineSearchAttributeKey definitions
│   │   │   └── index.ts
│   │   └── scripts/emit-json-schema.ts
│   ├── workflows/
│   │   ├── src/
│   │   │   ├── agent-run.workflow.ts  # the orchestration
│   │   │   ├── activity-options.ts    # timeouts + retry policies per activity
│   │   │   └── queries.ts             # defineQuery('runStatus')
│   ├── worker/
│   │   ├── src/
│   │   │   ├── main.ts                # Worker.create for agent-default
│   │   │   ├── validation-worker.ts   # Worker.create for tool-validation
│   │   │   ├── activities/
│   │   │   │   ├── initialize-run.ts
│   │   │   │   ├── run-agent.ts
│   │   │   │   ├── validate-patch.ts
│   │   │   │   └── publish-run-summary.ts
│   │   │   └── codec/                 # PayloadCodec (identity + aes-gcm)
│   ├── agent-runtime/
│   │   ├── src/
│   │   │   ├── cli.ts                 # `agent-runtime run --role ...`
│   │   │   ├── opencode-adapter.ts    # execa + JSON event stream parsing
│   │   │   ├── prompt-composer.ts     # role prompt + context → final prompt
│   │   │   ├── result-normalizer.ts   # raw output → AgentResult
│   │   │   └── modes.ts               # mock | real model selection
│   ├── agent-tools/
│   │   ├── src/
│   │   │   ├── workspace.ts           # ephemeral workspace create/dispose
│   │   │   ├── patch.ts               # git apply --check then apply
│   │   │   ├── allowlist.ts           # file-path allowlist enforcement
│   │   │   ├── checks.ts              # format / lint / test runners
│   │   │   └── secret-scan.ts         # artifact secret scanning
│   └── artifact-store/                # NEW — not in INITIAL, needed by 3 packages
│       ├── src/
│       │   ├── store.ts               # put/get/presign against S3 API
│       │   └── ref.ts                 # artifact:// URI parse/format
├── prompts/                            # historical (Phases 0-6): superseded by
│   ├── planner.md                      # `pipelines/coding-review/prompts/` — see
│   ├── coder.md                        # docs/PROJECTS.md for the pipeline-interpreter
│   └── reviewer.md                     # refactor that moved these under `pipelines/`.
├── infra/
│   └── temporal/
│       ├── docker-compose.yaml
│       ├── .env                       # pinned image versions
│       ├── dynamicconfig/development-sql.yaml
│       └── register-search-attributes.sh
├── schemas/                            # GENERATED, committed, drift-checked in CI
│   ├── task-request.schema.json
│   ├── agent-input.schema.json
│   ├── agent-result.schema.json
│   ├── validation-result.schema.json
│   └── run-summary.schema.json
├── docs/
│   ├── INITIAL.md
│   └── PLAN.md
├── pnpm-workspace.yaml
├── Makefile
├── biome.json
├── tsconfig.base.json
└── vitest.workspace.ts
```

**Deviation from INITIAL, flagged:** a sixth package, `artifact-store`, is added. INITIAL implies artifact handling lives inside `agent-runtime`, but `validate-patch` and `publish-run-summary` also read and write artifacts. Duplicating S3 logic across three packages would violate DRY; a thin shared package is the smaller cost.

---

## 3. Contracts

Defined in Zod, types inferred, JSON Schema generated. Shapes below are the design intent, not final code.

### 3.1 `TaskRequest` (API input)

```
run_id?          string   # ULID; server-generated when absent
repository       string    # identifier only — no cloning of remote repos in PoC
task_class       enum      # "feature" | "bugfix" | "refactor" | "chore"
instruction      string    # natural-language task, 1..8000 chars
requested_model? string    # must be in the worker's allowlist
allowed_paths?   string[]  # glob allowlist; defaults to a conservative set
timeout_seconds? number    # bounded 60..3600
```

### 3.2 `AgentResult` (every role emits this)

Matches INITIAL's example exactly, plus fields the runtime needs:

```
run_id           string
agent            enum      # "planner" | "coder" | "reviewer"
status           enum      # "success" | "failure"
summary          string    # bounded length — this goes into workflow history
confidence       number    # 0..1
artifact_refs    Record<string, ArtifactRef>   # "artifact://runs/<id>/<role>/<name>"
metrics          { started_at, ended_at, duration_ms, exit_code }
error?           { kind, message }             # message truncated + redacted
```

**Hard rule enforced by the schema:** `summary` is capped (2 KiB) and `artifact_refs` values must match the `artifact://` URI pattern. Full patches, logs, and conversations cannot structurally be placed in this object, which is what keeps workflow history small.

### 3.3 `ValidationResult`

```
run_id           string
status           enum      # "passed" | "failed"
steps            [{ name, status, duration_ms, output_ref }]   # apply|allowlist|format|lint|test|secret-scan
violations       [{ step, severity, message }]
artifact_refs    Record<string, ArtifactRef>
```

The reviewer receives this object. The workflow, not the reviewer, decides the run outcome — see §5.

---

## 4. Infrastructure

### 4.1 Compose services (`infra/temporal/docker-compose.yaml`)

| Service | Image (pinned) | Host port | Purpose |
|---|---|---|---|
| `postgresql` | `postgres:16-alpine` | 5432 | Temporal persistence |
| `temporal` | `temporalio/auto-setup:1.31.2` | 7233 | Server (schema auto-setup) |
| `temporal-ui` | `temporalio/ui:2.53.3` | 8233 | Web UI |
| `temporal-admin-tools` | `temporalio/admin-tools:1.31.2-*` | — | `temporal operator` commands |
| `minio` | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | 9000 / 9001 | Artifact store + console |

**Port choices given this machine:** 7233, 8233, 5432, 9000, 9001 were all verified free. The Run API uses **3300** (INITIAL §API surface) because 3000 is occupied by an unrelated `made-backend` process. The UI is mapped to **8233** rather than the compose default 8080 to match `temporal server start-dev` conventions and avoid a common conflict.

**Workers run on the host, not in compose,** during Phases 1–5. They spawn `opencode` subprocesses and need the host's opencode auth/config; containerising that is a distraction from the PoC goal. Phase 7 revisits containerising the worker.

**Resource note:** this machine has 7.3 GiB RAM with ~3.2 GiB available. Postgres + Temporal + UI + MinIO is roughly 1.5–2 GiB, leaving room for the Node worker and one opencode subprocess. Running two agent subprocesses concurrently is likely to cause swap thrash — an additional reason for `maxConcurrentActivityTaskExecutions: 1` on the agent worker (§6.2).

### 4.2 Search attribute registration

`infra/temporal/register-search-attributes.sh`, idempotent, run after the stack is healthy:

| Attribute | Type |
|---|---|
| `RunId` | `Keyword` |
| `Repository` | `Keyword` |
| `RunStatus` | `Keyword` |
| `RequestedModel` | `Keyword` |
| `TaskClass` | `Keyword` |

`RunStatus` is upserted by the workflow as it advances (`initializing` → `planning` → `coding` → `validating` → `reviewing` → `succeeded`/`failed`/`cancelled`), which is what makes runs discoverable via visibility instead of a bespoke database, per INITIAL.

### 4.3 Make targets

Per the workspace convention:

```
make install    # pnpm install --frozen-lockfile
make up         # docker compose up -d + wait-healthy + register search attributes
make down       # docker compose down
make worker     # run agent-default worker (host)
make worker-val # run tool-validation worker (host)
make api        # run Run API on :3300
make run        # up + api + workers (dev convenience)
make stop       # stop host processes + compose down
make test       # vitest unit + integration (fast; excludes gates)
make e2e        # all non-mocked gates G1..G5 against the live stack
make e2e GATE=n # a single gate
make e2e-ui     # Playwright UI gate (GU) against Temporal UI on :8233
make lint       # biome check --write
make build      # tsc -b
make schemas    # regenerate schemas/ from Zod
make clean      # rm dist, .turbo, tmp artifacts
```

---

## 5. Workflow design

### 5.1 Orchestration

Structure is exactly INITIAL's, with the additions research demanded:

```ts
export async function agentRunWorkflow(task: TaskRequest): Promise<RunSummary> {
  setHandler(runStatusQuery, () => status);          // GET /runs/:id without a DB
  upsertSearchAttributes([{ key: RunStatusKey, value: 'initializing' }]);

  const context = await activities.initializeRun(task);

  status = 'planning';   upsert(...);
  const plan = await agentActivities.runAgent({ role: 'planner', context });

  status = 'coding';     upsert(...);
  const code = await agentActivities.runAgent({
    role: 'coder', context: { ...context, upstream: [plan] },
  });

  status = 'validating'; upsert(...);
  const validation = await validationActivities.validatePatch({ context, coderResult: code });

  status = 'reviewing';  upsert(...);
  const review = await agentActivities.runAgent({
    role: 'reviewer', context: { ...context, upstream: [plan, code, validation] },
  });

  status = validation.status === 'failed' ? 'failed' : 'succeeded';
  upsert(...);
  return activities.publishRunSummary({ context, plan, code, validation, review });
}
```

Note three deliberate properties:

- **Purity.** No file I/O, no network, no `Date.now()`, no `Math.random()` in this module. All of that lives in activities. Enforced by a Biome rule and by the replay test.
- **The reviewer runs even when validation fails,** so its commentary is captured, but the run outcome is computed from `validation.status` — the reviewer structurally cannot override a failed deterministic gate, satisfying INITIAL's requirement.
- **Two activity proxies.** `agentActivities` is proxied onto the `agent-default` queue; `validationActivities` onto `tool-validation`. This is how INITIAL's queue table becomes real routing rather than documentation.

### 5.2 Activity options

| Activity | Queue | startToClose | heartbeat | Retry |
|---|---|---|---|---|
| `initializeRun` | `agent-default` | 30 s | — | 3 attempts, 1 s initial, ×2 |
| `runAgent` | `agent-default` | 20 min | 30 s | 3 attempts, 5 s initial, ×2; non-retryable: `InvalidAgentOutput`, `ModelNotAllowed` |
| `validatePatch` | `tool-validation` | 10 min | 30 s | 2 attempts; non-retryable: `PatchApplyFailed`, `AllowlistViolation` |
| `publishRunSummary` | `agent-default` | 60 s | — | 5 attempts |

**Non-retryable error types matter.** A malformed agent JSON response will be malformed again on retry; burning three 20-minute attempts on it is waste. Distinguishing transient (network, model 5xx) from deterministic (schema violation) failures is what makes the retry policy meaningful rather than decorative.

### 5.3 Idempotency

INITIAL requires idempotent activities because Temporal retries them. Concretely:

- Every activity derives a deterministic **idempotency key** from `${run_id}/${role}/${attempt-independent-suffix}`.
- Artifact writes go to deterministic keys (`runs/<run_id>/<role>/result.json`) so a retry overwrites rather than duplicating.
- `initializeRun` creating the run prefix is a no-op if the prefix exists.
- `validatePatch` always builds a **fresh** ephemeral workspace, so a retry never inherits a half-applied patch from a crashed attempt.

---

## 6. Worker design

### 6.1 Processes

Two host processes, matching INITIAL's queue separation:

- `worker/main.ts` → task queue `agent-default`, registers `initializeRun`, `runAgent`, `publishRunSummary`.
- `worker/validation-worker.ts` → task queue `tool-validation`, registers `validatePatch`.
- `agent-expensive` and `external-action` are **named in config but have no worker**. Work routed there parks forever, which is the intended structural block for this PoC.

### 6.2 Concurrency and budget

- `maxConcurrentActivityTaskExecutions: 1` on the agent worker — one opencode subprocess at a time, matching INITIAL's "low worker concurrency" and this machine's memory ceiling.
- `maxConcurrentWorkflowTaskExecutions`: default.
- A **model budget guard** inside `runAgent` (not a separate quota service in the PoC): a per-run cap on total agent invocations and a per-process token/duration budget, read from env. INITIAL's Redis/Postgres-backed quota activity is deferred to Phase 7 and explicitly listed as out of scope for the definition of done.

### 6.3 `runAgent` subprocess contract

```
opencode run \
  --format json \
  --model "${model}" \
  --dir "${ephemeralWorkspace}" \
  --auto \
  --print-logs \
  "${composedPrompt}"
```

- Spawned via `execa` with an `AbortSignal` wired to the activity's cancellation.
- stdout parsed as a JSON event stream; stderr captured to a log artifact.
- `heartbeat({ phase, eventsSeen, elapsedMs })` on an interval and on each parsed event.
- On `CancelledFailure`: `SIGTERM`, 5 s grace, then `SIGKILL`; partial logs still flushed to the artifact store before rethrowing.
- Exit code, timings, and truncated stderr become `AgentResult.metrics` / `.error`.
- Output validated against the `AgentResult` schema; a violation throws the **non-retryable** `InvalidAgentOutput`.

**Mock mode** (`AGENT_MODE=mock`) returns fixtures without spawning opencode. Every test below Phase 6 runs in mock mode so the suite is fast, deterministic, and free; Phase 6 exercises real-model mode.

---

## 7. Deterministic validation

`validatePatch` runs the ordered steps from INITIAL, each producing a machine-readable step record:

1. **Schema validation** of the coder's `AgentResult`.
2. **Ephemeral workspace** creation (`tmp/runs/<run_id>/ws-<attempt>`), populated from a fixture repo. Disposed in a `finally` block.
3. **Allowlist enforcement** — parse the patch, reject any touched path outside `allowed_paths`. Violations are `AllowlistViolation` (non-retryable). This check runs *before* applying, so a hostile patch never lands even in the sandbox.
4. **Patch application** — `git apply --check` then `git apply`. Failure → `PatchApplyFailed` (non-retryable).
5. **Format / lint / focused tests** in the workspace, each captured to an artifact.
6. **Secret scan** across produced artifacts; any hit fails the run and the offending artifact is redacted before upload.

All step outputs are artifacts; only the compact `ValidationResult` crosses into workflow history.

---

## 8. Run API

Fastify on **:3300**, three routes from INITIAL.

| Route | Behaviour |
|---|---|
| `POST /runs` | Validate body against `TaskRequest`. Generate ULID `run_id`. Start workflow `agent-run/<run_id>` on `agent-default` with typed search attributes. Return `202` + `{ run_id, workflow_id, run_status: "initializing" }`. Uses the workflow ID as the dedup key, so a repeated request with the same `run_id` returns the existing run rather than starting a second. |
| `GET /runs/:runId` | `describe()` the workflow for status/timing, plus the `runStatus` query for in-flight phase. On completion, return the `RunSummary` with its artifact manifest (presigned URLs). |
| `POST /runs/:runId/cancel` | `handle.cancel()` — graceful cancellation, which propagates to `runAgent` and kills the subprocess. Returns `202`. Terminate is deliberately **not** exposed. |

No auth (single trusted local caller — restated as a non-goal). Pino logging with redaction paths configured for prompt/response bodies.

---

## 9. Phased execution

Each phase lists deliverables and the **evidence** required to call it done. No phase is complete on the basis of "it looks right"; each needs captured command output.

### 9.0 E2E gate policy

Every milestone phase ends with a **non-mocked E2E gate**. A gate is not a unit or integration test — it runs the real stack end to end with **zero mocks, zero stubs, zero fakes**:

- real Temporal server (compose, not `TestWorkflowEnvironment`, not time-skipping),
- real PostgreSQL persistence,
- real MinIO artifact store,
- real host workers as separate OS processes,
- real Run API over HTTP on :3300,
- real `opencode run` subprocesses from **Phase 4 onward** (Phases 1–3 gates may use `AGENT_MODE=mock` **only** because the roles do not exist yet; this is stated per gate and expires at Phase 4).

Rules that make the gates meaningful rather than decorative:

- **A gate that has never failed is not trusted.** Each gate must be demonstrated red before green — break the thing it checks, capture the failure, restore, capture the pass. Both transcripts are committed.
- **No gate asserts on its own fixtures.** Assertions read the real Temporal history, the real MinIO object listing, and the real HTTP response — never an in-process value the test itself produced.
- **Gates are the only tests permitted to be slow.** Budget: ≤ 10 min per gate in mock mode, ≤ 30 min with real models.
- **A failing gate blocks the next phase.** No proceeding on a partially-green gate.
- Gate specs live in `e2e/gate-<n>-*.e2e.ts`, run via `make e2e` (all) or `make e2e GATE=n` (one). They are excluded from `make test` so the fast suite stays fast.

| Gate | After phase | Agent mode | Proves |
|---|---|---|---|
| **G1** | 1 — baseline | mock | Stack boots, workflow starts from HTTP, visible in UI |
| **G2** | 3 — durable workflow | mock | Full planner→coder→reviewer chain durable across a real worker kill |
| **G3** | 4 — validation | **real model** | Real agent output survives the deterministic gate; adversarial patches rejected |
| **G4** | 5 — visibility | **real model** | Status/query/cancel work against a live run; subprocess actually dies |
| **G5** | 6 — final | **real model** | All 7 definition-of-done criteria, all 5 failure scenarios |

Additionally, a **Playwright UI gate (`GU`)** runs at Phases 1, 3 and 6 — specified in §9.8.

### Phase 0 — Repo scaffolding *(new; INITIAL implicitly assumes it)*

- pnpm workspace, `tsconfig.base.json` with project references, Biome config, Vitest workspace, Makefile, CI workflow.
- All six packages created with `package.json` + empty `src/index.ts` that compiles.

**Evidence:** `make install && make build && make lint` all exit 0, output captured.

### Phase 1 — Local Temporal baseline

- `infra/temporal/docker-compose.yaml` + `.env` with pinned images.
- `register-search-attributes.sh`.
- Trivial `pingWorkflow` + worker + `POST /runs` stub that starts it.

**Evidence:**
- `docker compose ps` showing all 5 services healthy.
- `temporal operator search-attribute list` showing all 5 custom attributes.
- `curl -X POST localhost:3300/runs` returning a run id, and the corresponding execution visible in the UI at `localhost:8233`.

**Gate G1 (non-mocked, `AGENT_MODE=mock` permitted — no agent roles exist yet):**
`e2e/gate-1-baseline.e2e.ts` drives the real stack:
1. Assert `/health` on the API and gRPC reachability on 7233.
2. `POST /runs` over real HTTP → capture `run_id`.
3. Poll the **Temporal client** (not the API) until `pingWorkflow` closes — asserting against server state, not our own response.
4. Assert the execution's typed search attributes contain the submitted `RunId`, `Repository`, `TaskClass`.
5. Assert the artifact bucket exists in MinIO.
Red-first proof: stop the worker container/process, re-run, capture the timeout failure; restart, capture the pass.

### Phase 2 — Contracts and agent runner

- Zod contracts in `agent-contracts`; `make schemas` generating `schemas/*.json`.
- `agent-runtime` CLI with mock + real modes, `opencode-adapter`, `result-normalizer`.
- `artifact-store` against MinIO.

**Evidence:**
- Unit tests covering: valid output, **malformed JSON**, **subprocess non-zero exit**, **subprocess timeout**, **oversized summary rejection**, **bad artifact URI rejection**. All must be failure-path tests, not happy-path only.
- `make schemas && git diff --exit-code schemas/` proving no drift.
- One real `agent-runtime run --role planner` invocation against `opencode/big-pickle` with captured output.

### Phase 3 — Linear durable workflow

- `agent-run.workflow.ts`, activity options, `initializeRun` / `runAgent` / `publishRunSummary`.
- Both workers running.
- **Replay determinism test** using a recorded history.

**Evidence:**
- End-to-end run in mock mode producing a `RunSummary`.
- Workflow history inspected to prove no patch/log/conversation payloads are present — this is a direct check of INITIAL's state rule, not an assumption.
- Time-skipping tests for retry and timeout paths.
- `Worker.runReplayHistory()` passing against the recorded history.

**Gate G2 (non-mocked stack, `AGENT_MODE=mock` for roles):** `e2e/gate-2-durable.e2e.ts` — start a run via HTTP, wait until history shows the coder activity started, `SIGKILL` the worker process, restart it, assert the workflow still completes and history shows continuation (no re-execution of the planner). Assert history payload sizes are all under the artifact threshold. Red-first: temporarily persist a large payload, prove the size assertion fails.

### Phase 4 — Patch validation

- `agent-tools` workspace/patch/allowlist/checks/secret-scan.
- `validatePatch` on the `tool-validation` queue.
- A small fixture repository for the coder to modify.

**Evidence:**
- Passing run: valid patch → format/lint/test green → `ValidationResult.status = "passed"`.
- **Adversarial runs, all required:** patch escaping the allowlist (`../../etc/passwd`), corrupt diff, patch that breaks tests, artifact containing a planted fake secret. Each must fail with the correct typed error and must not mutate anything outside the ephemeral workspace.
- Proof the workspace is removed after both success and failure.

**Gate G3 (fully non-mocked — real `opencode run` from here on):** `e2e/gate-3-validation.e2e.ts` — a real model produces a real patch against the fixture repo; assert `ValidationResult.status="passed"`, artifacts present in MinIO, fixture repo `git status --porcelain` empty. Then the four adversarial cases, each asserting the correct typed error and an untouched fixture repo.

### Phase 5 — Visibility and controls

- `GET`/`cancel` routes, `runStatus` query, `RunStatus` upserts.
- Presigned artifact URLs in the summary.
- Payload codec interface + identity implementation + AES-GCM behind a flag.
- Pino redaction.

**Evidence:**
- `temporal workflow list --query 'RunStatus="succeeded"'` returning runs.
- A cancellation mid-`runAgent` where the opencode PID is confirmed gone (`ps` before/after) and the workflow ends `CANCELLED`.
- Log capture showing redaction actually applied.

**Gate G4 (fully non-mocked):** `e2e/gate-4-controls.e2e.ts` — start a real-model run; while `runAgent` is live, record the opencode PID from the process table; call `POST /runs/:id/cancel`; assert the PID is gone within the SIGTERM grace window, the workflow closes `CANCELLED`, and partial log artifacts were still flushed to MinIO. Also assert `GET /runs/:id` reports each phase transition and that `temporal workflow list --query 'RunStatus=...'` finds the run.

### Phase 6 — Failure demonstration

The five scenarios INITIAL names, each with captured evidence:

1. **Worker restart mid-run** — `kill -9` the worker during `runAgent`; restart; workflow completes. Show history proving continuation, not restart-from-zero.
2. **Model failure and retry** — force a transient failure; show retry attempts in history and eventual success.
3. **Invalid agent JSON** — show non-retryable failure with exactly one attempt (proving the retry classification works).
4. **Invalid patch** — show `PatchApplyFailed` and a clean workspace.
5. **Failed tests** — show `ValidationResult.status = "failed"`, reviewer still ran, run outcome `failed`.

**Evidence:** a written run log per scenario with exact commands, plus exported workflow histories committed under `docs/evidence/`.

**Gate G5 (final, fully non-mocked):** `e2e/gate-5-final.e2e.ts` — the complete acceptance suite. Executes all five failure scenarios above plus one clean happy-path run, and asserts every one of the seven definition-of-done criteria in §12 programmatically. This gate *is* the definition of done; it must pass in a single uninterrupted invocation on a freshly booted stack (`make down && make up && make e2e GATE=5`).

### 9.8 Playwright UI gate (GU) — Temporal Web UI verification

**Purpose.** The other gates assert against the gRPC API and HTTP responses. That proves the *server* is correct but says nothing about whether a human can actually observe and diagnose a run — which is the reason INITIAL chose Temporal visibility over a bespoke execution database. GU is the only check that the operator-facing surface really works. It is a **manual, agent-driven Playwright session**, not a CI test.

**Why manual and not automated.** Automating assertions against Temporal's UI DOM couples the PoC to a third-party frontend's markup, which will break on every UI upgrade and teach us nothing about our own system. The value here is *observability confirmation*, which is a judgement call best made by looking. So GU is a scripted, repeatable **checklist executed via MCP Playwright**, producing committed screenshots as evidence — not a set of brittle DOM assertions.

**Tooling.** MCP Playwright browser tools (`browser_navigate`, `browser_snapshot`, `browser_find`, `browser_click`, `browser_take_screenshot`). Accessibility snapshots are preferred over pixel screenshots for locating elements; screenshots are captured only as evidence artifacts.

**Preconditions.** Stack up via `make up`; at least one **completed** run, one **failed** run, and one **cancelled** run present (produced by the preceding gate in the same session, so the UI is showing real data from real executions).

**Screenshot output.** Repo-relative `.playwright-mcp/` during the session, then moved to `docs/evidence/ui/phase-<n>/` and committed. Relative paths are required for inline rendering in the session transcript.

#### GU checklist

Executed in order; each step names the observation that must hold and the artifact captured.

| # | Action | Must observe | Artifact |
|---|---|---|---|
| 1 | Navigate `http://localhost:8233` | UI loads, default namespace selected, no error banner | `01-landing.png` |
| 2 | Open the workflows list | The three seeded runs listed with Workflow IDs of the form `agent-run/<ULID>` | `02-list.png` |
| 3 | Filter with the search-attribute query `RunStatus="succeeded"` | Only the completed run returns — proves custom search attributes are registered *and* populated, the Phase 1/5 claim, verified through the operator surface | `03-filter-runstatus.png` |
| 4 | Filter `TaskClass="feature"` | Returns the seeded feature run — proves more than one attribute is genuinely indexed, not just `RunStatus` | `04-filter-taskclass.png` |
| 5 | Open the completed run's detail page | Status `Completed`; all five typed search attributes shown with correct values; start/close times present | `05-detail-summary.png` |
| 6 | Open the Event History (compact view) | Ordered activity sequence visible: `initializeRun` → `runAgent`×3 → `validatePatch` → `publishRunSummary`, with the two distinct task queues (`agent-default`, `tool-validation`) attributed correctly | `06-history-compact.png` |
| 7 | Expand `ActivityTaskCompleted` for the coder | Payload contains **only** summary + `artifact://` refs — **no diff text, no logs, no conversation**. This is the visual confirmation of INITIAL's state rule, checked where a leak would actually be discovered | `07-payload-compact.png` |
| 8 | Open the failed run; inspect its failure event | Typed error name visible (e.g. `PatchApplyFailed`) with a readable message; attempt count matches the retry policy (1 for non-retryable) | `08-failure.png` |
| 9 | Open the cancelled run | Status `Cancelled`; history shows `ActivityTaskCancelRequested` **and** the activity's own cancellation completion — proving graceful cancellation propagated rather than the workflow simply abandoning the activity | `09-cancelled.png` |
| 10 | Open the Workers / task queue view | Pollers present on `agent-default` and `tool-validation`; **`external-action` has zero pollers** — the structural block from §6.1 confirmed visually | `10-workers.png` |
| 11 | `browser_console_messages` (level `error`) | No console errors that indicate a broken UI/server interaction | pasted into the log |

#### Failure conditions

GU **fails** — and blocks the phase — if any of the following, each of which maps to a real defect rather than cosmetics:

- Search-attribute filters (steps 3–4) return nothing → attributes registered but never upserted, i.e. §4.2 is broken.
- Step 7 shows any large payload → the artifact-offloading rule is violated and workflow history will eventually blow up.
- Step 9 lacks activity-level cancellation events → the subprocess-kill path is not actually wired, contradicting G4.
- Step 10 shows pollers on `external-action` → the PoC's hard boundary against external actions has been breached.

#### Schedule

| Phase | Steps run | Rationale |
|---|---|---|
| 1 | 1, 2, 10 | Confirm the UI is reachable and workers register on the right queues before building on it |
| 3 | 1–7, 10 | First point at which a full activity chain and real payloads exist to inspect |
| 6 | 1–11 (full) | Final acceptance; all three run outcomes exist |

The Phase 6 execution of GU is a **required artifact of the definition of done** (§12, criterion 6): the committed screenshot set is the evidence that run status and artifacts are genuinely observable, not merely returned by an endpoint we also wrote.

### Phase 7 — Deferred spikes *(explicitly outside the definition of done)*

- TypeScript 6/7 upgrade attempt with Temporal's webpack bundler.
- Containerising the worker.
- Redis/Postgres-backed quota activity with leases and per-user budgets.
- `agent-expensive` queue with a real second worker fleet.

---

## 10. Testing strategy

Per the 50/30/20 pyramid:

- **Unit (~50%)** — contract validation, result normalisation, allowlist matching, patch parsing, secret scanning, artifact URI handling, prompt composition. Pure functions, no mocks needed.
- **Integration (~30%)** — activities against real MinIO and a real ephemeral git workspace; `agent-runtime` against a **stub opencode binary** (a real script on `PATH` that emits controlled JSON/exit codes — a fake binary, not a mocked module, so the actual spawn/parse path is exercised); workflows under `TestWorkflowEnvironment`.
- **E2E (~20%)** — full stack, **no mocks**: real Temporal, real PostgreSQL, real MinIO, real host workers, real HTTP, and from Phase 4 onward real `opencode run`. These are gates **G1–G5** (§9.0), one per milestone rather than a single suite at the end, so a broken foundation is caught at the phase that introduced it instead of during final acceptance. Slow, expensive, deliberately adversarial.
- **Manual UI verification** — gate **GU** (§9.8), an agent-driven MCP Playwright checklist against the Temporal Web UI at Phases 1, 3, and 6, producing committed screenshot evidence. Not automated, not in CI, and deliberately not asserting on Temporal's DOM.

Determinism regression via replay tests is treated as a required gate, not an optional extra: any workflow code change must replay recorded histories cleanly.

**CI split.** `make test` (unit + integration, mock/stub only) runs on every push and must stay under ~2 minutes. `make e2e` runs on demand and at phase boundaries; it is never a pull-request blocker because it needs the full stack and real model spend. `make e2e-ui` is manual only.

---

## 11. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| TS 6/7 incompatible with Temporal's bundler | Build breaks | Pin TS 5.9.3; isolate the upgrade to a Phase 7 spike. |
| Search attributes unregistered | Workflow start fails at runtime | Idempotent registration script wired into `make up`; Phase 1 evidence requires listing them. |
| opencode subprocess survives cancellation | Orphaned processes, wasted spend | Heartbeat + `WAIT_CANCELLATION_COMPLETED` + SIGTERM/SIGKILL; Phase 5 evidence requires PID verification. |
| Payload bloat in workflow history | History size limits, slow replay | Schema-level caps on `summary`; artifact-refs-only rule; Phase 3 evidence inspects real history. |
| Memory pressure (7.3 GiB host) | Swap thrash, flaky E2E | Activity concurrency 1; monitor during Phase 6. |
| Non-deterministic workflow edits | Silent corruption of in-flight runs | Replay tests as a required gate. |
| `--auto` permission bypass | Agent acts outside sandbox | `--auto` used only with `--dir <ephemeral workspace>`; allowlist checked before patch application; no worker on `external-action`. |
| Real-model cost during E2E | Budget overrun | Mock mode for unit/integration and gates G1–G2; real models only in G3–G5; per-run invocation cap. |
| Gates pass without ever being sensitive | False confidence | §9.0 red-first rule: every gate committed with a failure transcript. |
| Temporal UI markup drift breaks GU | Wasted debugging | GU is a manual checklist driven by accessibility snapshots, not DOM assertions; UI image pinned to 2.53.3. |
| Encrypting payload codec hides payloads from GU step 7 | Loss of the strongest history-bloat check | GU runs under the identity codec; limitation documented in §9.8, codec server deferred to Phase 7. |

---

## 12. Definition of done

INITIAL's criteria, restated as binary checks with named evidence:

| # | Criterion | Evidence |
|---|---|---|
| 1 | All agent turns run through Node workers and `opencode run` | Gate G5 + Phase 6 real-model run log |
| 2 | Survives a worker restart without losing progress | Gate G2 + G5 scenario 1 history export |
| 3 | Compact upstream state passed between roles | Gate G2 payload-size assertion + GU step 7 screenshot |
| 4 | Full outputs stored as artifacts | Gate G3 MinIO listing for a completed run |
| 5 | Deterministic validation before review | Gate G3 adversarial suite |
| 6 | Status, cancellation, artifacts exposed via Run API | Gate G4 + GU steps 3–9 screenshot set |
| 7 | No target-repository mutation or external action | Gate G3 `git status --porcelain` empty; GU step 10 showing zero pollers on `external-action` |

The PoC is complete only when all seven have captured, reproducible evidence committed under `docs/evidence/`, **and** gates G1–G5 pass on a freshly booted stack, **and** the full GU checklist has been executed at Phase 6 with screenshots committed under `docs/evidence/ui/phase-6/`. Partial completion is not completion.
