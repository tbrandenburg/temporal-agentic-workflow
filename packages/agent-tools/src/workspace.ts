import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

/**
 * An ephemeral, disposable git workspace — PLAN §7 step 2. Populated by
 * copying a fixture repository's files (not its `.git`, which doesn't
 * exist — see `fixtures/sample-repo/README.md`) into a fresh temp dir and
 * establishing a single baseline commit there, so every validation attempt
 * starts from identical, disposable history (PLAN §5.3: "a retry never
 * inherits a half-applied patch from a crashed attempt").
 */
export interface Workspace {
  readonly path: string;
  dispose(): Promise<void>;
}

export interface CreateWorkspaceOptions {
  /** Absolute path to the fixture repository to copy in. */
  sourceRepoPath: string;
  runId: string;
  attempt: number;
  /** Root directory ephemeral workspaces are created under; defaults to `<repo>/tmp/runs`. */
  workspaceRoot?: string;
}

const DEFAULT_WORKSPACE_ROOT = join(process.cwd(), 'tmp', 'runs');

/**
 * Creates `<workspaceRoot>/<run_id>/ws-<attempt>`, copies the fixture repo
 * into it, and commits it as the baseline. Every step uses real `git` and
 * real filesystem I/O against a real temp dir — no mocks (PLAN §10).
 */
export async function createWorkspace(options: CreateWorkspaceOptions): Promise<Workspace> {
  const root = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const path = join(root, options.runId, `ws-${options.attempt}`);

  await mkdir(path, { recursive: true });
  await cp(options.sourceRepoPath, path, { recursive: true });

  await execa('git', ['init', '--initial-branch=main'], { cwd: path });
  await execa('git', ['config', 'user.email', 'agent-tools@poc.local'], { cwd: path });
  await execa('git', ['config', 'user.name', 'agent-tools'], { cwd: path });
  await execa('git', ['add', '-A'], { cwd: path });
  await execa('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: path });

  return {
    path,
    async dispose() {
      await rm(path, { recursive: true, force: true });
    },
  };
}
