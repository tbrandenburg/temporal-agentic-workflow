import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInput, AgentResult } from '@poc/agent-contracts';
import {
  composePrompt,
  normalizeAgentResult,
  runOpencode,
  SubprocessCancelledError,
} from '@poc/agent-runtime';
import { createWorkspace } from '@poc/agent-tools';
import { ArtifactStore, loadArtifactStoreConfigFromEnv } from '@poc/artifact-store';
import { cancellationSignal, cancelled, heartbeat } from '@temporalio/activity';
import { execa } from 'execa';

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
 * The coder role is special-cased: its workspace is seeded from the
 * fixture repository (not an empty temp dir) so a real `opencode run` has
 * actual files to edit, and after the subprocess exits, `git diff` against
 * that seeded baseline becomes the `patch` artifact `validatePatch`
 * requires at `AgentResult.artifact_refs.patch`. Other roles keep the
 * original empty-workspace behaviour — they never need to publish a patch.
 */
export async function runAgent(input: AgentInput, deps: RunAgentDeps = {}): Promise<AgentResult> {
  const { role, context } = input;
  const allowlist = parseAllowlist(process.env.AGENT_MODEL_ALLOWLIST);
  if (context.requested_model && allowlist && !allowlist.has(context.requested_model)) {
    throw new ModelNotAllowedError(context.requested_model);
  }

  const prompt = composePrompt(input);
  const isCoder = role === 'coder';
  const seededWorkspace = isCoder
    ? await createWorkspace({
        sourceRepoPath: deps.fixtureRepoPath ?? DEFAULT_FIXTURE_REPO_PATH,
        runId: context.run_id,
        attempt: 1,
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
    const raw = await runOpencode(prompt, {
      dir: workspace,
      signal: cancellationSignal(),
      ...(deps.opencodeBinary ? { binary: deps.opencodeBinary } : {}),
      ...(context.requested_model ? { model: context.requested_model } : {}),
    });

    const artifactRefs: Record<string, string> = {};
    if (isCoder) {
      const diff = await execa('git', ['diff'], { cwd: workspace, reject: false });
      const rawDiff = String(diff.stdout ?? '');
      // `execa` strips the trailing newline from captured stdout, but
      // `git apply` requires every line — including the last — to be
      // newline-terminated, or it rejects the whole patch as corrupt.
      const diffText = rawDiff.length > 0 && !rawDiff.endsWith('\n') ? `${rawDiff}\n` : rawDiff;
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
