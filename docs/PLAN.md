# Implementation Plan — Temporal Agentic Workflow PoC

Derived from [INITIAL.md](INITIAL.md). This document turns the PoC brief into an executable plan with pinned versions, concrete file-by-file deliverables, and per-phase acceptance evidence.

**Status:** planning complete, implementation not started.
**Last verified against upstream releases:** 2026-09-09.

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
├── prompts/
│   ├── planner.md
│   ├── coder.md
│   └── reviewer.md
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
make test       # vitest unit + integration
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

### Phase 4 — Patch validation

- `agent-tools` workspace/patch/allowlist/checks/secret-scan.
- `validatePatch` on the `tool-validation` queue.
- A small fixture repository for the coder to modify.

**Evidence:**
- Passing run: valid patch → format/lint/test green → `ValidationResult.status = "passed"`.
- **Adversarial runs, all required:** patch escaping the allowlist (`../../etc/passwd`), corrupt diff, patch that breaks tests, artifact containing a planted fake secret. Each must fail with the correct typed error and must not mutate anything outside the ephemeral workspace.
- Proof the workspace is removed after both success and failure.

### Phase 5 — Visibility and controls

- `GET`/`cancel` routes, `runStatus` query, `RunStatus` upserts.
- Presigned artifact URLs in the summary.
- Payload codec interface + identity implementation + AES-GCM behind a flag.
- Pino redaction.

**Evidence:**
- `temporal workflow list --query 'RunStatus="succeeded"'` returning runs.
- A cancellation mid-`runAgent` where the opencode PID is confirmed gone (`ps` before/after) and the workflow ends `CANCELLED`.
- Log capture showing redaction actually applied.

### Phase 6 — Failure demonstration

The five scenarios INITIAL names, each with captured evidence:

1. **Worker restart mid-run** — `kill -9` the worker during `runAgent`; restart; workflow completes. Show history proving continuation, not restart-from-zero.
2. **Model failure and retry** — force a transient failure; show retry attempts in history and eventual success.
3. **Invalid agent JSON** — show non-retryable failure with exactly one attempt (proving the retry classification works).
4. **Invalid patch** — show `PatchApplyFailed` and a clean workspace.
5. **Failed tests** — show `ValidationResult.status = "failed"`, reviewer still ran, run outcome `failed`.

**Evidence:** a written run log per scenario with exact commands, plus exported workflow histories committed under `docs/evidence/`.

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
- **E2E (~20%)** — full stack, no mocks: real Temporal, real MinIO, real workers, real `opencode run`. These are the Phase 6 scenarios. Slow, expensive, and deliberately adversarial.

Determinism regression via replay tests is treated as a required gate, not an optional extra: any workflow code change must replay recorded histories cleanly.

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
| Real-model cost during E2E | Budget overrun | Mock mode everywhere except Phase 6; per-run invocation cap. |

---

## 12. Definition of done

INITIAL's criteria, restated as binary checks with named evidence:

| # | Criterion | Evidence |
|---|---|---|
| 1 | All agent turns run through Node workers and `opencode run` | Phase 6 real-model run log |
| 2 | Survives a worker restart without losing progress | Phase 6 scenario 1 history export |
| 3 | Compact upstream state passed between roles | Phase 3 history inspection |
| 4 | Full outputs stored as artifacts | MinIO listing for a completed run |
| 5 | Deterministic validation before review | Phase 4 adversarial suite |
| 6 | Status, cancellation, artifacts exposed via Run API | Phase 5 curl transcripts |
| 7 | No target-repository mutation or external action | `git status` clean on fixture repo post-run; no worker registered on `external-action` |

The PoC is complete only when all seven have captured, reproducible evidence committed under `docs/evidence/`. Partial completion is not completion.
