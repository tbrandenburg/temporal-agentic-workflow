import { pipelineDefinitionSchema } from '../../packages/agent-contracts/dist';

/**
 * `summarizer-critic` — a second, deliberately non-code pipeline (PLAN Step
 * 5) proving the interpreter has no coder-specific branches: two agent
 * steps, no validation step, no patch production.
 */
export const summarizerCriticPipeline = pipelineDefinitionSchema.parse({
  name: 'summarizer-critic',
  steps: [
    { id: 'summarizer', kind: 'agent', dryRun: true },
    { id: 'critic', kind: 'agent', dryRun: true, upstream: ['summarizer'] },
  ],
});
