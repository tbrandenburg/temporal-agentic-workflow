import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPatch, PatchApplyFailedError } from '../patch';
import { createWorkspace, type Workspace } from '../workspace';

const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'sample-repo');

const VALID_PATCH = `diff --git a/src/greet.js b/src/greet.js
index 1111111..2222222 100644
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,5 +1,5 @@
 // Tiny fixture module the coder role patches during Phase 4 validation.
 function greet(name) {
-  return \`Hello, \${name}!\`;
+  return \`Hi, \${name}!\`;
 }
 
`;

const CORRUPT_PATCH = `this is not a diff at all\njust some garbage text\n`;

const NON_APPLYING_PATCH = `diff --git a/src/greet.js b/src/greet.js
index 1111111..2222222 100644
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,5 +1,5 @@
 // some header that does not match the fixture's actual first line
 function greet(name) {
-  return \`this context line does not exist in the fixture\`;
+  return \`Hi, \${name}!\`;
 }
 
`;

describe('applyPatch (real git apply against a real ephemeral workspace)', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.dispose();
  });

  it('applies a well-formed patch cleanly', async () => {
    workspace = await createWorkspace({ sourceRepoPath: FIXTURE, runId: 'patch-ok', attempt: 1 });
    await applyPatch(workspace.path, VALID_PATCH);

    const diff = await execa('git', ['diff', '--stat'], { cwd: workspace.path });
    expect(diff.stdout).toContain('greet.js');
  });

  it('throws PatchApplyFailedError on a corrupt diff', async () => {
    workspace = await createWorkspace({
      sourceRepoPath: FIXTURE,
      runId: 'patch-corrupt',
      attempt: 1,
    });
    await expect(applyPatch(workspace.path, CORRUPT_PATCH)).rejects.toThrow(PatchApplyFailedError);
  });

  it('throws PatchApplyFailedError when the diff does not apply to the baseline', async () => {
    workspace = await createWorkspace({
      sourceRepoPath: FIXTURE,
      runId: 'patch-non-applying',
      attempt: 1,
    });
    await expect(applyPatch(workspace.path, NON_APPLYING_PATCH)).rejects.toThrow(
      PatchApplyFailedError,
    );
  });

  it('leaves the working tree untouched when --check fails (no partial apply)', async () => {
    workspace = await createWorkspace({
      sourceRepoPath: FIXTURE,
      runId: 'patch-no-partial',
      attempt: 1,
    });
    await applyPatch(workspace.path, CORRUPT_PATCH).catch(() => undefined);
    const status = await execa('git', ['status', '--porcelain'], { cwd: workspace.path });
    expect(status.stdout).toBe('');
  });
});
