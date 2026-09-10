import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, type Workspace } from '../workspace';

const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'sample-repo');

describe('createWorkspace (real git, real filesystem — no mocks)', () => {
  let workspace: Workspace | undefined;
  const workspaceRoot = join(tmpdir(), `agent-tools-workspace-test-${Date.now()}`);

  afterEach(async () => {
    await workspace?.dispose();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('copies the fixture repo and commits a baseline', async () => {
    workspace = await createWorkspace({
      sourceRepoPath: FIXTURE,
      runId: 'run-1',
      attempt: 1,
      workspaceRoot,
    });

    expect(workspace.path).toBe(join(workspaceRoot, 'run-1', 'ws-1'));

    const status = await execa('git', ['status', '--porcelain'], { cwd: workspace.path });
    expect(status.stdout).toBe('');

    const log = await execa('git', ['log', '--oneline'], { cwd: workspace.path });
    expect(log.stdout).toContain('baseline');
  });

  it('never mutates the source fixture repo', async () => {
    const fixtureFile = join(FIXTURE, 'src', 'greet.js');
    const before = await readFile(fixtureFile, 'utf8');

    workspace = await createWorkspace({
      sourceRepoPath: FIXTURE,
      runId: 'run-2',
      attempt: 1,
      workspaceRoot,
    });
    // Delete + commit inside the ephemeral workspace only.
    await execa('git', ['rm', '--quiet', 'src/greet.js'], { cwd: workspace.path });
    await execa('git', ['commit', '--quiet', '-m', 'remove greet.js'], { cwd: workspace.path });

    const after = await readFile(fixtureFile, 'utf8');
    expect(after).toBe(before);
    await expect(stat(join(FIXTURE, '.git'))).rejects.toThrow();
  });

  it('dispose() removes the workspace directory', async () => {
    workspace = await createWorkspace({
      sourceRepoPath: FIXTURE,
      runId: 'run-3',
      attempt: 1,
      workspaceRoot,
    });
    const path = workspace.path;
    await workspace.dispose();
    workspace = undefined;

    await expect(execa('git', ['status'], { cwd: path })).rejects.toThrow();
  });
});
