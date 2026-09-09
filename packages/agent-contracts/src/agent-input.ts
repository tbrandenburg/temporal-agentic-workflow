import { z } from 'zod';
import { agentResultSchema, agentRoleSchema } from './agent-result';

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
export const agentInputSchema = z.object({
  role: agentRoleSchema,
  context: runContextSchema,
  upstream: z.array(agentResultSchema).optional(),
});

export type AgentInput = z.infer<typeof agentInputSchema>;
