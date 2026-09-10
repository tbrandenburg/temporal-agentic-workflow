/**
 * `AGENT_MODE` env-driven mode selection, per PLAN §6.3.
 *
 * `mock` — the default for every test below Phase 6; returns fixtures
 * without spawning `opencode`, so the suite stays fast, deterministic, and
 * free.
 * `real` — spawns the real `opencode run` subprocess (Phase 6 onward).
 */
export type AgentMode = 'mock' | 'real';

export function resolveAgentMode(env: NodeJS.ProcessEnv = process.env): AgentMode {
  const raw = env.AGENT_MODE;
  if (raw === 'real') return 'real';
  return 'mock';
}
