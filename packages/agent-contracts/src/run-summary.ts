import { z } from 'zod';
import { agentResultSchema } from './agent-result';
import { artifactRefSchema } from './artifact-ref';
import { validationResultSchema } from './validation-result';

export const runOutcomeSchema = z.enum(['succeeded', 'failed', 'cancelled']);
export type RunOutcome = z.infer<typeof runOutcomeSchema>;

/**
 * A presigned-URL manifest entry, per PLAN §8 ("RunSummary with its
 * artifact manifest (presigned URLs)"). `ref` is the durable `artifact://`
 * identity; `url` is the time-limited presigned URL for retrieval.
 */
const artifactManifestEntrySchema = z.object({
  ref: artifactRefSchema,
  url: z.string().url(),
  expires_at: z.string().datetime(),
});

/**
 * RunSummary — the terminal object returned by `publishRunSummary`
 * (PLAN §5.1), plus the artifact manifest called out in §8.
 *
 * DEVIATION from the literal PLAN §5.1/§8 text (coordinator-approved, PLAN
 * Step 4): the original shape hardcoded exactly four named fields (`plan`,
 * `code`, `validation`, `review`) matching the one hardcoded
 * planner->coder->validate->reviewer pipeline. Step 4 turns the workflow
 * into a generic pipeline interpreter that must serve pipelines with
 * different step counts/names/kinds (e.g. a 2-step `summarizer-critic`
 * pipeline with no validation step at all) — a fixed 4-field shape cannot
 * represent that. `steps` is therefore a generic map keyed by the
 * pipeline step's `id` (from `PipelineStep.id`), holding whichever result
 * type that step produced (`AgentResult` for `kind: 'agent'`,
 * `ValidationResult` for `kind: 'validation'`).
 */
export const runSummarySchema = z.object({
  run_id: z.string().min(1),
  status: runOutcomeSchema,
  steps: z.record(z.string(), z.union([agentResultSchema, validationResultSchema])),
  artifact_manifest: z.array(artifactManifestEntrySchema),
});

export type RunSummary = z.infer<typeof runSummarySchema>;
