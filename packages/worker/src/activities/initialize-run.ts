import { randomUUID } from 'node:crypto';
import type { PipelineDefinition, RunContext, TaskRequest } from '@poc/agent-contracts';
import { runContextSchema } from '@poc/agent-contracts';
import { registry } from '../../../../pipelines/registry';

/**
 * Thrown when `task.pipeline` doesn't match any entry in the `pipelines/registry.ts`
 * registry. Non-retryable — retrying with the same unknown pipeline name can never
 * succeed (see `nonRetryableErrorTypes` for the `initializeRun` proxy in
 * `packages/workflows/src/activity-options.ts`).
 */
export class UnknownPipelineError extends Error {
  constructor(pipeline: string) {
    super(`unknown pipeline: ${pipeline}`);
    this.name = 'UnknownPipelineError';
  }
}

export interface InitializeRunResult {
  context: RunContext;
  pipeline: PipelineDefinition;
}

/**
 * `initializeRun` — PLAN §5.1/§5.3. Builds the compact `RunContext` threaded
 * through every subsequent activity, and resolves the requested pipeline
 * from the static registry (PLAN Step 1) so the workflow gets both in one
 * activity call. Idempotent: re-running with the same `TaskRequest` (e.g. on
 * activity retry) produces the same result, deriving `run_id` from the
 * input rather than any local state.
 */
export async function initializeRun(task: TaskRequest): Promise<InitializeRunResult> {
  const pipeline = registry[task.pipeline];
  if (!pipeline) {
    throw new UnknownPipelineError(task.pipeline);
  }

  const context: RunContext = {
    run_id: task.run_id ?? randomUUID(),
    repository: task.repository,
    pipeline: task.pipeline,
    task_class: task.task_class,
    instruction: task.instruction,
    ...(task.requested_model !== undefined ? { requested_model: task.requested_model } : {}),
    ...(task.allowed_paths !== undefined ? { allowed_paths: task.allowed_paths } : {}),
  };

  return { context: runContextSchema.parse(context), pipeline };
}
