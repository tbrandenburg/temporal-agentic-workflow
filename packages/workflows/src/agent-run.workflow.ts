import type { RunSummary, TaskRequest } from '@poc/agent-contracts';
import { RunStatusKey } from '@poc/agent-contracts';
import { setHandler, upsertSearchAttributes } from '@temporalio/workflow';
import { agentActivities, validationActivities } from './activity-options';
import { type RunStatus, runStatusQuery } from './queries';

/**
 * The planner -> coder -> validate -> reviewer orchestration, per PLAN §5.1.
 *
 * Purity (enforced, not just documented): no file I/O, no network, no
 * `Date.now()`/`Math.random()` in this module — every side effect lives in
 * an activity. This is what the replay-determinism test in
 * `__tests__/replay.test.ts` actually exercises.
 */
export async function agentRunWorkflow(task: TaskRequest): Promise<RunSummary> {
  let status: RunStatus = 'initializing';
  setHandler(runStatusQuery, () => status);
  const setStatus = (next: RunStatus): void => {
    status = next;
    upsertSearchAttributes([{ key: RunStatusKey, value: next }]);
  };
  setStatus('initializing');

  const context = await agentActivities.initializeRun(task);

  setStatus('planning');
  const plan = await agentActivities.runAgent({ role: 'planner', context });

  setStatus('coding');
  const code = await agentActivities.runAgent({
    role: 'coder',
    context,
    upstream: [plan],
  });

  setStatus('validating');
  const validation = await validationActivities.validatePatch({ context, coderResult: code });

  setStatus('reviewing');
  // The reviewer runs even when validation failed, so its commentary is
  // captured — but the run outcome below is computed from
  // `validation.status`, not from anything the reviewer says. The
  // reviewer structurally cannot override a failed deterministic gate.
  const review = await agentActivities.runAgent({
    role: 'reviewer',
    context,
    upstream: [plan, code, validation],
  });

  setStatus(validation.status === 'failed' ? 'failed' : 'succeeded');

  return agentActivities.publishRunSummary({ context, plan, code, validation, review });
}
