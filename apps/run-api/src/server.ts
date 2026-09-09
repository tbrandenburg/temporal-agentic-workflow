// Phase 0 placeholder. Fastify instance + plugin registration lands in Phase 1.
import { loadConfig } from './config';
import { registerRunRoutes } from './routes/runs';

export function createServer(): { port: number } {
  const config = loadConfig();
  registerRunRoutes();
  return { port: config.port };
}
