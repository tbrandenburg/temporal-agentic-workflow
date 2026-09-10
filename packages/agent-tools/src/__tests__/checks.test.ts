import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAllChecks, runCheck } from '../checks';
import { createWorkspace, type Workspace } from '../workspace';

const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'sample-repo');

describe('runCheck / runAllChecks (real npm scripts in a real ephemeral workspace)', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.dispose();
  });

  it('reports every check as passed against the untouched fixture', async () => {
    workspace = await createWorkspace({ sourceRepoPath: FIXTURE, runId: 'checks-ok', attempt: 1 });
    const outcomes = await runAllChecks(workspace.path);

    expect(outcomes.map((o) => o.name)).toEqual(['format', 'lint', 'test']);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('passed');
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports test as failed when a patch breaks the fixture test', async () => {
    workspace = await createWorkspace({
      sourceRepoPath: FIXTURE,
      runId: 'checks-broken',
      attempt: 1,
    });
    // Break the implementation directly (equivalent to a "breaks tests" patch already applied).
    await writeFile(
      join(workspace.path, 'src', 'greet.js'),
      "function greet(name) {\n  return 'nope';\n}\n\nmodule.exports = { greet };\n",
    );

    const outcome = await runCheck(workspace.path, 'test');
    expect(outcome.status).toBe('failed');
    expect(outcome.output).toContain('fail');
  });
});
