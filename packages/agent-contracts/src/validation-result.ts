import { z } from 'zod';
import { artifactRefSchema } from './artifact-ref';

const validationStepNameSchema = z.enum([
  'apply',
  'allowlist',
  'format',
  'lint',
  'test',
  'secret-scan',
]);

const validationStepStatusSchema = z.enum(['passed', 'failed']);

const validationStepSchema = z.object({
  name: validationStepNameSchema,
  status: validationStepStatusSchema,
  duration_ms: z.number().int().nonnegative(),
  output_ref: artifactRefSchema.optional(),
});

const violationSeveritySchema = z.enum(['warning', 'error']);

const violationSchema = z.object({
  step: validationStepNameSchema,
  severity: violationSeveritySchema,
  message: z.string().min(1),
});

/**
 * ValidationResult — per PLAN §3.3. This is the object the reviewer
 * receives; the workflow (not the reviewer) decides the run outcome from
 * `status`.
 */
export const validationResultSchema = z.object({
  run_id: z.string().min(1),
  status: z.enum(['passed', 'failed']),
  steps: z.array(validationStepSchema),
  violations: z.array(violationSchema),
  artifact_refs: z.record(z.string(), artifactRefSchema),
});

export type ValidationResult = z.infer<typeof validationResultSchema>;
