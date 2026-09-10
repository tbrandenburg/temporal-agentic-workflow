import { z } from 'zod';
import { agentResultSchema, agentRoleSchema } from './agent-result';
import { validationResultSchema } from './validation-result';

/**
 * RunContext — the minimal per-run context threaded through every agent
 * activity invocation. PLAN §5.1 shows the workflow spreading
 * `{ ...context, upstream: [...] }`, so this is intentionally small: enough
 * to reconstruct the ephemeral workspace and prompt, nothing that grows
 * with each role.
 */
export const runContextSchema = z.object({
  run_id: z.string().min(1),
  repository: z.string().min(1),
  pipeline: z.string().min(1),
  task_class: z.enum(['feature', 'bugfix', 'refactor', 'chore']),
  instruction: z.string().min(1).max(8000),
  requested_model: z.string().min(1).optional(),
  allowed_paths: z.array(z.string().min(1)).optional(),
});

export type RunContext = z.infer<typeof runContextSchema>;

/**
 * AgentInput — the argument shape for the `runAgent` activity, per PLAN §5.1
 * (`agentActivities.runAgent({ role, context, upstream? })`).
 */
/**
 * `upstream` carries prior-role outputs. The reviewer's upstream includes
 * `ValidationResult` alongside the planner/coder `AgentResult`s (PLAN
 * §5.1: `upstream: [plan, code, validation]`), so this is a union rather
 * than `AgentResult[]` alone.
 */
export const agentInputSchema = z.object({
  role: agentRoleSchema,
  context: runContextSchema,
  upstream: z.array(z.union([agentResultSchema, validationResultSchema])).optional(),
  /** Project-relative (repo-root-relative) path to this step's prompt markdown file. */
  promptFile: z.string().min(1),
  /** Whether this step produces a patch artifact (workspace seeding, `git diff` capture). */
  producesPatch: z.boolean().optional(),
  /** Per-step override: force this step's `opencode` invocation to mock mode. */
  dryRun: z.boolean().optional(),
});

export type AgentInput = z.infer<typeof agentInputSchema>;
