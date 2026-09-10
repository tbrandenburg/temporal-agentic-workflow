import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { RunContext } from '@poc/agent-contracts';
import { MockActivityEnvironment } from '@temporalio/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactSink } from '../activities/run-agent';
import { runAgent } from '../activities/run-agent';

const STUB_HANG = join(
  __dirname,
  '..',
  '..',
  '..',
  'agent-runtime',
  'src',
  '__tests__',
  'fixtures',
  'stub-hang.js',
);

function buildContext(runId: string): RunContext {
  return {
    run_id: runId,
    repository: 'local/fixture',
    task_class: 'chore',
    instruction: 'cancellation test',
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Finds the PID of a live `node <STUB_HANG>` process — the real opencode
 * subprocess stand-in spawned by `runAgent` in real mode. */
function findStubHangPid(): number | undefined {
  const out = execSync(`ps -eo pid,args | grep '${STUB_HANG}' | grep -v grep || true`, {
    encoding: 'utf8',
  });
  const line = out.trim().split('\n').find(Boolean);
  if (!line) return undefined;
  const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10);
  return Number.isFinite(pid) ? pid : undefined;
}

describe('runAgent cancellation (PLAN §1.2 point 3 / §6.3)', () => {
  const previousMode = process.env.AGENT_MODE;

  beforeEach(() => {
    process.env.AGENT_MODE = 'real';
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.AGENT_MODE;
    else process.env.AGENT_MODE = previousMode;
  });

  it('SIGTERM/SIGKILLs the real opencode subprocess, flushes partial logs, and rethrows CancelledFailure', async () => {
    const bodies = new Map<string, string>();
    const artifactStore: ArtifactSink = {
      async put(runId, role, name, body) {
        const ref = `artifact://${runId}/${role}/${name}`;
        bodies.set(ref, body);
        return ref;
      },
    };

    const env = new MockActivityEnvironment();
    const runId = 'cancel-test-run';

    const runPromise = env.run(
      (input, deps) => runAgent(input, deps),
      { role: 'planner', context: buildContext(runId) },
      { artifactStore, opencodeBinary: STUB_HANG },
    );

    // Give the subprocess time to actually spawn before we look for its PID.
    let pid: number | undefined;
    for (let attempt = 0; attempt < 50 && pid === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      pid = findStubHangPid();
    }
    expect(pid, 'expected the stub-hang subprocess to be running').toBeDefined();
    expect(isPidAlive(pid as number)).toBe(true);

    env.cancel();

    await expect(runPromise).rejects.toThrow();

    // SIGTERM (execa's default on cancelSignal abort) plus its 5s grace/SIGKILL
    // fallback must have actually killed the process — this is the evidence
    // the PLAN's §9 Phase 5 asks for ("opencode PID confirmed gone via ps").
    for (let attempt = 0; attempt < 60 && isPidAlive(pid as number); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(isPidAlive(pid as number)).toBe(false);

    const logRef = `artifact://${runId}/planner/cancelled.log`;
    expect(bodies.has(logRef)).toBe(true);
    expect(bodies.get(logRef)).toContain('partial stdout');
  }, 15_000);
});
