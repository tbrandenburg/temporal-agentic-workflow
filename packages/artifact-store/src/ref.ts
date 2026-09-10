/**
 * `artifact://` URI parse/format helpers, per PLAN §2 + §3.2.
 *
 * Format: artifact://runs/<run_id>/<role>/<name>
 *
 * `ARTIFACT_URI_PATTERN` intentionally duplicates the exact regex used by
 * `@poc/agent-contracts`' `agentResultSchema` refinement (see that
 * package's `src/artifact-ref.ts` comment) — `agent-contracts` must not
 * depend on `artifact-store`, so only the minimal constant is duplicated,
 * not the parsing logic.
 */
export const ARTIFACT_URI_PATTERN = /^artifact:\/\/runs\/[^/]+\/[^/]+\/[^/]+$/;

export interface ArtifactRefParts {
  runId: string;
  role: string;
  name: string;
}

export class InvalidArtifactRefError extends Error {
  constructor(ref: string) {
    super(`invalid artifact ref: ${ref}`);
    this.name = 'InvalidArtifactRefError';
  }
}

/** Parses `artifact://runs/<run_id>/<role>/<name>` into its parts. */
export function parseArtifactRef(ref: string): ArtifactRefParts {
  if (!ARTIFACT_URI_PATTERN.test(ref)) {
    throw new InvalidArtifactRefError(ref);
  }
  const withoutScheme = ref.slice('artifact://runs/'.length);
  const [runId, role, name] = withoutScheme.split('/');
  if (!runId || !role || !name) {
    throw new InvalidArtifactRefError(ref);
  }
  return { runId, role, name };
}

/** Formats parts into the canonical `artifact://runs/<run_id>/<role>/<name>` URI. */
export function formatArtifactRef(parts: ArtifactRefParts): string {
  return `artifact://runs/${parts.runId}/${parts.role}/${parts.name}`;
}

/** The S3 object key equivalent of an artifact ref, e.g. `runs/<run_id>/<role>/<name>`. */
export function artifactRefToObjectKey(ref: string): string {
  const { runId, role, name } = parseArtifactRef(ref);
  return `runs/${runId}/${role}/${name}`;
}
