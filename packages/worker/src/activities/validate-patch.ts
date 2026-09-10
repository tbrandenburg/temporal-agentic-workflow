import { join } from 'node:path';
import type { AgentResult, ValidationResult } from '@poc/agent-contracts';
import { agentResultSchema } from '@poc/agent-contracts';
import {
  AllowlistViolationError,
  applyPatch,
  createWorkspace,
  DEFAULT_ALLOWED_PATHS,
  enforceAllowlist,
  PatchApplyFailedError,
  runAllChecks,
  scanForSecrets,
} from '@poc/agent-tools';
import { ArtifactStore, loadArtifactStoreConfigFromEnv } from '@poc/artifact-store';
import type { ValidatePatchInput } from '@poc/workflows';

export { AllowlistViolationError, PatchApplyFailedError };

/**
 * The artifact key the coder role's `AgentResult` is expected to publish
 * its unified diff under. Established by this activity — the only place
 * the convention needs to be documented is here and in the coder prompt
 * (`prompts/coder.md`, out of scope for this phase).
 */
const PATCH_ARTIFACT_KEY = 'patch';

/** Duck-typed subset of `ArtifactStore` this activity needs — lets tests inject an in-memory sink. */
export interface ArtifactSink {
  put(runId: string, role: string, name: string, body: string): Promise<string>;
  get(ref: string): Promise<string>;
}

export interface ValidatePatchDeps {
  /** Fixture repository copied into the ephemeral workspace. Defaults to `fixtures/sample-repo`. */
  sourceRepoPath?: string;
  workspaceRoot?: string;
  artifactStore?: ArtifactSink;
  /** Retry attempt, used only for the workspace directory name (`ws-<attempt>`). */
  attempt?: number;
}

const DEFAULT_FIXTURE_REPO_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'sample-repo',
);

class MissingPatchArtifactError extends Error {
  constructor() {
    super(`coder AgentResult is missing a "${PATCH_ARTIFACT_KEY}" artifact ref`);
    this.name = 'MissingPatchArtifactError';
  }
}

class InvalidCoderResultError extends Error {
  constructor(issues: string) {
    super(`coder AgentResult failed schema validation: ${issues}`);
    this.name = 'InvalidCoderResultError';
  }
}

type StepName = ValidationResult['steps'][number]['name'];

interface StepRecord {
  name: StepName;
  status: 'passed' | 'failed';
  durationMs: number;
  outputRef?: string;
}

/**
 * `validatePatch` — the deterministic gate from PLAN §7, run on the
 * `tool-validation` queue. Ordered steps:
 *
 * 1. Schema-validate the coder's `AgentResult`.
 * 2. Create a fresh ephemeral workspace from the fixture repo.
 * 3. Enforce the path allowlist against the patch *before* applying it —
 *    `AllowlistViolationError` (non-retryable).
 * 4. `git apply --check` then `git apply` — `PatchApplyFailedError`
 *    (non-retryable).
 * 5. Run format / lint / test, each captured as a step + artifact.
 * 6. Secret-scan the patch and check output; any hit fails the run.
 *
 * Only steps 3 and 4 throw — matching PLAN §5.2's non-retryable pair.
 * Steps 5 and 6 fail the *result* (`status: 'failed'`) without throwing,
 * since retrying a broken test or a planted secret can never succeed
 * differently. The workspace is always disposed in `finally`, on every
 * exit path.
 */
