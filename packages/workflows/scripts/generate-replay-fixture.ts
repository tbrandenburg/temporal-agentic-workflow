// One-off script: generates the recorded workflow history fixture used by
// `__tests__/replay.test.ts` (PLAN §9 Phase 3 "replay determinism test
// using a recorded history"). Run via:
//   pnpm --filter @poc/workflows exec tsx scripts/generate-replay-fixture.ts
// Commits the fixture; not run as part of `make test`.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentResult,
  PipelineDefinition,
  RunContext,
  TaskRequest,
  ValidationResult,
} from '@poc/agent-contracts';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { registry } from '../../../pipelines/registry';

async function main(): Promise<void> {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    // The ephemeral test server has no custom search attributes registered
    // by default (unlike the real namespace, bootstrapped by
    // `infra/temporal/register-search-attributes.sh`); the workflow's
    // `upsertSearchAttributes([{ key: RunStatusKey, ... }])` calls would
    // otherwise fail every workflow task. Register it here to mirror
    // production.
    await env.connection.operatorService.addSearchAttributes({
      namespace: env.namespace ?? 'default',
      searchAttributes: { RunStatus: 2 /* INDEXED_VALUE_TYPE_KEYWORD */ },
    });

    const taskQueue = 'agent-default';
    const validationTaskQueue = 'tool-validation';

    const pipeline: PipelineDefinition = registry['coding-review'];
    if (!pipeline) {
      throw new Error('pipelines/registry.ts has no "coding-review" entry');
    }

    // Fixture activities mirror the real `@poc/worker` implementations'
    // *shapes* only (mock-mode-equivalent, deterministic, instant) — the
    // fixture's purpose is a recorded history, not activity-logic coverage.
    // `initializeRun` resolves the REAL `coding-review` `PipelineDefinition`
    // from the registry (not a hand-rolled one) so this fixture stays
    // honest about what the actual registry/interpreter execute.
    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue,
      workflowsPath: require.resolve('../src/index'),
      activities: {
        initializeRun: async (task: TaskRequest) => ({
          context: {
            run_id: task.run_id ?? 'fixture-run',
            repository: task.repository,
            pipeline: task.pipeline,
            task_class: task.task_class,
            instruction: task.instruction,
          } satisfies RunContext,
          pipeline,
        }),
        runAgent: async ({
          role,
          context,
        }: {
          role: string;
          context: RunContext;
        }): Promise<AgentResult> => ({
          run_id: context.run_id,
          agent: role,
          status: 'success',
          summary: `[fixture] ${role} done`,
          confidence: 0.9,
          artifact_refs: {},
          metrics: {
            started_at: new Date(0).toISOString(),
            ended_at: new Date(1).toISOString(),
            duration_ms: 1,
            exit_code: 0,
          },
        }),
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

    // Separate worker on `tool-validation`, matching production queue
    // routing (PLAN §6.1) — `validatePatch` never runs on `agent-default`.
    const validationWorker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue: validationTaskQueue,
      activities: {
        validatePatch: async ({ context }: { context: RunContext }): Promise<ValidationResult> => ({
          run_id: context.run_id,
          status: 'passed',
          steps: [],
          violations: [],
          artifact_refs: {},
        }),
      },
    });

    const task: TaskRequest = {
      run_id: randomUUID(),
      repository: 'local/fixture',
      pipeline: 'coding-review',
      task_class: 'chore',
      instruction: 'Generate a replay fixture history.',
    };
    const workflowId = `agent-run/${task.run_id}`;

    const validationRunPromise = validationWorker.run();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start('agentRunWorkflow', {
          workflowId,
          taskQueue,
          args: [task],
        });
        await handle.result();
      });
    } finally {
      validationWorker.shutdown();
      await validationRunPromise;
    }

    const handle = env.client.workflow.getHandle(workflowId);
    const history = await handle.fetchHistory();
    const json = historyToJSON(history);

    const outDir = join(__dirname, '..', 'src', '__tests__', 'fixtures');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'agent-run-history.json'), json);
    console.log(`wrote ${join(outDir, 'agent-run-history.json')}`);
  } finally {
    await env.teardown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
