import type {
  AgentInput,
  AgentResult,
  RunSummary,
  TaskRequest,
  ValidationResult,
} from '@poc/agent-contracts';
import { RunStatusKey } from '@poc/agent-contracts';
import { setHandler, upsertSearchAttributes } from '@temporalio/workflow';
import { agentActivities, validationActivities } from './activity-options';
import { type RunStatus, runStatusQuery } from './queries';

/**
 * The generic pipeline interpreter, per PLAN §5.1 / Step 4. Unlike the
 * previous hardcoded planner->coder->validate->reviewer body, this
 * workflow carries no pipeline-specific knowledge: it iterates whatever
 * `pipeline.steps` the `initializeRun` activity resolved from the pipeline
 * registry (per PLAN Step 1) and dispatches each step by `kind`.
 *
 * Purity (enforced, not just documented): no file I/O, no network, no
 * `Date.now()`/`Math.random()` in this module — every side effect lives in
 * an activity.
 */
export async function agentRunWorkflow(task: TaskRequest): Promise<RunSummary> {
  let status: RunStatus = 'initializing';
  setHandler(runStatusQuery, () => status);
  const setStatus = (next: RunStatus): void => {
    status = next;
    upsertSearchAttributes([{ key: RunStatusKey, value: next }]);
  };
  setStatus('initializing');

  const { context, pipeline } = await agentActivities.initializeRun(task);

  const results = new Map<string, AgentResult | ValidationResult>();
  // Tracks the last validation-kind step's status. Stays `undefined` for a
  // pipeline with no validation step at all — a valid shape (PLAN Step 4:
  // "a pipeline with no validation step has no hard gate"), not a bug.
  let lastValidationStatus: ValidationResult['status'] | undefined;

  for (const step of pipeline.steps) {
    setStatus(step.id);

    // `pipelineDefinitionSchema` (Step 0/1) already guarantees every
    // `upstream` id references an earlier step, so a missing entry here
    // would be an interpreter bug, not a pipeline-authoring mistake.
    const upstream = (step.upstream ?? []).map((id) => {
      const result = results.get(id);
      if (!result) {
        throw new Error(`step "${step.id}" references unresolved upstream id "${id}"`);
      }
      return result;
    });

    if (step.kind === 'validation') {
      if (upstream.length !== 1) {
        throw new Error(
          `validation step "${step.id}" must declare exactly one upstream id (the patch-producing step), got ${upstream.length}`,
        );
      }
      const coderResult = upstream[0] as AgentResult | ValidationResult;
      if ('violations' in coderResult) {
        throw new Error(
          `validation step "${step.id}"'s upstream "${step.upstream?.[0]}" must be an AgentResult, not a ValidationResult`,
        );
      }
      const validation = await validationActivities.validatePatch({
        context,
        coderResult: coderResult as AgentResult,
      });
      results.set(step.id, validation);
      lastValidationStatus = validation.status;
      continue;
    }

    const input: AgentInput = {
      role: step.id,
      context,
      promptFile: step.promptFile ?? `pipelines/${pipeline.name}/prompts/${step.id}.md`,
      ...(step.producesPatch !== undefined ? { producesPatch: step.producesPatch } : {}),
      ...(step.dryRun !== undefined ? { dryRun: step.dryRun } : {}),
      ...(upstream.length > 0 ? { upstream } : {}),
    };
    const result = await agentActivities.runAgent(input);
    results.set(step.id, result);
  }

  const finalStatus = lastValidationStatus === 'failed' ? 'failed' : 'succeeded';
  setStatus(finalStatus);

  return agentActivities.publishRunSummary({
    context,
    results: Object.fromEntries(results),
    status: finalStatus,
  });
}
