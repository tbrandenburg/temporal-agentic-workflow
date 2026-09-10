import type { AgentResult, RunSummary, ValidationResult } from '@poc/agent-contracts';
import { ArtifactStore, loadArtifactStoreConfigFromEnv } from '@poc/artifact-store';
import type { PublishRunSummaryInput } from '@poc/workflows';

const PRESIGN_TTL_SECONDS = 3600;

function collectArtifactRefs(
  results: readonly (AgentResult | ValidationResult)[],
): Map<string, string> {
  const refs = new Map<string, string>();
  for (const result of results) {
    for (const [name, ref] of Object.entries(result.artifact_refs)) {
      refs.set(`${result.run_id}/${name}`, ref);
    }
  }
  return refs;
}

/**
 * `publishRunSummary` — assembles the terminal `RunSummary` (PLAN §5.1) and
 * presigns every distinct `artifact://` ref collected across every step
 * result into a manifest, per PLAN §8 ("RunSummary with its artifact
 * manifest (presigned URLs)"). No artifacts means no presign calls — the
 * mock-mode Phase 3 evidence run never touches MinIO.
 *
 * Generalized per PLAN Step 4 / this step's documented deviation:
 * `results` is a generic step-id-keyed map (not fixed `plan`/`code`/
 * `validation`/`review` fields), and `status` is passed through explicitly
 * by the workflow (computed once from the last validation-kind step, or
 * `succeeded` if there is none) rather than re-derived here from a
 * hardcoded `validation` field.
 */
export async function publishRunSummary(input: PublishRunSummaryInput): Promise<RunSummary> {
  const { context, results, status } = input;
  const refs = collectArtifactRefs(Object.values(results));

  const artifactManifest: RunSummary['artifact_manifest'] = [];
  if (refs.size > 0) {
    const store = new ArtifactStore(loadArtifactStoreConfigFromEnv());
    for (const ref of refs.values()) {
      const url = await store.presign(ref, PRESIGN_TTL_SECONDS);
      artifactManifest.push({
        ref,
        url,
        expires_at: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString(),
      });
    }
  }

  return {
    run_id: context.run_id,
    status,
    steps: results,
    artifact_manifest: artifactManifest,
  };
}
