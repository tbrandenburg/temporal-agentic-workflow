// Phase 1 — trivial workflow proving the worker/client/workflow wiring works
// end to end. Real orchestration (agentRunWorkflow) lands in Phase 3.
export async function pingWorkflow(): Promise<string> {
  return 'pong';
}
