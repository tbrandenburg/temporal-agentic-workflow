import { z } from 'zod';
import { agentResultSchema } from './agent-result';
import { artifactRefSchema } from './artifact-ref';
import { validationResultSchema } from './validation-result';

const runOutcomeSchema = z.enum(['succeeded', 'failed', 'cancelled']);

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
 * (PLAN §5.1), inferred from the workflow shape: results/refs for every
 * role plus validation, and the artifact manifest called out in §8.
 */
export const runSummarySchema = z.object({
  run_id: z.string().min(1),
  status: runOutcomeSchema,
  plan: agentResultSchema,
  code: agentResultSchema,
  validation: validationResultSchema,
  review: agentResultSchema,
  artifact_manifest: z.array(artifactManifestEntrySchema),
});

export type RunSummary = z.infer<typeof runSummarySchema>;
