import { defineQuery } from '@temporalio/workflow';

/**
 * The run's current phase, mirroring the `RunStatus` search attribute values
 * (PLAN §4.2 / §5.1): initializing -> planning -> coding -> validating ->
 * reviewing -> succeeded|failed|cancelled.
 */
export type RunStatus =
  | 'initializing'
  | 'planning'
  | 'coding'
  | 'validating'
  | 'reviewing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/**
 * `runStatus` query — lets `GET /runs/:id` read the in-flight phase without
 * a bespoke database, per PLAN §5.1 and §8.
 */
export const runStatusQuery = defineQuery<RunStatus>('runStatus');
