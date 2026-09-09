import { defineSearchAttributeKey, SearchAttributeType } from '@temporalio/common';

/**
 * Typed search-attribute keys, per PLAN §1.2 point 2 and §4.2.
 *
 * These must additionally be registered against the Temporal namespace via
 * `infra/temporal/register-search-attributes.sh` before first use — this
 * module only defines the typed keys used by `upsertSearchAttributes` /
 * `typedSearchAttributes`, it does not perform registration.
 */
export const RunIdKey = defineSearchAttributeKey('RunId', SearchAttributeType.KEYWORD);
export const RepositoryKey = defineSearchAttributeKey('Repository', SearchAttributeType.KEYWORD);
export const RunStatusKey = defineSearchAttributeKey('RunStatus', SearchAttributeType.KEYWORD);
export const RequestedModelKey = defineSearchAttributeKey(
  'RequestedModel',
  SearchAttributeType.KEYWORD,
);
export const TaskClassKey = defineSearchAttributeKey('TaskClass', SearchAttributeType.KEYWORD);
