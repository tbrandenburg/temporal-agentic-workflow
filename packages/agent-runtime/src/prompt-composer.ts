import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentInput } from '@poc/agent-contracts';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/** Reads a prompt file from a project-relative path (relative to repo root). */
export function readPromptFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/**
 * Pure function combining the role prompt with the run context and any
 * upstream results into the final prompt string handed to the adapter.
 * Per PLAN §2: "role prompt + context/upstream → final prompt".
 */
export function composePrompt(input: AgentInput, rolePrompt: string): string {
  const sections = [
    rolePrompt.trim(),
    '',
    '## Task',
    `Repository: ${input.context.repository}`,
    `Task class: ${input.context.task_class}`,
    `Instruction: ${input.context.instruction}`,
  ];

  if (input.upstream && input.upstream.length > 0) {
    sections.push('', '## Upstream results');
    for (const result of input.upstream) {
      // `upstream` is a union of `AgentResult` (has `.agent`/`.summary`) and
      // `ValidationResult` (has neither) — the reviewer's upstream includes
      // the validator's compact result per PLAN §5.1.
      if ('agent' in result) {
        sections.push(`- [${result.agent}] (${result.status}): ${result.summary}`);
      } else {
        const violationCount = result.violations.length;
        sections.push(
          `- [validation] (${result.status}): ${result.steps.length} step(s), ${violationCount} violation(s)`,
        );
      }
    }
  }

  return sections.join('\n');
}
