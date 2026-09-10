// GET /pipelines route, per PLAN Step 5b: lists the registry's pipeline
// names so manual/E2E testing doesn't require reading source to know valid
// `pipeline` values for `POST /runs`.
import type { FastifyInstance } from 'fastify';
import { registry } from '../../../../pipelines/registry';

export function registerPipelineRoutes(app: FastifyInstance): void {
  app.get('/pipelines', async () => ({ pipelines: Object.keys(registry) }));
}
