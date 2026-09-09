import { execa } from 'execa';

export type CheckName = 'format' | 'lint' | 'test';

export interface CheckOutcome {
  name: CheckName;
  status: 'passed' | 'failed';
  durationMs: number;
  output: string;
}

/**
 * Runs one `npm run <name>` script inside the workspace, capturing
 * combined stdout+stderr and never throwing — a failing script is a
 * result (`status: 'failed'`), not a JS exception, so callers can collect
 * every check's `ValidationResult.steps` entry regardless of outcome
 * (PLAN §7 step 5).
 */
export async function runCheck(workspacePath: string, name: CheckName): Promise<CheckOutcome> {
  const startedAt = Date.now();
  try {
    const result = await execa('npm', ['run', name], { cwd: workspacePath, reject: false });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      name,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      durationMs: Date.now() - startedAt,
      output,
    };
  } catch (error) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Runs format, lint, then test in that order — PLAN §7 step 5. */
export async function runAllChecks(workspacePath: string): Promise<CheckOutcome[]> {
  const names: CheckName[] = ['format', 'lint', 'test'];
  const outcomes: CheckOutcome[] = [];
  for (const name of names) {
    outcomes.push(await runCheck(workspacePath, name));
  }
  return outcomes;
}
