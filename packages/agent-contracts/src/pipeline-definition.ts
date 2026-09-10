import { z } from 'zod';

/**
 * PipelineStep — one node in a `PipelineDefinition`, per PLAN Step 0. This is
 * exactly the shape the (future) interpreter needs to dispatch a step and
 * resolve its upstream results — nothing pipeline-specific (role names,
 * prompt content) leaks into the schema itself.
 */
export const pipelineStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['agent', 'validation']),
  promptFile: z.string().min(1).optional(),
  upstream: z.array(z.string().min(1)).optional(),
  producesPatch: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export type PipelineStep = z.infer<typeof pipelineStepSchema>;

/**
 * PipelineDefinition — a named, ordered list of steps. Validation enforces
 * two invariants the interpreter relies on:
 *  - step ids are unique within the pipeline;
 *  - every `upstream` reference points to an id already defined earlier in
 *    `steps`, guaranteeing a valid (forward-only) dependency order without
 *    needing a separate topological sort at runtime.
 */
export const pipelineDefinitionSchema = z
  .object({
    name: z.string().min(1),
    steps: z.array(pipelineStepSchema).min(1),
  })
  .superRefine((pipeline, ctx) => {
    const seenIds = new Set<string>();

    pipeline.steps.forEach((step, index) => {
      if (seenIds.has(step.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate step id "${step.id}"`,
          path: ['steps', index, 'id'],
        });
      }

      for (const upstreamId of step.upstream ?? []) {
        if (!seenIds.has(upstreamId)) {
          ctx.addIssue({
            code: 'custom',
            message: `step "${step.id}" references unknown or not-yet-defined upstream id "${upstreamId}"`,
            path: ['steps', index, 'upstream'],
          });
        }
      }

      seenIds.add(step.id);
    });
  });

export type PipelineDefinition = z.infer<typeof pipelineDefinitionSchema>;
