import type { AgentResult, RunContext, TaskRequest, ValidationResult } from '@poc/agent-contracts';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../config';
import { registerRunRoutes } from '../routes/runs';
import { closeTemporalClient } from '../temporal-client';

/**
 * GET/cancel route integration tests, per PLAN §8 / §9 Phase 5 evidence.
 * Runs against a real ephemeral Temporal test server (time-skipping) and a
 * real worker — not mocked HTTP responses — with `agentActivities` mocked
 * only at the activity boundary so a run resolves in real seconds.
 */
describe('GET /runs/:runId and POST /runs/:runId/cancel', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRunPromise: Promise<void>;
  let app: FastifyInstance;

  function successResult(role: string, context: RunContext): AgentResult {
    return {
      run_id: context.run_id,
      agent: role as AgentResult['agent'],
      status: 'success',
      summary: `[test] ${role} ok`,
      confidence: 0.9,
      artifact_refs: {},
      metrics: {
        started_at: new Date(0).toISOString(),
        ended_at: new Date(1).toISOString(),
        duration_ms: 1,
        exit_code: 0,
      },
    };
  }

  function passedValidation(context: RunContext): ValidationResult {
    return {
      run_id: context.run_id,
      status: 'passed',
      steps: [],
      violations: [],
      artifact_refs: {},
    };
  }

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    await env.connection.operatorService.addSearchAttributes({
      namespace: env.namespace ?? 'default',
      searchAttributes: {
        RunStatus: 2 /* KEYWORD */,
        TaskRunId: 2,
        Repository: 2,
        TaskClass: 2,
      },
    });

    worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue: 'agent-default',
      workflowsPath: require.resolve('@poc/workflows'),
      activities: {
        initializeRun: async (task: TaskRequest): Promise<RunContext> => ({
          run_id: task.run_id ?? 'test-run',
          repository: task.repository,
          task_class: task.task_class,
          instruction: task.instruction,
        }),
        runAgent: async ({ role, context }: { role: string; context: RunContext }) =>
          successResult(role, context),
        publishRunSummary: async (input: {
          context: RunContext;
          plan: AgentResult;
          code: AgentResult;
          validation: ValidationResult;
          review: AgentResult;
        }) => ({
          run_id: input.context.run_id,
          status: input.validation.status === 'failed' ? 'failed' : 'succeeded',
          plan: input.plan,
          code: input.code,
          validation: input.validation,
          review: input.review,
          artifact_manifest: [],
        }),
      },
    });
    workerRunPromise = worker.run();

    const validationWorker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue: 'tool-validation',
      activities: {
        validatePatch: async ({ context }: { context: RunContext }) => passedValidation(context),
      },
    });
    void validationWorker.run();

    const config: Config = {
      port: 0,
      temporalAddress: env.address,
      temporalNamespace: env.namespace ?? 'default',
    };
    app = Fastify();
    registerRunRoutes(app, config);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await closeTemporalClient();
    worker?.shutdown();
    await workerRunPromise?.catch(() => undefined);
    await env?.teardown();
  }, 60_000);

  function taskFixture(overrides: Partial<TaskRequest> = {}): TaskRequest {
    return {
      repository: 'local/fixture',
      task_class: 'chore',
      instruction: 'route integration test',
      ...overrides,
    };
  }

  it('POST /runs starts the workflow and GET /runs/:runId reports each phase then the RunSummary', async () => {
    const startResponse = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: taskFixture(),
    });
    expect(startResponse.statusCode).toBe(202);
    const { run_id: runId } = startResponse.json();
    expect(runId).toBeTypeOf('string');

    let lastBody: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const res = await app.inject({ method: 'GET', url: `/runs/${runId}` });
      expect(res.statusCode).toBe(200);
      lastBody = res.json();
      if (lastBody.workflow_status === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(lastBody.workflow_status).toBe('COMPLETED');
    expect(lastBody.run_status).toBe('succeeded');
    expect(lastBody.summary).toMatchObject({ run_id: runId, status: 'succeeded' });
  });

  it('GET /runs/:runId 404s for an unknown run', async () => {
    const res = await app.inject({ method: 'GET', url: '/runs/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /runs/:runId/cancel cancels a running workflow, and GET reports it CANCELLED', async () => {
    const startResponse = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: taskFixture(),
    });
    expect(startResponse.statusCode).toBe(202);
    const { run_id: runId } = startResponse.json();

    const cancelResponse = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel` });
    expect(cancelResponse.statusCode).toBe(202);

    let lastBody: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const res = await app.inject({ method: 'GET', url: `/runs/${runId}` });
      lastBody = res.json();
      if (lastBody.workflow_status !== 'RUNNING') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(lastBody.workflow_status).toBe('CANCELLED');
    expect(lastBody.run_status).toBe('cancelled');
  });

  it('POST /runs/:runId/cancel 404s for an unknown run', async () => {
    const res = await app.inject({ method: 'POST', url: '/runs/does-not-exist/cancel' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /runs rejects an invalid TaskRequest body with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/runs', payload: { repository: '' } });
    expect(res.statusCode).toBe(400);
  });
});