export async function validatePatch(
  input: ValidatePatchInput,
  deps: ValidatePatchDeps = {},
): Promise<ValidationResult> {
  const { context, coderResult } = input;
  const runId = context.run_id;

  const schemaResult = agentResultSchema.safeParse(coderResult satisfies AgentResult);
  if (!schemaResult.success) {
    throw new InvalidCoderResultError(schemaResult.error.message);
  }

  const patchRef = coderResult.artifact_refs[PATCH_ARTIFACT_KEY];
  if (!patchRef) {
    throw new MissingPatchArtifactError();
  }

  const store = deps.artifactStore ?? new ArtifactStore(loadArtifactStoreConfigFromEnv());
  const patchText = await store.get(patchRef);

  const workspace = await createWorkspace({
    sourceRepoPath: deps.sourceRepoPath ?? DEFAULT_FIXTURE_REPO_PATH,
    runId,
    attempt: deps.attempt ?? 1,
    ...(deps.workspaceRoot ? { workspaceRoot: deps.workspaceRoot } : {}),
  });

  const steps: StepRecord[] = [];
  const violations: ValidationResult['violations'] = [];
  const artifactRefs: Record<string, string> = {};

  try {
    // Step 3 — allowlist, before apply.
    const allowlistStart = Date.now();
    try {
      enforceAllowlist(patchText, context.allowed_paths ?? DEFAULT_ALLOWED_PATHS);
      steps.push({ name: 'allowlist', status: 'passed', durationMs: Date.now() - allowlistStart });
    } catch (error) {
      steps.push({ name: 'allowlist', status: 'failed', durationMs: Date.now() - allowlistStart });
      if (error instanceof AllowlistViolationError) {
        violations.push({ step: 'allowlist', severity: 'error', message: error.message });
      }
      throw error;
    }

    // Step 4 — apply.
    const applyStart = Date.now();
    try {
      await applyPatch(workspace.path, patchText);
      steps.push({ name: 'apply', status: 'passed', durationMs: Date.now() - applyStart });
    } catch (error) {
      steps.push({ name: 'apply', status: 'failed', durationMs: Date.now() - applyStart });
      if (error instanceof PatchApplyFailedError) {
        violations.push({ step: 'apply', severity: 'error', message: error.message });
      }
      throw error;
    }

    // Step 5 — format / lint / test.
    const checkOutcomes = await runAllChecks(workspace.path);
    for (const outcome of checkOutcomes) {
      const ref = await store.put(runId, 'validation', `${outcome.name}.log`, outcome.output);
      artifactRefs[outcome.name] = ref;
      steps.push({
        name: outcome.name,
        status: outcome.status,
        durationMs: outcome.durationMs,
        outputRef: ref,
      });
      if (outcome.status === 'failed') {
        violations.push({
          step: outcome.name,
          severity: 'error',
          message: `${outcome.name} check failed`,
        });
      }
    }

    // Step 6 — secret scan, across the patch text and every check's captured output.
    const secretScanStart = Date.now();
    const scanTargets = [patchText, ...checkOutcomes.map((o) => o.output)];
    const matches = scanTargets.flatMap((target) => scanForSecrets(target));
    const secretScanStatus = matches.length === 0 ? 'passed' : 'failed';
    const secretScanRef =
      matches.length > 0
        ? await store.put(
            runId,
            'validation',
            'secret-scan.log',
            matches.map((m) => `${m.kind}: ${m.preview}`).join('\n'),
          )
        : undefined;
    steps.push({
      name: 'secret-scan',
      status: secretScanStatus,
      durationMs: Date.now() - secretScanStart,
      ...(secretScanRef ? { outputRef: secretScanRef } : {}),
    });
    if (secretScanRef) artifactRefs['secret-scan'] = secretScanRef;
    for (const match of matches) {
      violations.push({
        step: 'secret-scan',
        severity: 'error',
        message: `planted secret detected: ${match.kind} (${match.preview})`,
      });
    }

    const status = steps.every((step) => step.status === 'passed') ? 'passed' : 'failed';
    return {
      run_id: runId,
      status,
      steps: steps.map((step) => ({
        name: step.name,
        status: step.status,
        duration_ms: step.durationMs,
        ...(step.outputRef ? { output_ref: step.outputRef } : {}),
      })),
      violations,
      artifact_refs: artifactRefs,
    };
  } finally {
    await workspace.dispose();
  }
}
