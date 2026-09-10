import type {
  AgentInput,
  AgentResult,
  PipelineDefinition,
  RunContext,
  RunOutcome,
  RunSummary,
  TaskRequest,
  ValidationResult,
} from '@poc/agent-contracts';
import { ActivityCancellationType, proxyActivities } from '@temporalio/workflow';

/**
 * `validatePatch` input — PLAN §5.1 (`validationActivities.validatePatch({ context, coderResult })`).
 */
export interface ValidatePatchInput {
  context: RunContext;
  coderResult: AgentResult;
}

/**
 * `publishRunSummary` input — generalized for the pipeline interpreter
 * (PLAN Step 4 + this step's documented deviation): the fixed
 * `plan`/`code`/`validation`/`review` fields are replaced by a generic
 * `results` map keyed by pipeline step id. `Record`, not `Map`, because
 * Temporal activity arguments must be JSON-serializable and `Map` is not.
 * `status` is computed once by the workflow (from the last validation-kind
 * step's status, or `succeeded` if there is none) and passed through
 * explicitly, so `publishRunSummary` doesn't need to reach into `results`
 * and guess which entry was the "validation" step.
 */
export interface PublishRunSummaryInput {
  context: RunContext;
  results: Record<string, AgentResult | ValidationResult>;
  status: RunOutcome;
}

export interface AgentDefaultActivities {
  initializeRun(task: TaskRequest): Promise<{ context: RunContext; pipeline: PipelineDefinition }>;
  runAgent(input: AgentInput): Promise<AgentResult>;
  publishRunSummary(input: PublishRunSummaryInput): Promise<RunSummary>;
}

export interface ToolValidationActivities {
  validatePatch(input: ValidatePatchInput): Promise<ValidationResult>;
}

/**
 * Activity options per PLAN §5.2. Three separate `proxyActivities` calls
 * (rather than one) so each activity gets its own timeout/retry policy;
 * all three route to the `agent-default` queue. `validatePatch` gets its
 * own proxy onto `tool-validation` — this is how the queue-routing table
 * in PLAN §6.1 becomes real routing rather than documentation.
 *
 * Non-retryable error type names are declared as plain strings (not
 * imported classes) so this module has no dependency on the activity
 * implementations living in `@poc/worker` / `@poc/agent-runtime` — workflow
 * code must stay pure and only import from `@temporalio/workflow` and
 * type-only contract packages (PLAN §5.1 "Purity").
 */
const { initializeRun } = proxyActivities<AgentDefaultActivities>({
  taskQueue: 'agent-default',
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['UnknownPipelineError'],
  },
});

const { runAgent } = proxyActivities<AgentDefaultActivities>({
  taskQueue: 'agent-default',
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '30 seconds',
  // PLAN §1.2 point 3: wait for `runAgent`'s cleanup (SIGTERM/SIGKILL the
  // opencode subprocess, flush partial logs) to actually finish before the
  // workflow observes the cancellation, rather than racing ahead.
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['InvalidAgentOutputError', 'ModelNotAllowedError'],
  },
});

const { publishRunSummary } = proxyActivities<AgentDefaultActivities>({
  taskQueue: 'agent-default',
  startToCloseTimeout: '60 seconds',
  retry: { maximumAttempts: 5 },
});

const { validatePatch } = proxyActivities<ToolValidationActivities>({
  taskQueue: 'tool-validation',
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    maximumAttempts: 2,
    nonRetryableErrorTypes: ['PatchApplyFailedError', 'AllowlistViolationError'],
  },
});

export const agentActivities = { initializeRun, runAgent, publishRunSummary };
export const validationActivities = { validatePatch };
