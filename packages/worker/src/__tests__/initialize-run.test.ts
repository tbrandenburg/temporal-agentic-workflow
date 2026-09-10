import type { TaskRequest } from '@poc/agent-contracts';
import { describe, expect, it, vi } from 'vitest';

const FAKE_PIPELINE = {
  name: 'fake-pipeline',
  steps: [{ id: 'step-1', kind: 'agent' as const }],
};

vi.mock('../../../../pipelines/registry', () => ({
  registry: { 'fake-pipeline': FAKE_PIPELINE },
}));

const { initializeRun, UnknownPipelineError } = await import('../activities/initialize-run');

function baseTask(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    repository: 'https://example.test/repo.git',
    pipeline: 'fake-pipeline',
    task_class: 'feature',
    instruction: 'do the thing',
    ...overrides,
  };
}

describe('initializeRun', () => {
  it('resolves the pipeline from the registry and returns { context, pipeline }', async () => {
    const result = await initializeRun(baseTask());

    expect(result.pipeline).toEqual(FAKE_PIPELINE);
    expect(result.context.pipeline).toBe('fake-pipeline');
    expect(result.context.repository).toBe('https://example.test/repo.git');
  });

  it('is idempotent: an explicit run_id round-trips into the context', async () => {
    const result = await initializeRun(baseTask({ run_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }));

    expect(result.context.run_id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('throws a non-retryable UnknownPipelineError for an unregistered pipeline', async () => {
    await expect(initializeRun(baseTask({ pipeline: 'does-not-exist' }))).rejects.toThrow(
      UnknownPipelineError,
    );

    try {
      await initializeRun(baseTask({ pipeline: 'does-not-exist' }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownPipelineError);
      expect((error as Error).name).toBe('UnknownPipelineError');
      expect((error as Error).message).toContain('does-not-exist');
    }
  });
});
