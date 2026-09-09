# Temporal Agentic Workflow

Proof of concept for running an agentic pipeline (planner → coder → deterministic validation → reviewer) as a durable Temporal workflow, orchestrated by Node workers that invoke `opencode run`.

See [docs/INITIAL.md](docs/INITIAL.md) for the full plan.

## Status

Early PoC. No PRs, repository writes, or deployments are performed by this workflow yet.

## Layout

- `apps/run-api` — starts and queries Temporal workflows
- `packages/workflows` — Temporal workflow definitions
- `packages/worker` — Node worker and Activity implementations
- `packages/agent-runtime` — opencode adapter and role runner
- `packages/agent-contracts` — shared types and JSON schemas
- `packages/agent-tools` — deterministic patch/lint/test helpers
- `prompts` — role prompts (planner, coder, reviewer)
- `infra/temporal` — local Temporal stack (Docker Compose)
- `schemas` — JSON schemas for task/agent input/result
