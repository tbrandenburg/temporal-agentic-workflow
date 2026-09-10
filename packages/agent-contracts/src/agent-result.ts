import { z } from 'zod';
import { artifactRefSchema } from './artifact-ref';

/**
 * A step identifier / agent label — free-form (not restricted to
 * planner/coder/reviewer) so any pipeline step can be run generically by
 * `runAgent`. Kept as `agentRoleSchema`/`AgentRole` for minimal diff since
 * many files reference these names.
 */
export const agentRoleSchema = z.string().min(1);
export type AgentRole = z.infer<typeof agentRoleSchema>;

const agentResultStatusSchema = z.enum(['success', 'failure']);

const agentResultMetricsSchema = z.object({
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  exit_code: z.number().int(),
});

const agentResultErrorSchema = z.object({
  kind: z.string().min(1),
  message: z.string().min(1),
});

/**
 * AgentResult — the compact object every role emits, per PLAN §3.2.
 *
 * Hard rule enforced here (not just documented): `summary` is capped at
 * 2 KiB and every `artifact_refs` value must match the `artifact://` URI
 * pattern. This is what keeps full patches/logs/conversations structurally
 * out of workflow history.
 */
export const agentResultSchema = z.object({
  run_id: z.string().min(1),
  agent: agentRoleSchema,
  status: agentResultStatusSchema,
  summary: z.string().max(2048, 'summary must be capped at 2 KiB'),
  confidence: z.number().min(0).max(1),
  artifact_refs: z.record(z.string(), artifactRefSchema),
  metrics: agentResultMetricsSchema,
  error: agentResultErrorSchema.optional(),
});

export type AgentResult = z.infer<typeof agentResultSchema>;
