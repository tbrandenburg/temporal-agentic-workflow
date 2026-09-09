import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import agentResultJsonSchema from '../../../../schemas/agent-result.schema.json';
import { agentResultSchema } from '../agent-result';

const validSample = {
  run_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  agent: 'planner',
  status: 'success',
  summary: 'Planned the change.',
  confidence: 0.9,
  artifact_refs: {
    plan: 'artifact://runs/01ARZ3NDEKTSV4RRFFQ69G5FAV/planner/plan.md',
  },
  metrics: {
    started_at: '2026-09-09T00:00:00.000Z',
    ended_at: '2026-09-09T00:00:01.000Z',
    duration_ms: 1000,
    exit_code: 0,
  },
};

describe('agentResultSchema', () => {
  it('accepts a valid AgentResult', () => {
    expect(agentResultSchema.safeParse(validSample).success).toBe(true);
  });

  it('rejects a summary larger than 2 KiB (oversized summary rejection)', () => {
    const oversized = { ...validSample, summary: 'x'.repeat(2049) };
    const result = agentResultSchema.safeParse(oversized);
    expect(result.success).toBe(false);
  });

  it('accepts a summary at exactly the 2 KiB boundary', () => {
    const boundary = { ...validSample, summary: 'x'.repeat(2048) };
    expect(agentResultSchema.safeParse(boundary).success).toBe(true);
  });

  it('rejects an artifact_refs value that is not an artifact:// URI (bad artifact URI rejection)', () => {
    const badUri = {
      ...validSample,
      artifact_refs: { plan: 'https://example.com/plan.md' },
    };
    expect(agentResultSchema.safeParse(badUri).success).toBe(false);
  });

  it('rejects an artifact:// URI missing the role/name segments', () => {
    const badUri = {
      ...validSample,
      artifact_refs: { plan: 'artifact://runs/only-run-id' },
    };
    expect(agentResultSchema.safeParse(badUri).success).toBe(false);
  });

  it('rejects an unknown agent role', () => {
    const badRole = { ...validSample, agent: 'orchestrator' };
    expect(agentResultSchema.safeParse(badRole).success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(agentResultSchema.safeParse({ ...validSample, confidence: 1.5 }).success).toBe(false);
    expect(agentResultSchema.safeParse({ ...validSample, confidence: -0.1 }).success).toBe(false);
  });

  it('the emitted JSON Schema (schemas/agent-result.schema.json) actually validates the same sample with Ajv', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(agentResultJsonSchema);
    const ok = validate(validSample);
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it('the emitted JSON Schema rejects the same oversized-summary sample Zod rejects', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(agentResultJsonSchema);
    const oversized = { ...validSample, summary: 'x'.repeat(2049) };
    expect(validate(oversized)).toBe(false);
  });
});
