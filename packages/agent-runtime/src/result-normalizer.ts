import type { AgentInput, AgentResult } from '@poc/agent-contracts';
import { agentResultSchema } from '@poc/agent-contracts';
import type { RawAgentOutput } from './opencode-adapter';

/**
 * Thrown when the adapter's raw output cannot be turned into a valid
 * `AgentResult` — malformed shape, oversized summary, bad artifact URI,
 * etc. Named distinctly so Phase 3's non-retryable-error classification
 * (PLAN §5.2, `InvalidAgentOutput`) can be wired onto this later.
 */
export class InvalidAgentOutputError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'InvalidAgentOutputError';
  }
}

export interface NormalizeOptions {
  runId: string;
  role: AgentInput['role'];
  artifactRefs?: Record<string, string>;
}

/**
 * Converts the adapter's raw subprocess output into a validated
 * `AgentResult`. This is where malformed/oversized/bad-URI outputs get
 * rejected, per PLAN §2.
 */
export function normalizeAgentResult(raw: RawAgentOutput, options: NormalizeOptions): AgentResult {
  const candidate = {
    run_id: options.runId,
    agent: options.role,
    status: raw.exitCode === 0 ? ('success' as const) : ('failure' as const),
    summary: raw.finalText || '(no output produced)',
    confidence: raw.exitCode === 0 ? 0.8 : 0,
    artifact_refs: options.artifactRefs ?? {},
    metrics: {
      started_at: raw.startedAt,
      ended_at: raw.endedAt,
      duration_ms: raw.durationMs,
      exit_code: raw.exitCode,
    },
    ...(raw.exitCode !== 0
      ? { error: { kind: 'SubprocessFailed', message: raw.stderr.slice(0, 2000) } }
      : {}),
  };

  const parsed = agentResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new InvalidAgentOutputError(
      `agent output failed AgentResult validation: ${parsed.error.message}`,
      parsed.error,
    );
  }
  return parsed.data;
}
