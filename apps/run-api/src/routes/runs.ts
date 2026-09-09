// POST /runs — Phase 1 stub: starts the trivial pingWorkflow via the Run API.
// GET /runs/:id and POST /runs/:id/cancel remain TODOs until Phase 5.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';
import { getTemporalClient } from '../temporal-client';

interface CreateRunBody {
  run_id?: string;
}

export function registerRunRoutes(app: FastifyInstance, config: Config): void {
  app.post<{ Body: CreateRunBody }>('/runs', async (request, reply) => {
    const runId = request.body?.run_id ?? randomUUID();
    const workflowId = `agent-run/${runId}`;

    const client = await getTemporalClient(config);
    const handle = await client.workflow.start('pingWorkflow', {
      taskQueue: 'agent-default',
      workflowId,
      args: [],
    });

    return reply.code(202).send({
      run_id: runId,
      workflow_id: handle.workflowId,
      run_status: 'initializing',
    });
  });

  // TODO(phase-5): GET /runs/:runId — describe() + runStatus query + RunSummary.
  // TODO(phase-5): POST /runs/:runId/cancel — handle.cancel().
}
