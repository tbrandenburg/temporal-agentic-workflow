# PROJECTS.md — Core/Pipeline Refactor Plan

**Status:** Implemented (as of 2026-09-10) — Steps 0–8 below are done. Evidence:
`make build` clean, `pnpm exec vitest run` → 25 test files / 121 tests passed,
`make schemas && git diff --exit-code schemas/` clean. See the "Implementation
evidence" note at the end of each step for what changed. Deviations from the
literal step text (all coordinator-approved, necessary for genericity) are
called out inline.

## Goal

Refactor the codebase from "one hardcoded planner→coder→validate→reviewer
workflow" towards:

- **Core** (`packages/workflows`, `packages/worker`, `packages/agent-runtime`,
  `packages/agent-contracts`): a generic pipeline interpreter and a generic
  "agent node" that takes any prompt/context/upstream and runs it. No
  pipeline-specific knowledge (role names, prompt filenames, step counts)
  lives here.
- **Project-specific** (`pipelines/`): an open-ended, declarative list of
  named pipelines, each defining its own steps, agents, and prompts. Adding
  pipeline N+1 requires zero core changes.

Multiple pipelines must be possible from day one (not a later extension),
and every agent node must support a per-step **dry-run** override, because
`opencode` is currently rate-limited and real-mode verification must be
bounded and explicit.

## Findings from current-state exploration

- `agent-run.workflow.ts` (53 lines) hardcodes one pipeline:
  `initializeRun → runAgent(planner) → runAgent(coder) → validatePatch →
  runAgent(reviewer) → publishRunSummary`. Roles, sequencing, and upstream
  wiring are all inline TypeScript.
- `runAgent` (`packages/worker/src/activities/run-agent.ts`) is already
  fairly generic — takes `{ role, context, upstream }`, composes a prompt,
  spawns `opencode run`, normalizes output. The only role-specific branch is
  `isCoder` (workspace seeding + `git diff` → patch artifact).
- `composePrompt` (`agent-runtime/prompt-composer.ts`) is already generic:
  reads `prompts/<role>.md` by role name and appends context/upstream
  sections. The three prompt files (`planner.md`, `coder.md`, `reviewer.md`)
  are the only per-agent "personality" content.
- `agentInputSchema`'s `role` is a fixed `agentRoleSchema` enum
  (planner/coder/reviewer) — the main hard constraint against generic reuse,
  not the runtime.
- `activity-options.ts` hardcodes 4 proxied activities with fixed
  timeouts/retries per role-group, not per declared step.
- `validatePatch` is a genuinely special, non-generic activity
  (deterministic gate, own `tool-validation` queue) — must **not** be folded
  into the generic agent node.
- `TaskRequest`/`RunContext` currently have no pipeline concept.
  `initializeRun` is a pure, deterministic mapping — safe to extend.
- `resolveAgentMode` (`agent-runtime/modes.ts`) is a single global
  `AGENT_MODE` env switch (`mock`/`real`) — too coarse for "validate my new
  pipeline's plumbing without hitting a rate-limited API while other
  pipelines still run for real."

Conclusion: the codebase is already ~70% of the way there. The *execution*
layer (runAgent, composePrompt, opencode-adapter) is generic. What's
hardcoded is the *pipeline definition* (workflow function body) and the
*role vocabulary* (enum + fixed prompt filenames + fixed proxy configs).

## Step-by-step plan

### Step 0 — Pipeline registry as the seam
- Add `packages/agent-contracts/src/pipeline-definition.ts`:
  - `pipelineStepSchema`: `{ id: string; kind: 'agent' | 'validation';
    promptFile?: string; upstream?: string[]; producesPatch?: boolean;
    dryRun?: boolean }`
  - `pipelineDefinitionSchema`: `{ name: string; steps: PipelineStep[] }` —
    validate: unique step ids, `upstream` ids must reference earlier steps,
    exactly the fields the interpreter needs, nothing else (YAGNI).
- `TaskRequest` gets a **required** `pipeline: z.string().min(1)` field (no
  silent default — forces every caller to be explicit about which pipeline
  runs).
