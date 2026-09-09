import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInput, AgentResult } from '@poc/agent-contracts';
import { composePrompt, normalizeAgentResult, runOpencode } from '@poc/agent-runtime';
import { heartbeat } from '@temporalio/activity';

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
 */
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const { role, context } = input;
  const allowlist = parseAllowlist(process.env.AGENT_MODEL_ALLOWLIST);
  if (context.requested_model && allowlist && !allowlist.has(context.requested_model)) {
    throw new ModelNotAllowedError(context.requested_model);
  }

  const prompt = composePrompt(input);
  const workspace = await mkdtemp(join(tmpdir(), `agent-run-${context.run_id}-${role}-`));

  heartbeat({ phase: 'starting', role, startedAt: Date.now() });
  const heartbeatTimer = setInterval(() => {
    heartbeat({ phase: 'running', role, elapsedMs: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
  // Interval alone must not keep the process alive after the activity settles.
  heartbeatTimer.unref?.();

  try {
    const raw = await runOpencode(prompt, {
      dir: workspace,
      ...(context.requested_model ? { model: context.requested_model } : {}),
    });
    return normalizeAgentResult(raw, { runId: context.run_id, role });
  } finally {
    clearInterval(heartbeatTimer);
    await rm(workspace, { recursive: true, force: true });
  }
}
