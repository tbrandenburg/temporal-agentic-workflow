import { ExecaError, execa } from 'execa';

/**
 * `git apply --check` then `git apply` failure — PLAN §7 step 4,
 * non-retryable (activity-options.ts lists `PatchApplyFailedError`).
 * Covers both a corrupt/unparseable diff and a well-formed diff that no
 * longer applies cleanly to the workspace's baseline commit.
 */
export class PatchApplyFailedError extends Error {
  constructor(public readonly stderr: string) {
    super(`git apply failed: ${stderr.trim() || '(no stderr)'}`);
    this.name = 'PatchApplyFailedError';
  }
}

/**
 * Applies `patchText` inside `workspacePath`. `--check` runs first so a
 * failing patch never touches the working tree; `apply` itself is
 * idempotent-safe because the caller always hands us a fresh workspace
 * (PLAN §5.3).
 */
export async function applyPatch(workspacePath: string, patchText: string): Promise<void> {
  try {
    await execa('git', ['apply', '--check', '-'], { cwd: workspacePath, input: patchText });
    await execa('git', ['apply', '-'], { cwd: workspacePath, input: patchText });
  } catch (error) {
    const stderr =
      error instanceof ExecaError ? String(error.stderr ?? error.message) : String(error);
    throw new PatchApplyFailedError(stderr);
  }
}