- `RunContext` gets `pipeline: string` too (carried through, same
  idempotency rules as today).

### Step 1 — Pipeline registry lookup (worker-side, still pure)
- New `pipelines/registry.ts`: a plain `Record<string, PipelineDefinition>`
  built from statically imported definitions. No filesystem
  scanning/dynamic I/O — keeps it synchronous and testable, and keeps
  `initializeRun` free of async directory reads.
- `initializeRun` activity: looks up `registry[task.pipeline]`; throws a new
  non-retryable `UnknownPipelineError` if missing (add to
  `nonRetryableErrorTypes`). Returns `{ context, pipeline }` so there's one
  lookup, one activity call.
- Decision point: keep `pipelines/` as a plain top-level directory imported
  directly by `packages/worker` (simplest, matches KISS), or promote to a
  proper pnpm workspace package (`packages/pipelines`) only if a second
  consumer needs it later. **Recommendation: plain top-level directory for
  the PoC.**

### Step 2 — Generalize prompt loading (agent-runtime)
- Change `readRolePrompt(role)` → `readPromptFile(path: string)` taking an
  explicit path (project-relative), so prompt lookup isn't tied to
  `prompts/<role>.md` naming.
- Prompts live at `pipelines/<pipeline-name>/prompts/<step-id>.md`.
- `composePrompt` keeps its pure signature but takes the resolved prompt
  string, not a hardcoded lookup.

### Step 3 — Generic agent node + per-step dry-run (worker + agent-runtime)
- Refactor `run-agent.ts`'s special-casing: keep `isCoder`-style
  workspace/patch behavior, but drive it from step metadata
  (`producesPatch: true`) instead of a literal `role === 'coder'` string
  check.
- `runAgent` becomes: "given a step id, a prompt, a context, and upstream
  results, run opencode and normalize the result" — no built-in knowledge
  of planner/coder/reviewer.
- **Dry-run:** add `dryRun?: boolean` to `pipelineStepSchema` (done in Step
  0). Resolve effective mode as: `step.dryRun === true ? 'mock' :
  resolveAgentMode(env)`.
  - Global `AGENT_MODE=mock` still forces everything to mock (existing test
    behavior, unchanged — global mode always dominates).
  - Global `AGENT_MODE=real` + a step's `dryRun: true` still returns the
    deterministic fixture for *that* step only — lets a new pipeline's
    wiring (context threading, upstream refs, artifact refs) be validated
    without spawning `opencode` for it, even while other pipelines run
    live. This directly addresses the current `opencode` rate limit.
  - `mockOutput()` in the adapter is already role/step-agnostic (echoes
    prompt length) — no change needed there, just needs to be reachable
    per-step.

### Step 4 — Workflow becomes a pipeline interpreter (workflows)
- `agentRunWorkflow(task: TaskRequest)` signature unchanged. Internally:
  1. `{ context, pipeline } = await agentActivities.initializeRun(task)`.
  2. Interpreter loop iterates `pipeline.steps`, dispatching
     `agentActivities.runAgent` (kind `agent`) or
     `validationActivities.validatePatch` (kind `validation`), collecting
     results in a `Map<stepId, result>` for upstream resolution by id.
  3. Search-attribute status = the current step's `id` (generic), plus a
     final `succeeded`/`failed` derived from the last `validation`-kind
     step's status if one exists, else always `succeeded` on completion (a
     pipeline with no validation step has no hard gate — a valid shape, not
     a bug).
- Must remain pure: no file I/O, network, `Date.now()`/`Math.random()` in
  workflow code — pipeline resolution happens inside the `initializeRun`
  activity, not the workflow.
- This one workflow function serves **every** pipeline; nothing
  pipeline-specific lives in `packages/workflows`.

### Step 5 — Ship ≥2 pipelines from day one, dry-run by default
- `pipelines/coding-review/` — the migrated existing
  planner→coder→validate→reviewer pipeline (proves no regression).
- `pipelines/summarizer-critic/` (or similar) — a second, genuinely
  different pipeline: 2 steps (`summarizer → critic`), no validation step,
  no patch production. Deliberately *not* code-related, so it can't
  accidentally reuse coder-specific branches. Proves the interpreter is
  real, not accidentally coupled to 4 steps/coder-patch semantics.
