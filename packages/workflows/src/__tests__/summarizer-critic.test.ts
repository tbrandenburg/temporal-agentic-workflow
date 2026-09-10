import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RunSummary, TaskRequest } from '@poc/agent-contracts';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
// Real `@poc/worker` activity implementations, imported from source via a
// relative path rather than a `@poc/worker` package dependency:
// `packages/workflows` deliberately does not depend on `@poc/worker` (the
// reverse edge already exists — `@poc/worker` depends on `@poc/workflows`
// for shared activity-input types — adding the opposite edge would create a
// real workspace dependency cycle). Importing the same TypeScript source
// `@poc/worker`'s `dist/` is built from still exercises the real,
// non-mocked activity logic end-to-end.
import { initializeRun, publishRunSummary, runAgent } from '../../../worker/src/activities';

/**
 * Integration test (Task 7d): runs `agentRunWorkflow` against the REAL
 * `summarizer-critic` pipeline registered in `pipelines/registry.ts`,
 * wired to the REAL `@poc/worker` activity implementations (not hand-rolled
 * fakes) under `AGENT_MODE=mock`. Proves the real `initializeRun`/`runAgent`/
 * `publishRunSummary` activities correctly execute a 2-step, no-validation
 * pipeline end-to-end through the same interpreter code `coding-review`
 * uses — the actual regression guard against "generic in name only" (PLAN
 * Step 4 / this step's Task 7d).
 *
 * `summarizer-critic` has no `validation`-kind step, so
 * `validationActivities.validatePatch` is never dispatched by the
 * interpreter for this pipeline — no `tool-validation` queue worker is
 * started here at all.
 */
describe('agentRunWorkflow real summarizer-critic pipeline (integration)', () => {
  let env: TestWorkflowEnvironment;
  const previousMode = process.env.AGENT_MODE;

  beforeAll(async () => {
    process.env.AGENT_MODE = 'mock';
    env = await TestWorkflowEnvironment.createTimeSkipping();
    await env.connection.operatorService.addSearchAttributes({
      namespace: env.namespace ?? 'default',
      searchAttributes: { RunStatus: 2 /* INDEXED_VALUE_TYPE_KEYWORD */ },
    });
  }, 60_000);

  afterAll(async () => {
    await env?.teardown();
    if (previousMode === undefined) delete process.env.AGENT_MODE;
    else process.env.AGENT_MODE = previousMode;
  });

  afterEach(() => {
    process.env.AGENT_MODE = 'mock';
  });

  it('executes summarizer -> critic end-to-end with real activities, no validatePatch dispatch', async () => {
    const taskQueue = 'agent-default';

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue,
      workflowsPath: join(__dirname, '..', 'index.ts'),
      activities: { initializeRun, runAgent, publishRunSummary },
    });

    const task: TaskRequest = {
      run_id: randomUUID(),
      repository: 'local/fixture',
      pipeline: 'summarizer-critic',
      task_class: 'chore',
      instruction: 'summarize and critique this fixture task end-to-end.',
    };
    const workflowId = `agent-run/${task.run_id}`;

    const summary = (await worker.runUntil(async () => {
      const handle = await env.client.workflow.start('agentRunWorkflow', {
        workflowId,
        taskQueue,
        args: [task],
      });
      return handle.result();
    })) as RunSummary;

    expect(summary.run_id).toBe(task.run_id);
    expect(summary.status).toBe('succeeded');
    expect(Object.keys(summary.steps).sort()).toEqual(['critic', 'summarizer']);
    expect(summary.steps.summarizer.agent).toBe('summarizer');
    expect(summary.steps.critic.agent).toBe('critic');
    // Real mock-mode `runAgent` output — proves the real activity ran, not
    // a fixture stand-in.
    expect(summary.steps.summarizer.summary).toContain('[mock]');
    expect(summary.steps.critic.summary).toContain('[mock]');
  }, 60_000);
});
