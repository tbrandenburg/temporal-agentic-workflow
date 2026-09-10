import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  AgentResult,
  PipelineDefinition,
  RunContext,
  TaskRequest,
  ValidationResult,
} from '@poc/agent-contracts';
import { Context as ActivityContext } from '@temporalio/activity';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../../../../pipelines/registry';

const codingReviewPipeline: PipelineDefinition = registry['coding-review'];

/**
 * A real `Error` subclass, matching how `@poc/worker`'s `result-normalizer`
 * throws `InvalidAgentOutputError` in production. Classification by
 * `RetryPolicy.nonRetryableErrorTypes` matches on `error.constructor.name`
 * (per `@temporalio/common`'s `ensureApplicationFailure`) — merely setting
 * `.name` on a plain `Error` does **not** classify correctly, since
 * `constructor.name` (`"Error"`) takes precedence. This class is what
 * makes the non-retryable test below actually exercise the real
 * classification path.
 */
class InvalidAgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentOutputError';
  }
}

/**
 * Time-skipping tests for retry and timeout paths, per PLAN §9 Phase 3
 * evidence ("Time-skipping tests for retry and timeout paths"). Runs
 * against `TestWorkflowEnvironment.createTimeSkipping()`, so a 20-minute
 * `runAgent` timeout or a multi-attempt retry resolves in real seconds.
 *
 * The ephemeral test server has no custom search attributes registered by
 * default, so `RunStatus` (KEYWORD) is registered once in `beforeAll` to
 * mirror what `infra/temporal/register-search-attributes.sh` does against
 * the real namespace — otherwise every `upsertSearchAttributes` call in
 * the workflow would fail its workflow task.
 */
