import { describe, expect, it } from 'vitest';
import { pipelineDefinitionSchema, pipelineStepSchema } from '../pipeline-definition';

describe('pipelineStepSchema', () => {
  it('accepts a minimal agent step', () => {
    expect(pipelineStepSchema.safeParse({ id: 'planner', kind: 'agent' }).success).toBe(true);
  });

  it('accepts a full step with all optional fields', () => {
    expect(
      pipelineStepSchema.safeParse({
        id: 'coder',
        kind: 'agent',
        promptFile: 'coder.md',
        upstream: ['planner'],
        producesPatch: true,
        dryRun: true,
      }).success,
    ).toBe(true);
  });

  it('rejects an empty id', () => {
    expect(pipelineStepSchema.safeParse({ id: '', kind: 'agent' }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(pipelineStepSchema.safeParse({ id: 'a', kind: 'reviewer' }).success).toBe(false);
  });
});

describe('pipelineDefinitionSchema', () => {
  it('accepts a valid linear pipeline', () => {
    const result = pipelineDefinitionSchema.safeParse({
      name: 'coding-review',
      steps: [
        { id: 'planner', kind: 'agent' },
        { id: 'coder', kind: 'agent', upstream: ['planner'] },
        { id: 'validate', kind: 'validation', upstream: ['coder'] },
        { id: 'reviewer', kind: 'agent', upstream: ['planner', 'coder', 'validate'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate step ids', () => {
    const result = pipelineDefinitionSchema.safeParse({
      name: 'dup',
      steps: [
        { id: 'a', kind: 'agent' },
        { id: 'a', kind: 'agent' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an upstream id referencing a not-yet-defined (later) step', () => {
    const result = pipelineDefinitionSchema.safeParse({
      name: 'forward-ref',
      steps: [
        { id: 'a', kind: 'agent', upstream: ['b'] },
        { id: 'b', kind: 'agent' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an upstream id that does not exist at all', () => {
    const result = pipelineDefinitionSchema.safeParse({
      name: 'unknown-ref',
      steps: [{ id: 'a', kind: 'agent', upstream: ['ghost'] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty steps array', () => {
    expect(pipelineDefinitionSchema.safeParse({ name: 'empty', steps: [] }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(
      pipelineDefinitionSchema.safeParse({ name: '', steps: [{ id: 'a', kind: 'agent' }] }).success,
    ).toBe(false);
  });
});
