import { describe, expect, it } from 'vitest';
import { taskRequestSchema } from '../task-request';

const validSample = {
  repository: 'org/repo',
  pipeline: 'coding-review',
  task_class: 'feature',
  instruction: 'Add a dark mode toggle.',
};

describe('taskRequestSchema', () => {
  it('accepts a minimal valid TaskRequest', () => {
    expect(taskRequestSchema.safeParse(validSample).success).toBe(true);
  });

  it('rejects an instruction longer than 8000 characters', () => {
    const result = taskRequestSchema.safeParse({
      ...validSample,
      instruction: 'x'.repeat(8001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty instruction', () => {
    expect(taskRequestSchema.safeParse({ ...validSample, instruction: '' }).success).toBe(false);
  });

  it('rejects a missing pipeline', () => {
    const { pipeline: _pipeline, ...withoutPipeline } = validSample;
    expect(taskRequestSchema.safeParse(withoutPipeline).success).toBe(false);
  });

  it('rejects an empty pipeline', () => {
    expect(taskRequestSchema.safeParse({ ...validSample, pipeline: '' }).success).toBe(false);
  });

  it('rejects an unknown task_class', () => {
    expect(taskRequestSchema.safeParse({ ...validSample, task_class: 'rewrite' }).success).toBe(
      false,
    );
  });

  it('rejects timeout_seconds outside 60..3600', () => {
    expect(taskRequestSchema.safeParse({ ...validSample, timeout_seconds: 30 }).success).toBe(
      false,
    );
    expect(taskRequestSchema.safeParse({ ...validSample, timeout_seconds: 3601 }).success).toBe(
      false,
    );
    expect(taskRequestSchema.safeParse({ ...validSample, timeout_seconds: 60 }).success).toBe(true);
  });

  it('rejects a malformed run_id (not a ULID)', () => {
    expect(taskRequestSchema.safeParse({ ...validSample, run_id: 'not-a-ulid' }).success).toBe(
      false,
    );
  });

  it('accepts a valid ULID run_id', () => {
    expect(
      taskRequestSchema.safeParse({ ...validSample, run_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }).success,
    ).toBe(true);
  });
});
