import type { PipelineDefinition } from '../packages/agent-contracts/dist';
import { codingReviewPipeline } from './coding-review/pipeline';
import { summarizerCriticPipeline } from './summarizer-critic/pipeline';

/**
 * `registry` — a plain, statically-built map of pipeline name to
 * `PipelineDefinition`. No filesystem scanning or dynamic imports: every
 * pipeline is imported at the top of this file, keeping lookup synchronous
 * and testable (PLAN Step 1).
 *
 * Keyed by each pipeline's own `.name` (not a separately hardcoded string)
 * to avoid drift between the map key and the definition (PLAN Step 5).
 */
export const registry: Record<string, PipelineDefinition> = {
  [codingReviewPipeline.name]: codingReviewPipeline,
  [summarizerCriticPipeline.name]: summarizerCriticPipeline,
};
