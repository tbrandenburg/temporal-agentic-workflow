No further clarification is needed—the earlier choices transfer cleanly. Here, Temporal owns the run’s durable state and execution semantics; Node workers own opencode run; artifact storage holds large outputs.

PoC goal

Prove a locally deployed Temporal workflow that accepts an API task and runs:

planner → coder → deterministic validation → reviewer → artifact bundle

The initial version publishes a structured result and artifacts only. It does not create PRs, write to target repositories, or deploy.

Temporal is a better fit for API-originated work because a workflow can start directly from a request—no carrier Git change is needed. Its durable execution model resumes a workflow after worker or infrastructure failures. Temporal documentation⁠￼

Monorepo layout

repo/
├── apps/
│   └── run-api/                       # starts and queries Temporal workflows
├── packages/
│   ├── workflows/                     # deterministic Temporal workflow definitions
│   ├── worker/                        # Node worker and Activity implementations
│   ├── agent-runtime/                 # opencode adapter and role runner
│   ├── agent-contracts/               # shared types and JSON schemas
│   └── agent-tools/                   # deterministic patch/lint/test helpers
├── prompts/
│   ├── planner.md
│   ├── coder.md
│   └── reviewer.md
├── infra/
│   └── temporal/
│       └── docker-compose.yaml         # Temporal, Postgres, UI, Worker
├── schemas/
│   ├── task-request.schema.json
│   ├── agent-input.schema.json
│   └── agent-result.schema.json
└── docs/
    └── poc-temporal.md

Architecture

flowchart TD
    API["Run API"] --> WF["Temporal workflow"]
    WF --> P["Planner activity"]
    P --> C["Coder activity"]
    C --> V["Validation activity"]
    V --> R["Reviewer activity"]
    R --> O["Artifact store + run summary"]

Use one workflow execution per request:

Workflow ID: agent-run/<run_id>
Task queue: agent-default

Add searchable metadata such as run_id, repository, workflow status, requested model, and task class. This makes runs discoverable through Temporal visibility APIs rather than a bespoke execution database.

Workflow model

The workflow is pure orchestration. It must not call opencode, read files, or make network requests directly; those are Activities handled by workers.

export async function agentRunWorkflow(task: TaskRequest): Promise<RunSummary> {
  const context = await activities.initializeRun(task);
  const plan = await activities.runAgent({
    role: "planner",
    context,
  });
  const code = await activities.runAgent({
    role: "coder",
    context: { ...context, upstream: [plan] },
  });
  const validation = await activities.validatePatch({
    context,
    coderResult: code,
  });
  const review = await activities.runAgent({
    role: "reviewer",
    context: { ...context, upstream: [plan, code, validation] },
  });
  return activities.publishRunSummary({ context, plan, code, validation, review });
}

Configure Activity timeouts and retries explicitly. Activities should be idempotent because Temporal may retry them after failures. Temporal’s Activity guidance⁠￼

Node activity worker

The worker package registers these Activities:

* initializeRun
* runAgent
* validatePatch
* publishRunSummary

runAgent invokes the shared agent runtime:

agent-runtime run \
  --role coder \
  --input /tmp/agent-input.json \
  --output /tmp/agent-result.json \
  --prompt prompts/coder.md \
  --model "${AGENT_MODEL:-opencode/big-pickle}"

The runtime will:

1. validate its input manifest;
2. compose the role prompt;
3. call opencode run;
4. capture stdout, stderr, and timing data;
5. normalize output into the shared result schema;
6. publish large artifacts and return their references;
7. fail if the result is invalid or incomplete.

Start with opencode/big-pickle as the default, but accept the model through worker configuration or an approved task field.

State and artifacts

Use Temporal workflow state for small, decision-relevant data; use object storage or an artifact service for full outputs.

{
  "run_id": "01...",
  "agent": "coder",
  "status": "success",
  "summary": "Implemented health-check endpoint.",
  "confidence": 0.82,
  "artifact_refs": {
    "result": "artifact://runs/01/coder/result.json",
    "patch": "artifact://runs/01/coder/patch.diff",
    "logs": "artifact://runs/01/coder/logs.txt"
  }
}

Do not put full conversations, patches, or logs into workflow payloads. Keep only compact summaries and artifact references in history. If sensitive workflow payloads become necessary, use a payload codec rather than leaving plaintext in Temporal visibility/history. Temporal payload codec guidance⁠￼

Deterministic validation

validatePatch is a normal Activity, separate from all model reasoning. It should:

* validate result JSON;
* apply the patch in an ephemeral workspace;
* enforce file-path allowlists;
* run formatter, lint, and focused tests;
* scan artifacts for secrets;
* publish machine-readable validation output.

The reviewer sees the deterministic results, but cannot override a failed validation step.

Runtime controls

Use distinct task queues and worker pools:

Queue	Purpose	Initial control
agent-default	planner, coder, reviewer	low worker concurrency
agent-expensive	future premium-model calls	dedicated worker fleet / capped concurrency
tool-validation	lint, test, patch checks	separate deterministic workers
external-action	future PR/deploy steps	disabled in this PoC

Temporal task queues route work to the appropriate worker fleet; Activities are registered and executed through those queues. Temporal Activity documentation⁠￼

For global model budgets, implement a small quota Activity backed by Redis/Postgres or a provider-aware rate limiter. Unlike Zuul semaphores, this is application-owned policy, but it can support leases, retries, per-model quotas, and user-level budgets.

API surface

The Run API should expose:

POST /runs
GET  /runs/:runId
POST /runs/:runId/cancel

POST /runs starts agentRunWorkflow with workflowId = agent-run/<run_id>. GET queries workflow status and returns the final artifact manifest. Cancellation should request Temporal workflow cancellation and allow the worker to stop any active opencode subprocess cleanly.

The Run API listens on port 3300 by default (configurable via PORT), avoiding collision with other local services commonly bound to 3000.

Implementation phases

1. Local Temporal baseline
    * Start Temporal, PostgreSQL, Temporal UI, Run API, and one Node worker through Docker Compose.
    * Start and inspect a trivial workflow from the API.
2. Contracts and agent runner
    * Define task, input, and result schemas.
    * Build the opencode run adapter with mock and real-model modes.
    * Test timeouts, malformed output, and subprocess failure.
3. Linear durable workflow
    * Implement planner → coder → reviewer orchestration.
    * Persist only summaries and artifact references in workflow state.
    * Add retries and idempotency keys to each Activity.
4. Patch validation
    * Let coder produce a patch artifact.
    * Apply it only in an ephemeral workspace.
    * Run deterministic formatting, linting, and tests before review.
5. Run visibility and controls
    * Add API status/query/cancel endpoints.
    * Add search attributes, artifact links, timeouts, rate budgets, and log redaction.
6. Failure demonstration
    * Demonstrate worker restart mid-run, model failure/retry, invalid agent JSON, invalid patch, and failed tests.
    * Verify the workflow resumes or fails with a clear durable audit trail.

Definition of done

The PoC is complete when an API request creates one durable Temporal execution that:

* runs all agent turns through Node workers and opencode run;
* survives a worker restart without losing workflow progress;
* passes compact upstream state between roles;
* stores full outputs as artifacts;
* validates code deterministically before review;
* exposes status, cancellation, and final artifacts through the Run API;
* performs no target-repository mutation or external action.
