import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentResult, RunContext } from '@poc/agent-contracts';
import { AllowlistViolationError, PatchApplyFailedError } from '@poc/agent-tools';
import { formatArtifactRef } from '@poc/artifact-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactSink } from '../activities/validate-patch';
import { validatePatch } from '../activities/validate-patch';

const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'sample-repo');

/** In-memory `ArtifactSink` — no live MinIO needed (unavailable on this dev machine, port 9000 is
 * occupied by an unrelated container; see handoff notes). Mirrors `@poc/artifact-store`'s exact
 * `put`/`get` signatures and `artifact://` ref format so swapping in the real `ArtifactStore` is a
 * one-line change. */
function createFakeArtifactSink(): ArtifactSink & { bodies: Map<string, string> } {
  const bodies = new Map<string, string>();
  return {
    bodies,
    async put(runId, role, name, body) {
      const ref = formatArtifactRef({ runId, role, name });
      bodies.set(ref, body);
      return ref;
    },
    async get(ref) {
      const body = bodies.get(ref);
      if (body === undefined) throw new Error(`no fake artifact for ref: ${ref}`);
      return body;
    },
  };
}

function buildContext(runId: string, allowedPaths?: string[]): RunContext {
  return {
    run_id: runId,
    repository: 'sample-repo',
    task_class: 'feature',
    instruction: 'rename the greeting',
    ...(allowedPaths ? { allowed_paths: allowedPaths } : {}),
  };
}

function buildCoderResult(runId: string, patchRef: string): AgentResult {
  return {
    run_id: runId,
    agent: 'coder',
    status: 'success',
    summary: 'Renamed the greeting.',
    confidence: 0.9,
    artifact_refs: { patch: patchRef },
    metrics: {
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:01.000Z',
      duration_ms: 1000,
      exit_code: 0,
    },
  };
}

const VALID_PATCH = `diff --git a/src/greet.js b/src/greet.js
index 1111111..2222222 100644
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,4 +1,4 @@
-// Tiny fixture module the coder role patches during Phase 4 validation.
+// Tiny fixture module the coder role patches during Phase 4 validation (patched).
 function greet(name) {
   return \`Hello, \${name}!\`;
 }
`;

const ALLOWLIST_ESCAPING_PATCH = `diff --git a/../../etc/passwd b/../../etc/passwd
index 1111111..2222222 100644
--- a/../../etc/passwd
+++ b/../../etc/passwd
@@ -1 +1 @@
-root:x:0:0:root:/root:/bin/bash
+pwned:x:0:0:root:/root:/bin/bash
`;

const CORRUPT_PATCH = `this is not a diff at all\njust some garbage text\n`;

const TEST_BREAKING_PATCH = `diff --git a/src/greet.js b/src/greet.js
index 1111111..2222222 100644
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,5 +1,5 @@
 // Tiny fixture module the coder role patches during Phase 4 validation.
 function greet(name) {
-  return \`Hello, \${name}!\`;
+  return 'nope';
 }
 
`;

const PLANTED_SECRET_PATCH = `diff --git a/src/greet.js b/src/greet.js
index 1111111..2222222 100644
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,5 +1,6 @@
 // Tiny fixture module the coder role patches during Phase 4 validation.
+const awsKey = 'AKIAABCDEFGHIJKLMNOP';
 function greet(name) {
   return \`Hello, \${name}!\`;
 }
 
`;

describe('validatePatch (real git, real filesystem, real npm scripts — fake artifact sink only)', () => {
  const workspaceRoot = join(tmpdir(), `validate-patch-test-${Date.now()}`);
  let fixtureBefore: string;

  beforeEach(async () => {
    fixtureBefore = await readFile(join(FIXTURE, 'src', 'greet.js'), 'utf8');
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
    const fixtureAfter = await readFile(join(FIXTURE, 'src', 'greet.js'), 'utf8');
    expect(fixtureAfter).toBe(fixtureBefore);
    await expect(stat(join(FIXTURE, '.git'))).rejects.toThrow();
  });

  async function run(runId: string, patchText: string, allowedPaths?: string[]) {
    const sink = createFakeArtifactSink();
    const patchRef = formatArtifactRef({ runId, role: 'coder', name: 'patch.diff' });
    sink.bodies.set(patchRef, patchText);
    const workspacePath = join(workspaceRoot, runId, 'ws-1');

    const resultPromise = validatePatch(
      {
        context: buildContext(runId, allowedPaths),
        coderResult: buildCoderResult(runId, patchRef),
      },
      { sourceRepoPath: FIXTURE, workspaceRoot, artifactStore: sink },
    );
    return { resultPromise, workspacePath };
  }

  it('passing run: a valid patch → format/lint/test green → status "passed"', async () => {
    const { resultPromise, workspacePath } = await run('run-happy', VALID_PATCH);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.violations).toEqual([]);
    expect(result.steps.map((s) => s.name)).toEqual([
      'allowlist',
      'apply',
      'format',
      'lint',
      'test',
      'secret-scan',
    ]);
    expect(result.steps.every((s) => s.status === 'passed')).toBe(true);

    await expect(stat(workspacePath)).rejects.toThrow();
  });

  it('adversarial: patch escaping the allowlist (../../etc/passwd) → AllowlistViolationError, workspace removed', async () => {
    const { resultPromise, workspacePath } = await run('run-allowlist', ALLOWLIST_ESCAPING_PATCH, [
      'src/**',
    ]);

    await expect(resultPromise).rejects.toThrow(AllowlistViolationError);
    await expect(stat(workspacePath)).rejects.toThrow();
  });

  it('adversarial: corrupt diff → PatchApplyFailedError, workspace removed', async () => {
    const { resultPromise, workspacePath } = await run('run-corrupt', CORRUPT_PATCH);

    await expect(resultPromise).rejects.toThrow(PatchApplyFailedError);
    await expect(stat(workspacePath)).rejects.toThrow();
  });

  it('adversarial: patch that breaks tests → ValidationResult.status "failed" on the test step, workspace removed', async () => {
    const { resultPromise, workspacePath } = await run('run-breaks-tests', TEST_BREAKING_PATCH);
    const result = await resultPromise;

    expect(result.status).toBe('failed');
    const testStep = result.steps.find((s) => s.name === 'test');
    expect(testStep?.status).toBe('failed');
    expect(result.violations.some((v) => v.step === 'test')).toBe(true);

    await expect(stat(workspacePath)).rejects.toThrow();
  });

  it('adversarial: artifact with a planted fake secret → ValidationResult.status "failed" on the secret-scan step, workspace removed', async () => {
    const { resultPromise, workspacePath } = await run('run-secret', PLANTED_SECRET_PATCH);
    const result = await resultPromise;

    expect(result.status).toBe('failed');
    const secretStep = result.steps.find((s) => s.name === 'secret-scan');
    expect(secretStep?.status).toBe('failed');
    const secretViolation = result.violations.find((v) => v.step === 'secret-scan');
    expect(secretViolation?.message).toContain('aws-access-key-id');
    expect(secretViolation?.message).not.toContain('AKIAABCDEFGHIJKLMNOP');

    await expect(stat(workspacePath)).rejects.toThrow();
  });
});
