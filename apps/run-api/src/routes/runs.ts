// Run API routes, per PLAN §8.
import type { RunSummary, TaskRequest } from '@poc/agent-contracts';
import { RepositoryKey, RunIdKey, TaskClassKey, taskRequestSchema } from '@poc/agent-contracts';
import { runStatusQuery } from '@poc/workflows';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import type { Config } from '../config';
import { getTemporalClient } from '../temporal-client';

interface CancelParams {
  runId: string;
}

interface GetParams {
  runId: string;
}

function workflowIdFor(runId: string): string {
  return `agent-run/${runId}`;
}

export function registerRunRoutes(app: FastifyInstance, config: Config): void {
  app.post<{ Body: unknown }>('/runs', async (request, reply) => {
    request.log.info({ body: request.body }, 'POST /runs received');
    const parsed = taskRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid TaskRequest', details: parsed.error.issues });
    }

    const task: TaskRequest = { ...parsed.data, run_id: parsed.data.run_id ?? ulid() };
    const runId = task.run_id as string;
    const workflowId = workflowIdFor(runId);

    const client = await getTemporalClient(config);
    try {
      const handle = await client.workflow.start('agentRunWorkflow', {
        taskQueue: 'agent-default',
        workflowId,
        args: [task],
        typedSearchAttributes: [
          { key: RunIdKey, value: runId },
          { key: RepositoryKey, value: task.repository },
          { key: TaskClassKey, value: task.task_class },
        ],
      });

      return reply.code(202).send({
        run_id: runId,
        workflow_id: handle.workflowId,
        run_status: 'initializing',
      });
    } catch (error) {
      // Workflow ID is the dedup key (PLAN §8): a repeated request with the
      // same `run_id` returns the existing run rather than starting a second.
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        return reply.code(202).send({
          run_id: runId,
          workflow_id: workflowId,
          run_status: 'initializing',
        });
      }
      throw error;
    }
  });

  app.get<{ Params: GetParams }>('/runs/:runId', async (request, reply) => {
    const { runId } = request.params;
    const client = await getTemporalClient(config);
    const handle = client.workflow.getHandle(workflowIdFor(runId));

    let description: Awaited<ReturnType<typeof handle.describe>>;
    try {
      description = await handle.describe();
    } catch {
      return reply.code(404).send({ error: `no run found for run_id ${runId}` });
    }

    if (description.status.name === 'RUNNING') {
      const phase = await handle.query(runStatusQuery);
      return reply.send({
        run_id: runId,
        workflow_id: handle.workflowId,
        run_status: phase,
        workflow_status: description.status.name,
      });
    }

    if (description.status.name === 'COMPLETED') {
      const summary = (await handle.result()) as RunSummary;
      return reply.send({
        run_id: runId,
        workflow_id: handle.workflowId,
        run_status: summary.status,
        workflow_status: description.status.name,
        summary,
      });
    }

    // CANCELLED / FAILED / TERMINATED / TIMED_OUT: no `RunSummary` was
    // published, but the terminal workflow status is still meaningful.
    return reply.send({
      run_id: runId,
      workflow_id: handle.workflowId,
      run_status: description.status.name === 'CANCELLED' ? 'cancelled' : 'failed',
      workflow_status: description.status.name,
    });
  });

  app.post<{ Params: CancelParams }>('/runs/:runId/cancel', async (request, reply) => {
    const { runId } = request.params;
    const client = await getTemporalClient(config);
    const handle = client.workflow.getHandle(workflowIdFor(runId));

    try {
      await handle.cancel();
    } catch {
      return reply.code(404).send({ error: `no run found for run_id ${runId}` });
    }

    return reply.code(202).send({ run_id: runId, workflow_id: handle.workflowId });
  });
}
