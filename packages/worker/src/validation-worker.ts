// The `tool-validation` worker — registers only `validatePatch` (PLAN
// §6.1). Kept as a separate process/queue from `agent-default` so Phase 4
// can give it its own concurrency and dependencies (git, lint/test
// toolchains) without touching the agent worker.
import { Worker } from '@temporalio/worker';
import { validatePatch } from './activities';
import { buildPayloadCodecs } from './codec';

const TASK_QUEUE = 'tool-validation';

async function run(): Promise<void> {
  const worker = await Worker.create({
    // Activities-only worker — this queue never executes workflow code.
    taskQueue: TASK_QUEUE,
    activities: { validatePatch },
    dataConverter: { payloadCodecs: buildPayloadCodecs() },
  });

  console.log(`worker started on task queue "${TASK_QUEUE}"`);
  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
