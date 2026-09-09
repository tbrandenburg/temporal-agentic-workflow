import { describe, expect, it } from 'vitest';
import type { RawAgentOutput } from '../opencode-adapter';
import { InvalidAgentOutputError, normalizeAgentResult } from '../result-normalizer';

function rawOutput(overrides: Partial<RawAgentOutput> = {}): RawAgentOutput {
  return {
    events: [],
    finalText: 'a short summary',
    stdout: '',
    stderr: '',
    exitCode: 0,
    startedAt: '2026-09-09T00:00:00.000Z',
    endedAt: '2026-09-09T00:00:01.000Z',
    durationMs: 1000,
    timedOut: false,
    ...overrides,
  };
}

describe('normalizeAgentResult', () => {
  it('produces a valid AgentResult for a successful raw output', () => {
    const result = normalizeAgentResult(rawOutput(), { runId: 'r1', role: 'planner' });
    expect(result.status).toBe('success');
    expect(result.agent).toBe('planner');
    expect(result.summary).toBe('a short summary');
  });

  it('produces a failure AgentResult with error details for a non-zero exit', () => {
    const result = normalizeAgentResult(rawOutput({ exitCode: 1, stderr: 'boom' }), {
      runId: 'r1',
      role: 'coder',
    });
    expect(result.status).toBe('failure');
    expect(result.confidence).toBe(0);
    expect(result.error?.message).toContain('boom');
  });

  it('rejects (oversized summary rejection) when finalText exceeds the 2 KiB cap', () => {
    const oversized = rawOutput({ finalText: 'x'.repeat(3000) });
    expect(() => normalizeAgentResult(oversized, { runId: 'r1', role: 'planner' })).toThrow(
      InvalidAgentOutputError,
    );
  });

  it('rejects (bad artifact URI rejection) when an artifact ref does not match the artifact:// pattern', () => {
    expect(() =>
      normalizeAgentResult(rawOutput(), {
        runId: 'r1',
        role: 'planner',
        artifactRefs: { plan: 'https://example.com/plan.md' },
      }),
    ).toThrow(InvalidAgentOutputError);
  });

  it('accepts a valid artifact:// ref', () => {
    const result = normalizeAgentResult(rawOutput(), {
      runId: 'r1',
      role: 'planner',
      artifactRefs: { plan: 'artifact://runs/r1/planner/plan.md' },
    });
    expect(result.artifact_refs.plan).toBe('artifact://runs/r1/planner/plan.md');
  });

  it('falls back to a placeholder summary when finalText is empty', () => {
    const result = normalizeAgentResult(rawOutput({ finalText: '' }), {
      runId: 'r1',
      role: 'reviewer',
    });
    expect(result.summary).toBe('(no output produced)');
  });
});
