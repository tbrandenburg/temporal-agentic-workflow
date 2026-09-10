import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  AgentResult,
  PipelineDefinition,
  RunContext,
  TaskRequest,
  ValidationResult,
} from '@poc/agent-contracts';
import { pipelineDefinitionSchema } from '@poc/agent-contracts';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression guard against "generic in name only" (PLAN Step 4 / this
 * step's Task 7c): a synthetic, non-`coding-review`, non-`summarizer-critic`
 * `PipelineDefinition` with deliberately unfamiliar step ids ("alpha",
 * "beta", "gate" — not planner/coder/validate/reviewer) proves the
 * interpreter (`agent-run.workflow.ts`) has no hardcoded role names: it
 * dispatches purely by `step.kind` and threads `upstream` purely by
 * `step.id`.
 */
const syntheticPipeline: PipelineDefinition = pipelineDefinitionSchema.parse({
  name: 'synthetic-generic',
  steps: [
    { id: 'alpha', kind: 'agent' },
    { id: 'beta', kind: 'agent', upstream: ['alpha'] },
    { id: 'gate', kind: 'validation', upstream: ['beta'] },
  ],
});

function agentResult(role: string, context: RunContext, summary: string): AgentResult {
  return {
    run_id: context.run_id,
    agent: role,
    status: 'success',
    summary,
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

describe('agentRunWorkflow generic interpreter (synthetic pipeline)', () => {
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

  /**
   * Runs `agentRunWorkflow` with the synthetic pipeline. `gateStatus`
   * controls what the fake `validatePatch` returns, so the same setup can
   * prove both the "succeeded" and "failed" final-status paths.
   */
  async function runSynthetic(gateStatus: 'passed' | 'failed') {
    const taskQueue = 'agent-default';
    const validationTaskQueue = 'tool-validation';

    let betaUpstream: (AgentResult | ValidationResult)[] | undefined;
    let gateUpstream: AgentResult | undefined;

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue,
      workflowsPath: join(__dirname, '..', 'index.ts'),
      activities: {
        initializeRun: async (
          task: TaskRequest,
        ): Promise<{ context: RunContext; pipeline: PipelineDefinition }> => ({
          context: {
            run_id: task.run_id ?? 'synthetic-run',
            repository: task.repository,
            pipeline: task.pipeline,
            task_class: task.task_class,
            instruction: task.instruction,
          },
          pipeline: syntheticPipeline,
        }),
        runAgent: async (input: {
          role: string;
          context: RunContext;
          upstream?: (AgentResult | ValidationResult)[];
        }): Promise<AgentResult> => {
          if (input.role === 'beta') {
            betaUpstream = input.upstream;
          }
          return agentResult(input.role, input.context, `[synthetic] ${input.role} done`);
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
        validatePatch: async ({
          context,
          coderResult,
        }: {
          context: RunContext;
          coderResult: AgentResult;
        }): Promise<ValidationResult> => {
          gateUpstream = coderResult;
          return {
            run_id: context.run_id,
            status: gateStatus,
            steps: [],
            violations: [],
            artifact_refs: {},
          };
        },
      },
    });

    const task: TaskRequest = {
      run_id: randomUUID(),
      repository: 'local/fixture',
      pipeline: 'synthetic-generic',
      task_class: 'chore',
      instruction: 'synthetic pipeline test',
    };
    const workflowId = `agent-run/${task.run_id}`;

    const validationRunPromise = validationWorker.run();
    try {
      const summary = await worker.runUntil(async () => {
        const handle = await env.client.workflow.start('agentRunWorkflow', {
          workflowId,
          taskQueue,
          args: [task],
        });
        return handle.result();
      });
      return { summary, betaUpstream, gateUpstream };
    } finally {
      validationWorker.shutdown();
      await validationRunPromise;
    }
  }

  it('threads upstream results by step id and dispatches by kind, ending succeeded', async () => {
    const { summary, betaUpstream, gateUpstream } = await runSynthetic('passed');

    // (a) upstream threading by step id, regardless of role naming.
    expect(betaUpstream).toHaveLength(1);
    const alphaResult = betaUpstream?.[0] as AgentResult;
    expect(alphaResult.agent).toBe('alpha');
    expect(alphaResult.summary).toContain('alpha');
    expect(gateUpstream?.agent).toBe('beta');

    // (b) dispatch by kind: the validation-kind step produced a
    // ValidationResult (has `violations`), the agent-kind steps produced
    // AgentResults (have `agent`).
    const result = summary as {
      status: string;
      steps: Record<string, AgentResult | ValidationResult>;
    };
    expect(Object.keys(result.steps).sort()).toEqual(['alpha', 'beta', 'gate']);
    expect((result.steps.alpha as AgentResult).agent).toBe('alpha');
    expect((result.steps.beta as AgentResult).agent).toBe('beta');
    expect('violations' in result.steps.gate).toBe(true);

    // (c) final status reflects the synthetic validation step's outcome.
    expect(result.status).toBe('succeeded');
  }, 30_000);

  it('ends failed when the synthetic validation step fails', async () => {
    const { summary } = await runSynthetic('failed');
    expect((summary as { status: string }).status).toBe('failed');
  }, 30_000);
});
