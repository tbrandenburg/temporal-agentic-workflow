// Fastify instance + plugin registration. Phase 1: single POST /runs route.
import Fastify from 'fastify';
import { loadConfig } from './config';
import { registerRunRoutes } from './routes/runs';
import { closeTemporalClient } from './temporal-client';

export function createServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));
  registerRunRoutes(app, config);

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
