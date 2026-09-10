import { pipelineDefinitionSchema } from '../../packages/agent-contracts/dist';

/**
 * `coding-review` — the original planner → coder → validate → reviewer
 * pipeline, expressed as data for the generic interpreter (PLAN Step 5).
 *
 * No `promptFile` is set on any step: the interpreter's default
 * (`pipelines/${pipeline.name}/prompts/${step.id}.md`) resolves each prompt
 * because the file names match the step ids exactly.
 */
export const codingReviewPipeline = pipelineDefinitionSchema.parse({
  name: 'coding-review',
  steps: [
    { id: 'planner', kind: 'agent', dryRun: true },
    { id: 'coder', kind: 'agent', producesPatch: true, dryRun: true, upstream: ['planner'] },
    { id: 'validate', kind: 'validation', upstream: ['coder'] },
    { id: 'reviewer', kind: 'agent', dryRun: true, upstream: ['planner', 'coder', 'validate'] },
  ],
});
