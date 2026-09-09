// Env parsing (PORT default 3300). Phase 1.
export interface Config {
  port: number;
  temporalAddress: string;
  temporalNamespace: string;
}

export function loadConfig(): Config {
  const port = process.env.PORT ? Number(process.env.PORT) : 3300;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`invalid PORT: ${process.env.PORT}`);
  }
  return {
    port,
    temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
  };
}
