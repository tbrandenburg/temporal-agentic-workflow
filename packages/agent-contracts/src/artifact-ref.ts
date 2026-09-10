import { z } from 'zod';

/**
 * Single source of truth for the `artifact://` URI shape, per PLAN §3.2.
 * Format: artifact://runs/<run_id>/<role>/<name>
 *
 * `@poc/artifact-store` intentionally duplicates this exact pattern (not the
 * parsing logic) as `ARTIFACT_URI_PATTERN` rather than depending on this
 * package, to avoid a contracts -> artifact-store dependency edge.
 */
export const ARTIFACT_URI_PATTERN = /^artifact:\/\/runs\/[^/]+\/[^/]+\/[^/]+$/;

export const artifactRefSchema = z
  .string()
  .regex(ARTIFACT_URI_PATTERN, 'artifact ref must match artifact://runs/<run_id>/<role>/<name>');

export type ArtifactRef = z.infer<typeof artifactRefSchema>;