- Both pipelines' steps are authored with `dryRun: true` initially — the
  honest state today, given the `opencode` rate limit. Flipping a step's
  `dryRun` to `false` is the explicit, auditable signal that "this step has
  been verified against real `opencode`."
- Each pipeline gets its own `pipeline.ts` + `prompts/*.md` — no shared
  prompt directory assumptions. Existing `prompts/*.md` move under
  `pipelines/coding-review/prompts/`.

### Step 5b — Run API surface for pipeline selection
- `apps/run-api` validates against `taskRequestSchema` directly — with
  `pipeline` now required, `POST /runs` callers must pass it.
- Add `GET /pipelines` listing registry keys, so manual/E2E testing doesn't
  require reading source to know valid pipeline names.

### Step 6 — Update activity-options / proxy configs
- Keep one shared `runAgent` proxy config for all agent-kind steps
  (simplest, matches current single 20-min/heartbeat config). Only add
  per-step timeout/retry overrides if a real pipeline needs them —
  don't overengineer speculatively.

### Step 7 — Tests
- Update/regenerate `packages/workflows/src/__tests__/replay.test.ts`
  fixture for `coding-review` against the new pipeline-interpreter workflow
  (intentional behavior change — regenerate deliberately via
  `generate-replay-fixture.ts`, per repo convention). The second pipeline
  gets its own fixture too.
- Add a unit test: pipeline interpreter with a trivial synthetic fake
  pipeline (not `coding-review`), proving the interpreter's core logic is
  generic.
- Add an integration test that runs the **real second pipeline**
  (`summarizer-critic`) end-to-end under `TestWorkflowEnvironment` with
  `AGENT_MODE=mock` — proves two independently-defined pipelines execute
  through the same workflow/activities with zero code changes between
  them. This is the actual regression guard against "generic in name
  only."
- Add a unit test: a step with `dryRun: false` under global
  `AGENT_MODE=mock` still gets mock output (global mode always dominates —
  no accidental live call in CI regardless of pipeline authoring
  mistakes).
- `agent-tools`/`validate-patch` tests remain untouched by this refactor.
- Run `make schemas && git diff --exit-code schemas/` after any contract
  change (CI-equivalent check per repo convention).

### Step 8 — Docs
- Update `README.md` repository-layout table and cross-references in
  `docs/PLAN.md`/`docs/INITIAL.md` to describe the new `pipelines/`
  directory and the core-vs-project-specific split.
- Keep this file (`docs/PROJECTS.md`) updated as the refactor progresses —
  mark steps done with evidence, not just intent.

## Manual E2E test plan (rate-limit aware)

`opencode` is currently rate-limited, so real-mode verification must stay
bounded and explicit. Every step below defaults to `AGENT_MODE=mock`
globally unless stated otherwise.

1. `make up` — bring up Postgres/Temporal/UI/MinIO; confirm all healthy.
2. `make worker` and `make worker-val` in separate terminals
   (`AGENT_MODE=mock`), `make api`.
3. `GET /pipelines` → confirm both `coding-review` and `summarizer-critic`
   are listed.
4. `POST /runs` with `pipeline: "coding-review"` → confirm identical
   behavior/timeline to today in the Temporal Web UI (`:8233`):
   `initializeRun → runAgent(planner) → runAgent(coder) → validatePatch →
   runAgent(reviewer) → publishRunSummary`.
5. `POST /runs` with `pipeline: "summarizer-critic"` → confirm the Temporal
   UI shows a *different*, shorter timeline (`initializeRun →
   runAgent(summarizer) → runAgent(critic) → publishRunSummary`, no
   `validatePatch`) — proves the same workflow code branches correctly per
   pipeline.
6. `POST /runs` with an invalid `pipeline: "does-not-exist"` → confirm
   fast, clear failure (non-retryable `UnknownPipelineError`), not a
   hung/retried run.
