import type { AgentInput } from '@poc/agent-contracts';
import { describe, expect, it } from 'vitest';
import { composePrompt, readPromptFile } from '../prompt-composer';

const baseInput: AgentInput = {
  role: 'planner',
  context: {
    run_id: 'r1',
    repository: 'org/repo',
    task_class: 'feature',
    instruction: 'Add a dark mode toggle.',
  },
};

describe('readPromptFile', () => {
  it('reads the planner prompt file', () => {
    expect(readPromptFile('pipelines/coding-review/prompts/planner.md')).toContain('planner agent');
  });

  it('reads the coder prompt file', () => {
    expect(readPromptFile('pipelines/coding-review/prompts/coder.md')).toContain('coder agent');
  });

  it('reads the reviewer prompt file', () => {
    expect(readPromptFile('pipelines/coding-review/prompts/reviewer.md')).toContain(
      'reviewer agent',
    );
  });
});

describe('composePrompt', () => {
  it('combines the role prompt with task context', () => {
    const prompt = composePrompt(
      baseInput,
      readPromptFile('pipelines/coding-review/prompts/planner.md'),
    );
    expect(prompt).toContain('org/repo');
    expect(prompt).toContain('Add a dark mode toggle.');
    expect(prompt).toContain('feature');
  });

  it('includes upstream results when present', () => {
    const withUpstream: AgentInput = {
      ...baseInput,
      role: 'coder',
      upstream: [
        {
          run_id: 'r1',
          agent: 'planner',
          status: 'success',
          summary: 'Planned it.',
          confidence: 0.9,
          artifact_refs: {},
          metrics: {
            started_at: '2026-09-09T00:00:00.000Z',
            ended_at: '2026-09-09T00:00:01.000Z',
            duration_ms: 1000,
            exit_code: 0,
          },
        },
      ],
    };
    const prompt = composePrompt(
      withUpstream,
      readPromptFile('pipelines/coding-review/prompts/coder.md'),
    );
    expect(prompt).toContain('Upstream results');
    expect(prompt).toContain('Planned it.');
  });

  it('omits the upstream section when there is no upstream', () => {
    const prompt = composePrompt(
      baseInput,
      readPromptFile('pipelines/coding-review/prompts/planner.md'),
    );
    expect(prompt).not.toContain('Upstream results');
  });
});
