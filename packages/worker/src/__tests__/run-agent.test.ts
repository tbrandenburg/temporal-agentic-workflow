import type { AgentInput, RunContext } from '@poc/agent-contracts';
import { MockActivityEnvironment } from '@temporalio/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArtifactSink } from '../activities/run-agent';
import { runAgent } from '../activities/run-agent';

function buildContext(runId: string): RunContext {
  return {
    run_id: runId,
    repository: 'local/fixture',
    task_class: 'chore',
    instruction: 'generic step test',
  };
}

function fakeArtifactStore(): ArtifactSink & { bodies: Map<string, string> } {
  const bodies = new Map<string, string>();
  return {
    bodies,
    async put(runId, role, name, body) {
      const ref = `artifact://runs/${runId}/${role}/${name}`;
      bodies.set(ref, body);
      return ref;
    },
  };
}

describe('runAgent — generic, producesPatch-driven (PLAN Step 3)', () => {
  const previousMode = process.env.AGENT_MODE;
  const previousEdit = process.env.EVIDENCE_CODER_EDIT;

  afterEach(() => {
    if (previousMode === undefined) delete process.env.AGENT_MODE;
    else process.env.AGENT_MODE = previousMode;
    if (previousEdit === undefined) delete process.env.EVIDENCE_CODER_EDIT;
    else process.env.EVIDENCE_CODER_EDIT = previousEdit;
  });

  it('does not publish a patch artifact for a step with producesPatch unset', async () => {
    process.env.AGENT_MODE = 'mock';
    const artifactStore = fakeArtifactStore();
    const env = new MockActivityEnvironment();
    const runId = 'no-patch-run';
    const input: AgentInput = {
      role: 'summarizer',
      context: buildContext(runId),
      promptFile: 'pipelines/coding-review/prompts/planner.md',
    };

    const result = await env.run((i, deps) => runAgent(i, deps), input, { artifactStore });

    expect(result.artifact_refs.patch).toBeUndefined();
  });

  it('publishes a patch artifact for a step with producesPatch: true, driven by the flag not the role name', async () => {
    process.env.AGENT_MODE = 'mock';
    process.env.EVIDENCE_CODER_EDIT = 'safe';
    const artifactStore = fakeArtifactStore();
    const env = new MockActivityEnvironment();
    const runId = 'patch-run';
    const input: AgentInput = {
      role: 'implementer', // deliberately not "coder" — proves it's flag-driven
      context: buildContext(runId),
      promptFile: 'pipelines/coding-review/prompts/coder.md',
      producesPatch: true,
    };

    const result = await env.run((i, deps) => runAgent(i, deps), input, { artifactStore });

    expect(result.artifact_refs.patch).toBeDefined();
    expect(artifactStore.bodies.get(result.artifact_refs.patch as string)).toContain('greet');
  });

  it('returns mock output for a step with dryRun: false when global AGENT_MODE is mock (or unset)', async () => {
    // Deliberately unset (not just 'mock') to prove the *absence* of
    // AGENT_MODE also defaults to mock-dominates behavior, not just an
    // explicit 'mock' value.
    delete process.env.AGENT_MODE;
    const artifactStore = fakeArtifactStore();
    const env = new MockActivityEnvironment();
    const runId = 'dry-run-false-run';
    const input: AgentInput = {
      role: 'planner',
      context: buildContext(runId),
      promptFile: 'pipelines/coding-review/prompts/planner.md',
      dryRun: false,
    };

    // If global mode didn't dominate, `dryRun: false` might be read as an
    // instruction to go live — it must not: global AGENT_MODE (mock by
    // default) always wins, per PLAN Step 3.
    const result = await env.run((i, deps) => runAgent(i, deps), input, { artifactStore });

    expect(result.status).toBe('success');
    expect(result.summary).toContain('[mock]');
  });

  it('forces mock mode for a step with dryRun: true even when AGENT_MODE=real globally', async () => {
    process.env.AGENT_MODE = 'real';
    const artifactStore = fakeArtifactStore();
    const env = new MockActivityEnvironment();
    const runId = 'dry-run-run';
    const input: AgentInput = {
      role: 'planner',
      context: buildContext(runId),
      promptFile: 'pipelines/coding-review/prompts/planner.md',
      dryRun: true,
    };

    // If dryRun didn't force mock, this would attempt to spawn the real
    // `opencode` binary (not installed/authorized in CI) and reject.
    const result = await env.run((i, deps) => runAgent(i, deps), input, { artifactStore });

    expect(result.status).toBe('success');
    expect(result.summary).toContain('[mock]');
  });
});
