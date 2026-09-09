import type { ValidationResult } from '@poc/agent-contracts';
import type { ValidatePatchInput } from '@poc/workflows';

/**
 * `validatePatch` — Phase 3 trivial pass-through stub. `@poc/agent-tools`
 * (workspace/patch/allowlist/checks/secret-scan) does not exist yet; this
 * activity exists solely so the `agent-run` orchestration and the
 * `tool-validation` task queue are real and durable now, and Phase 4
 * replaces the body with the actual deterministic gate from PLAN §7
 * without touching the workflow or its activity options.
 */
export async function validatePatch(input: ValidatePatchInput): Promise<ValidationResult> {
  return {
    run_id: input.context.run_id,
    status: 'passed',
    steps: [],
    violations: [],
    artifact_refs: {},
  };
}
