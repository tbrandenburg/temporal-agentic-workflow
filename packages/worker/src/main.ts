// The `agent-default` worker — registers the workflows plus `initializeRun`,
// `runAgent`, `publishRunSummary` (PLAN §6.1). `validatePatch` runs on the
// separate `tool-validation` worker (`validation-worker.ts`).
import { Worker } from '@temporalio/worker';
import { initializeRun, publishRunSummary, runAgent } from './activities';

const TASK_QUEUE = 'agent-default';

async function run(): Promise<void> {
  const worker = await Worker.create({
    workflowsPath: require.resolve('@poc/workflows'),
    taskQueue: TASK_QUEUE,
    activities: { initializeRun, runAgent, publishRunSummary },
    // One opencode subprocess at a time — PLAN §6.2 memory ceiling.
    maxConcurrentActivityTaskExecutions: 1,
  });

  console.log(`worker started on task queue "${TASK_QUEUE}"`);
  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
