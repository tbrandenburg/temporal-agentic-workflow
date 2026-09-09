// Phase 0 placeholder. Env parsing (PORT default 3300) lands in Phase 1.
export interface Config {
  port: number;
}

export function loadConfig(): Config {
  return { port: 3300 };
}