describe('agentRunWorkflow retry and timeout paths (time-skipping)', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    await env.connection.operatorService.addSearchAttributes({
      namespace: env.namespace ?? 'default',
      searchAttributes: { RunStatus: 2 /* INDEXED_VALUE_TYPE_KEYWORD */ },
    });
  }, 60_000);

  afterAll(async () => {
    await env?.teardown();
  });

  function taskFixture(): TaskRequest {
    return {
      run_id: randomUUID(),
      repository: 'local/fixture',
      pipeline: 'coding-review',
      task_class: 'chore',
      instruction: 'time-skipping test',
    };
  }

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

  /** Runs `agentRunWorkflow` with the given activity overrides on both queues. */
  async function runWorkflow(
    task: TaskRequest,
    overrides: {
      initializeRun?: (
        task: TaskRequest,
      ) => Promise<{ context: RunContext; pipeline: PipelineDefinition }>;
      runAgent?: (input: { role: string; context: RunContext }) => Promise<AgentResult>;
      validatePatch?: (input: { context: RunContext }) => Promise<ValidationResult>;
      publishRunSummary?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    },
  ) {
    const taskQueue = 'agent-default';
    const validationTaskQueue = 'tool-validation';

    const defaultInitializeRun = async (
      t: TaskRequest,
    ): Promise<{ context: RunContext; pipeline: PipelineDefinition }> => ({
      context: {
        run_id: t.run_id ?? 'test-run',
        repository: t.repository,
        pipeline: t.pipeline,
        task_class: t.task_class,
        instruction: t.instruction,
      },
      pipeline: codingReviewPipeline,
    });

    const defaultRunAgent = async ({
      role,
      context,
    }: {
      role: string;
      context: RunContext;
    }): Promise<AgentResult> => successResult(role, context);

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue,
      workflowsPath: join(__dirname, '..', 'index.ts'),
      activities: {
        initializeRun: overrides.initializeRun ?? defaultInitializeRun,
        runAgent: overrides.runAgent ?? defaultRunAgent,
        publishRunSummary:
          overrides.publishRunSummary ??
          (async (input: {
            context: RunContext;
            results: Record<string, AgentResult | ValidationResult>;
            status: 'succeeded' | 'failed' | 'cancelled';
          }) => ({
            run_id: input.context.run_id,
            status: input.status,
            steps: input.results,
            artifact_manifest: [],
          })),
      },
    });

    const validationWorker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue: validationTaskQueue,
      activities: {
        validatePatch:
          overrides.validatePatch ??
          (async ({ context }: { context: RunContext }) => passedValidation(context)),
      },
    });

    const workflowId = `agent-run/${task.run_id}`;
    const validationRunPromise = validationWorker.run();
    try {
      return await worker.runUntil(async () => {
        const handle = await env.client.workflow.start('agentRunWorkflow', {
          workflowId,
          taskQueue,
          args: [task],
        });
        return handle.result();
      });
    } finally {
      validationWorker.shutdown();
      await validationRunPromise;
    }
  }

  it('retries a transient runAgent failure and eventually succeeds', async () => {
    let attempts = 0;
    const task = taskFixture();

    const summary = await runWorkflow(task, {
      runAgent: async ({ role, context }) => {
        if (role === 'planner') {
          attempts += 1;
          if (attempts < 3) {
            // A transient failure — retryable by default (no non-retryable
            // error type match), per PLAN §5.2.
            throw new Error(`transient failure attempt ${attempts}`);
          }
        }
        return successResult(role, context);
      },
    });

    expect(attempts).toBe(3);
    expect((summary as { status: string }).status).toBe('succeeded');
  }, 30_000);

  it('does not retry a non-retryable InvalidAgentOutputError', async () => {
    let attempts = 0;
    const task = taskFixture();

    const failure = (await runWorkflow(task, {
      runAgent: async ({ role, context }) => {
        if (role === 'planner') {
          attempts += 1;
          throw new InvalidAgentOutputError('bad output');
        }
        return successResult(role, context);
      },
    }).catch((err) => err)) as Error;

    expect(attempts).toBe(1);
    expect(failure).toBeInstanceOf(Error);
  }, 30_000);

  it('times out a runAgent activity that never heartbeats past startToCloseTimeout', async () => {
    const task = taskFixture();
    const taskQueue = 'agent-default';
    const validationTaskQueue = 'tool-validation';

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue,
      workflowsPath: join(__dirname, '..', 'index.ts'),
      activities: {
        initializeRun: async (
          t: TaskRequest,
        ): Promise<{ context: RunContext; pipeline: PipelineDefinition }> => ({
          context: {
            run_id: t.run_id ?? 'test-run',
            repository: t.repository,
            pipeline: t.pipeline,
            task_class: t.task_class,
            instruction: t.instruction,
          },
          pipeline: codingReviewPipeline,
        }),
        runAgent: async ({ role, context }: { role: string; context: RunContext }) => {
          if (role === 'planner') {
            // Never resolves and never heartbeats -> heartbeatTimeout (30s)
            // then startToCloseTimeout (20 min) fire server-side. Waiting
            // on the activity's own cancellation signal (rather than an
            // unconditional `new Promise(() => {})`) lets this activity
            // settle once the Worker is shut down at the end of the
            // test, instead of hanging `Worker.shutdown()` forever.
            await ActivityContext.current().cancelled.catch(() => undefined);
            throw new Error('cancelled');
          }
          return successResult(role, context);
        },
        publishRunSummary: async (input: {
          context: RunContext;
          results: Record<string, AgentResult | ValidationResult>;
          status: 'succeeded' | 'failed' | 'cancelled';
        }) => ({
          run_id: input.context.run_id,
          status: input.status,
          steps: input.results,
          artifact_manifest: [],
        }),
      },
    });
    const validationWorker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue: validationTaskQueue,
      activities: {
        validatePatch: async ({ context }: { context: RunContext }) => passedValidation(context),
      },
    });

    const workflowId = `agent-run/${task.run_id}`;
    const validationRunPromise = validationWorker.run();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start('agentRunWorkflow', {
          workflowId,
          taskQueue,
          args: [task],
        });
        console.error('workflow started, sleeping 21 minutes (skipped time)');
        // Manually skip time past the 20-minute startToCloseTimeout —
        // with no workflow-level timer to await, `handle.result()` alone
        // won't advance the time-skipping server's clock far enough.
        await env.sleep('21 minutes');
        console.error('sleep done, awaiting result');
        await expect(handle.result()).rejects.toThrow();
        console.error('result rejected as expected');
      });
    } finally {
      validationWorker.shutdown();
      await validationRunPromise;
    }
  }, 180_000);
});
