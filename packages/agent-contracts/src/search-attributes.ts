import { defineSearchAttributeKey, SearchAttributeType } from '@temporalio/common';

/**
 * Typed search-attribute keys, per PLAN §1.2 point 2 and §4.2.
 *
 * These must additionally be registered against the Temporal namespace via
 * `infra/temporal/register-search-attributes.sh` before first use — this
 * module only defines the typed keys used by `upsertSearchAttributes` /
 * `typedSearchAttributes`, it does not perform registration.
 */
// NOTE (discovered during Phase 6 evidence capture, see
// docs/evidence/phase-6/): PLAN §4.2 named this attribute "RunId", but
// Temporal reserves that exact name for the system attribute holding the
// real workflow Run ID — `upsertSearchAttributes`/`typedSearchAttributes`
// reject any attempt to set it, even though `listSearchAttributes` reports
// it as already "registered" (it's a system, not custom, attribute), which
// made the collision invisible until a live `POST /runs` was actually
// exercised end-to-end. Renamed to `TaskRunId` to hold our business
// `TaskRequest.run_id` instead.
export const RunIdKey = defineSearchAttributeKey('TaskRunId', SearchAttributeType.KEYWORD);
export const RepositoryKey = defineSearchAttributeKey('Repository', SearchAttributeType.KEYWORD);
export const RunStatusKey = defineSearchAttributeKey('RunStatus', SearchAttributeType.KEYWORD);
export const RequestedModelKey = defineSearchAttributeKey(
  'RequestedModel',
  SearchAttributeType.KEYWORD,
);
export const TaskClassKey = defineSearchAttributeKey('TaskClass', SearchAttributeType.KEYWORD);
