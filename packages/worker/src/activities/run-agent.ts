import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInput, AgentResult } from '@poc/agent-contracts';
import {
  composePrompt,
  normalizeAgentResult,
  readPromptFile,
  resolveAgentMode,
  runOpencode,
  SubprocessCancelledError,
} from '@poc/agent-runtime';
import { createWorkspace } from '@poc/agent-tools';
import { ArtifactStore, loadArtifactStoreConfigFromEnv } from '@poc/artifact-store';
import { Context, cancellationSignal, cancelled, heartbeat } from '@temporalio/activity';
import { execa } from 'execa';
import {
  maybeCorruptPatch,
  maybeCorruptSummary,
  maybeDelay,
  maybeEditCoderWorkspace,
  maybeThrowTransient,
} from './evidence-fault-injection';

/** Duck-typed subset of `ArtifactStore` — matches `validate-patch.ts`'s `ArtifactSink`. */
export interface ArtifactSink {
  put(runId: string, role: string, name: string, body: string): Promise<string>;
}

export interface RunAgentDeps {
  artifactStore?: ArtifactSink;
  /** Fixture repository the coder role edits. Defaults to `fixtures/sample-repo`. */
  fixtureRepoPath?: string;
  /** Overrides the `opencode` binary — tests only, exercises the real
   * spawn/cancel path against a stub binary instead of the real CLI. */
  opencodeBinary?: string;
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

/**
 * Non-retryable per PLAN §5.2: a `requested_model` outside the worker's
 * allowlist will be outside it again on retry.
 */
export class ModelNotAllowedError extends Error {
  constructor(model: string) {
    super(`requested model not allowed: ${model}`);
    this.name = 'ModelNotAllowedError';
  }
}

function parseAllowlist(raw: string | undefined): Set<string> | undefined {
  if (!raw) return undefined;
  const models = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return models.length > 0 ? new Set(models) : undefined;
}

const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * `runAgent` — invokes `@poc/agent-runtime` (mock mode by default, per
 * PLAN §6.3) for one role. Heartbeats on an interval so a crashed worker's
 * retry has `heartbeatDetails` to work with (PLAN §1.2 point 4), and so
 * the server can deliver cancellation to a real, minutes-long subprocess.
 *
 * A step with `producesPatch: true` is special-cased: its workspace is
 * seeded from the fixture repository (not an empty temp dir) so a real
 * `opencode run` has actual files to edit, and after the subprocess exits,
 * `git diff` against that seeded baseline becomes the `patch` artifact
 * `validatePatch` requires at `AgentResult.artifact_refs.patch`. Other
 * steps keep the original empty-workspace behaviour — they never need to
 * publish a patch.
 */
export async function runAgent(input: AgentInput, deps: RunAgentDeps = {}): Promise<AgentResult> {
  const { role, context } = input;
  const allowlist = parseAllowlist(process.env.AGENT_MODEL_ALLOWLIST);
  if (context.requested_model && allowlist && !allowlist.has(context.requested_model)) {
    throw new ModelNotAllowedError(context.requested_model);
  }

  const rolePrompt = readPromptFile(input.promptFile);
  const prompt = composePrompt(input, rolePrompt);
  const producesPatch = input.producesPatch === true;
  // Real Temporal attempt number, not a hardcoded `1` — a retry (whether
  // from a transient failure or a worker crashing mid-activity, PLAN §9
  // Phase 6 scenario 1) must get its own fresh workspace directory
  // (`ws-<attempt>`), matching `createWorkspace`'s documented guarantee
  // that "a retry never inherits a half-applied patch from a crashed
  // attempt" (PLAN §5.3) — a bare `attempt: 1` here defeated that
  // guarantee for every retry.
  const attempt = Context.current().info.attempt;
  const seededWorkspace = producesPatch
    ? await createWorkspace({
        sourceRepoPath: deps.fixtureRepoPath ?? DEFAULT_FIXTURE_REPO_PATH,
        runId: context.run_id,
        attempt,
        workspaceRoot: join(tmpdir(), 'agent-run-coder-workspaces'),
      })
    : undefined;
  const workspace =
    seededWorkspace?.path ??
    (await mkdtemp(join(tmpdir(), `agent-run-${context.run_id}-${role}-`)));

  heartbeat({ phase: 'starting', role, startedAt: Date.now() });
  const heartbeatTimer = setInterval(() => {
    heartbeat({ phase: 'running', role, elapsedMs: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
  // Interval alone must not keep the process alive after the activity settles.
  heartbeatTimer.unref?.();

  try {
    // Evidence-only hooks (PLAN §9 Phase 6): every one of these is a no-op
    // unless the matching `EVIDENCE_*` env var is set — see
    // `evidence-fault-injection.ts` for why each exists.
    maybeThrowTransient(role);
    await maybeDelay(role);
    if (producesPatch) await maybeEditCoderWorkspace(workspace);

    // Dry-run resolution (PLAN Step 3): global `AGENT_MODE=mock` always
    // dominates. Only when the global mode is `real` and this step's
    // `dryRun` is `true` do we force this specific invocation to mock, by
    // overriding the env passed to `runOpencode` — `opencode-adapter.ts`
    // and `modes.ts` stay untouched.
    const forceMock = input.dryRun === true && resolveAgentMode(process.env) === 'real';

    const raw = await runOpencode(prompt, {
      dir: workspace,
      signal: cancellationSignal(),
      ...(deps.opencodeBinary ? { binary: deps.opencodeBinary } : {}),
      ...(context.requested_model ? { model: context.requested_model } : {}),
      ...(forceMock ? { env: { ...process.env, AGENT_MODE: 'mock' } } : {}),
    });
    raw.finalText = maybeCorruptSummary(role, raw.finalText);

    const artifactRefs: Record<string, string> = {};
    if (producesPatch) {
      const diff = await execa('git', ['diff'], { cwd: workspace, reject: false });
      const rawDiff = String(diff.stdout ?? '');
      // `execa` strips the trailing newline from captured stdout, but
      // `git apply` requires every line — including the last — to be
      // newline-terminated, or it rejects the whole patch as corrupt.
      let diffText = rawDiff.length > 0 && !rawDiff.endsWith('\n') ? `${rawDiff}\n` : rawDiff;
      diffText = maybeCorruptPatch(diffText);
      if (diffText.trim().length > 0) {
        const store = deps.artifactStore ?? new ArtifactStore(loadArtifactStoreConfigFromEnv());
        artifactRefs.patch = await store.put(context.run_id, role, 'patch.diff', diffText);
      }
    }

    return normalizeAgentResult(raw, { runId: context.run_id, role, artifactRefs });
  } catch (error) {
    // PLAN §1.2 point 3 / §6.3: on cancellation, `runOpencode` has already
    // SIGTERM'd the subprocess (execa's `cancelSignal`, 5 s grace, then
    // SIGKILL — the default `forceKillAfterDelay` behaviour). What's left
    // is flushing whatever partial stdout/stderr the process produced
    // before it died, then re-throwing as the SDK's own `CancelledFailure`
    // (via `cancelled()`) so the workflow observes a real cancellation
    // rather than a generic activity failure.
    if (error instanceof SubprocessCancelledError) {
      const store = deps.artifactStore ?? new ArtifactStore(loadArtifactStoreConfigFromEnv());
      const partialLog = [
        '--- partial stdout (subprocess cancelled) ---',
        error.stdout,
        '--- partial stderr (subprocess cancelled) ---',
        error.stderr,
      ].join('\n');
      await store.put(context.run_id, role, 'cancelled.log', partialLog);
      await cancelled();
    }
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
    if (seededWorkspace) {
      await seededWorkspace.dispose();
    } else {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
