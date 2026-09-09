import { z } from 'zod';

export const taskClassSchema = z.enum(['feature', 'bugfix', 'refactor', 'chore']);
export type TaskClass = z.infer<typeof taskClassSchema>;

/**
 * TaskRequest — Run API input, per PLAN §3.1.
 */
export const taskRequestSchema = z.object({
  run_id: z.string().ulid().optional(),
  repository: z.string().min(1),
  task_class: taskClassSchema,
  instruction: z.string().min(1).max(8000),
  requested_model: z.string().min(1).optional(),
  allowed_paths: z.array(z.string().min(1)).optional(),
  timeout_seconds: z.number().int().min(60).max(3600).optional(),
});

export type TaskRequest = z.infer<typeof taskRequestSchema>;
