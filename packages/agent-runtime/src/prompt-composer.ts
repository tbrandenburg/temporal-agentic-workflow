import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentInput } from '@poc/agent-contracts';

const PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');

/** Reads the static role prompt from `prompts/<role>.md`. */
export function readRolePrompt(role: AgentInput['role']): string {
  return readFileSync(join(PROMPTS_DIR, `${role}.md`), 'utf8');
}

/**
 * Pure function combining the role prompt with the run context and any
 * upstream results into the final prompt string handed to the adapter.
 * Per PLAN §2: "role prompt + context/upstream → final prompt".
 */
export function composePrompt(
  input: AgentInput,
  rolePrompt: string = readRolePrompt(input.role),
): string {
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
      sections.push(`- [${result.agent}] (${result.status}): ${result.summary}`);
    }
  }

  return sections.join('\n');
}
