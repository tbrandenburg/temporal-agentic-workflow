#!/usr/bin/env node
import { parseArgs } from 'node:util';
import type { AgentInput, AgentRole } from '@poc/agent-contracts';
import { runOpencode } from './opencode-adapter';
import { composePrompt } from './prompt-composer';
import { normalizeAgentResult } from './result-normalizer';

const ROLES: readonly AgentRole[] = ['planner', 'coder', 'reviewer'];

function isRole(value: string): value is AgentRole {
  return (ROLES as readonly string[]).includes(value);
}

function parseCliArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      role: { type: 'string' },
      repository: { type: 'string', default: 'local/fixture' },
      'task-class': { type: 'string', default: 'chore' },
      instruction: { type: 'string', default: 'Describe what you can do in this workspace.' },
      model: { type: 'string' },
      dir: { type: 'string', default: process.cwd() },
      'run-id': { type: 'string', default: 'cli-run' },
      'timeout-ms': { type: 'string' },
    },
  });
  return values;
}

/**
 * `agent-runtime run --role <role> ...` — composes the prompt, invokes the
 * adapter (mock or real per `AGENT_MODE`), normalizes the output, and
 * prints the resulting `AgentResult` JSON to stdout. Per PLAN §2.
 */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;
  if (command !== 'run') {
    process.stderr.write(
      `unknown command: ${command ?? '(none)'}. Usage: agent-runtime run --role <role> ...\n`,
    );
    process.exitCode = 1;
    return;
  }

  const args = parseCliArgs(rest);
  if (!args.role || !isRole(args.role)) {
    process.stderr.write(`--role is required and must be one of: ${ROLES.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const input: AgentInput = {
    role: args.role,
    context: {
      run_id: args['run-id'] as string,
      repository: args.repository as string,
      task_class: args['task-class'] as AgentInput['context']['task_class'],
      instruction: args.instruction as string,
    },
  };

  const prompt = composePrompt(input);
  const adapterOptions: Parameters<typeof runOpencode>[1] = { dir: args.dir as string };
  if (args.model) adapterOptions.model = args.model;
  if (args['timeout-ms']) adapterOptions.timeoutMs = Number(args['timeout-ms']);
  const raw = await runOpencode(prompt, adapterOptions);
  const result = normalizeAgentResult(raw, { runId: input.context.run_id, role: input.role });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
