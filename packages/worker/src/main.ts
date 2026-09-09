// Phase 1 — minimal worker registering the trivial pingWorkflow on the
// agent-default task queue. Activities land in Phase 3.
import { Worker } from '@temporalio/worker';

const TASK_QUEUE = 'agent-default';

async function run(): Promise<void> {
  const worker = await Worker.create({
    workflowsPath: require.resolve('@poc/workflows'),
    taskQueue: TASK_QUEUE,
    // Phase 1 has no activities yet; runAgent/initializeRun/publishRunSummary land in Phase 3.
    activities: {},
    maxConcurrentActivityTaskExecutions: 1,
  });

  console.log(`worker started on task queue "${TASK_QUEUE}"`);
  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
