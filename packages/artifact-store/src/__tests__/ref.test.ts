import { describe, expect, it } from 'vitest';
import {
  artifactRefToObjectKey,
  formatArtifactRef,
  InvalidArtifactRefError,
  parseArtifactRef,
} from '../ref';

describe('parseArtifactRef', () => {
  it('parses a valid ref', () => {
    expect(parseArtifactRef('artifact://runs/r1/planner/plan.md')).toEqual({
      runId: 'r1',
      role: 'planner',
      name: 'plan.md',
    });
  });

  it('rejects a ref missing segments', () => {
    expect(() => parseArtifactRef('artifact://runs/r1')).toThrow(InvalidArtifactRefError);
  });

  it('rejects a non-artifact:// URI', () => {
    expect(() => parseArtifactRef('https://example.com/plan.md')).toThrow(InvalidArtifactRefError);
  });

  it('rejects a ref with extra path segments', () => {
    expect(() => parseArtifactRef('artifact://runs/r1/planner/sub/plan.md')).toThrow(
      InvalidArtifactRefError,
    );
  });
});

describe('formatArtifactRef', () => {
  it('round-trips with parseArtifactRef', () => {
    const ref = formatArtifactRef({ runId: 'r1', role: 'coder', name: 'patch.diff' });
    expect(ref).toBe('artifact://runs/r1/coder/patch.diff');
    expect(parseArtifactRef(ref)).toEqual({ runId: 'r1', role: 'coder', name: 'patch.diff' });
  });
});

describe('artifactRefToObjectKey', () => {
  it('produces the deterministic S3 object key', () => {
    expect(artifactRefToObjectKey('artifact://runs/r1/reviewer/review.md')).toBe(
      'runs/r1/reviewer/review.md',
    );
  });
});
