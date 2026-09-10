// Fastify instance + plugin registration. Phase 1: single POST /runs route;
// Phase 5 adds GET/cancel plus Pino redaction for prompt/response bodies
// (PLAN §8: "Pino logging with redaction paths configured for prompt/
// response bodies").
import Fastify from 'fastify';
import { loadConfig } from './config';
import { registerPipelineRoutes } from './routes/pipelines';
import { registerRunRoutes } from './routes/runs';
import { closeTemporalClient } from './temporal-client';

/**
 * Redaction paths, per PLAN §8. Every route that logs a request/response
 * body does so under the `body`/`summary` keys (see `routes/runs.ts`), so
 * these paths cover the actual sensitive content — the free-text
 * `instruction` prompt and agent-produced `summary` text — without
 * silencing the rest of the log (status codes, run ids, timings).
 *
 * Since Step 4, `RunSummary.steps` is a dynamic `Record<string, AgentResult |
 * ValidationResult>` keyed by arbitrary pipeline-defined step ids, so a
 * static per-key path list (the old `summary.plan.summary` / `summary.code
 * .summary` / `summary.review.summary`) can no longer enumerate every
 * possible key. Pino's redact paths do support a `*` wildcard segment for
 * "any key at this level," so `summary.steps.*.summary` redacts every
 * step's `summary` text regardless of step id while leaving `status`,
 * `artifact_refs`, etc. visible.
 */
const REDACT_PATHS = ['req.headers.authorization', 'body.instruction', 'summary.steps.*.summary'];

export function createServer() {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
  });

  app.get('/health', async () => ({ status: 'ok' }));
  registerRunRoutes(app, config);
  registerPipelineRoutes(app);

  app.addHook('onClose', async () => {
    await closeTemporalClient();
  });

  return { app, config };
}

async function main(): Promise<void> {
  const { app, config } = createServer();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
