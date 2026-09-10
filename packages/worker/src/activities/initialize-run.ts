import { randomUUID } from 'node:crypto';
import type { RunContext, TaskRequest } from '@poc/agent-contracts';
import { runContextSchema } from '@poc/agent-contracts';

/**
 * `initializeRun` — PLAN §5.1/§5.3. Builds the compact `RunContext` threaded
 * through every subsequent activity. Idempotent: re-running with the same
 * `TaskRequest` (e.g. on activity retry) produces the same `RunContext`,
 * deriving `run_id` from the input rather than any local state.
 */
export async function initializeRun(task: TaskRequest): Promise<RunContext> {
  const context: RunContext = {
    run_id: task.run_id ?? randomUUID(),
    repository: task.repository,
    task_class: task.task_class,
    instruction: task.instruction,
    ...(task.requested_model !== undefined ? { requested_model: task.requested_model } : {}),
    ...(task.allowed_paths !== undefined ? { allowed_paths: task.allowed_paths } : {}),
  };

  return runContextSchema.parse(context);
}
