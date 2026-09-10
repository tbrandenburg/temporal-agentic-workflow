import { defineQuery } from '@temporalio/workflow';

/**
 * The run's current phase, mirroring the `RunStatus` search attribute value
 * (PLAN §4.2 / §5.1). Loosened from a fixed union
 * (`'initializing' | 'planning' | 'coding' | ...`) to a plain `string` as
 * part of PLAN Step 4 / this step's documented deviation: since the
 * workflow is now a generic pipeline interpreter, the in-flight phase is
 * whatever step id the current pipeline declares (arbitrary per pipeline),
 * plus the fixed terminal values `succeeded`/`failed`/`cancelled` set by
 * the interpreter itself. A fixed union can no longer enumerate every
 * possible step id across every pipeline.
 */
export type RunStatus = string;

/**
 * `runStatus` query — lets `GET /runs/:id` read the in-flight phase without
 * a bespoke database, per PLAN §5.1 and §8.
 */
export const runStatusQuery = defineQuery<RunStatus>('runStatus');