7. For `coding-review`: verify `RunSummary` artifact refs resolve in the
   MinIO console (`:9001`) — patch, planner/coder/reviewer summaries. This
   still exercises the full stack honestly in mock mode: Temporal
   orchestration, activity retries/heartbeats, artifact-store puts/gets,
   search attributes, and coder workspace/`git diff` plumbing (mock mode
   still seeds the workspace and runs `git diff`, it just skips the
   subprocess).
8. **Bounded real-mode check:** pick **one single step** in `coding-review`
   (e.g. just `planner`), set `dryRun: false` on it while leaving
   `AGENT_MODE=real` globally and all other steps' `dryRun: true`, and run
   once. This bounds real-API usage to one call instead of a full
   pipeline, respecting the rate limit while still proving the real
   adapter path (subprocess spawn, NDJSON parsing, timeout/cancel wiring)
   isn't dead code.
9. Explicitly log which steps were verified live vs. dry-run for this
   refactor, with a timestamp, under `docs/evidence/` — per the repo's
   accountability convention — so real-mode coverage is clearly partial
   until the rate limit clears.
10. Failure-mode smoke test: force a validation failure (bad allowlist
    path) on `coding-review`, confirm the reviewer still runs but the
    workflow status ends `failed` — proving the generic interpreter didn't
    break the "reviewer can't override the gate" guarantee. Mock-only —
    doesn't depend on model output quality.
11. `make stop && make down`.

**Evidence honesty note:** do not claim "verified working end-to-end with
real opencode" for the new multi-pipeline interpreter — only "verified
working in mock mode + one bounded live call per pipeline," clearly
labeled, until the rate limit is no longer a constraint.

## Implementation notes (2026-09-10)

All steps (0–8) landed on `refactor/pipeline-interpreter`. Notable deviations
from the literal step text above, each made deliberately to keep the
interpreter genuinely generic (not just in name) and each verified by the
existing test suite:

- **`RunSummary` generalized** (beyond what Step 4's text says): the fixed
  `plan`/`code`/`validation`/`review` fields were replaced with
  `steps: Record<string, AgentResult | ValidationResult>` keyed by pipeline
  step id, because a fixed 4-field shape cannot represent `summarizer-critic`
  (2 steps, no validation) or any future pipeline with a different shape.
  `publishRunSummary`'s input gained an explicit `status` field, computed
  once by the workflow, instead of re-deriving it from a hardcoded
  `validation` field.
- **`agentRoleSchema` relaxed** from a fixed `enum(['planner','coder','reviewer'])`
  to `z.string().min(1)` — it now means "step identifier / agent label",
  since `AgentInput.role`/`AgentResult.agent` must accept arbitrary step ids
  (e.g. `summarizer`, `critic`, or any future pipeline's step names).
- **`AgentInput` gained `promptFile` (required), `producesPatch` and `dryRun`
  (optional)** — not explicitly listed as `AgentInput` changes in the plan
  text, but required to drive `run-agent.ts` purely from step metadata
  instead of `role === 'coder'`/`readRolePrompt(role)` string conventions.
- **`RunStatus` loosened** from a fixed union of phase names to `string`,
  since the in-flight status is now the current step's `id`, which is
  pipeline-defined and open-ended.
- **`pipelines/registry.ts` and pipeline definitions import `@poc/agent-contracts`
  via a relative path into `packages/agent-contracts/dist`**, not the package
  name — `pipelines/` is a plain TS project (no `package.json`), so it isn't
  wired into pnpm's workspace `node_modules` symlinks; a plain `@poc/agent-contracts`
  import resolves under vitest/tsx (TS-aware loaders) but fails under compiled
  `node dist/...` execution. Verified via
  `node -e "require('./packages/worker/dist/activities/initialize-run.js')"`
  after a clean `tsc -b`.

Verification: `pnpm exec tsc -b` clean repo-wide; `AGENT_MODE=mock pnpm exec vitest run`
→ 25 test files / 121 tests passed, including a synthetic-pipeline interpreter
test (`packages/workflows/src/__tests__/interpreter-generic.test.ts`) and a
real end-to-end `summarizer-critic` run
(`packages/workflows/src/__tests__/summarizer-critic.test.ts`); `make schemas &&
git diff --exit-code schemas/` clean.

