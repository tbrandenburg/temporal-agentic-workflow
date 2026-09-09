import type { AgentInput } from '@poc/agent-contracts';
import { execa } from 'execa';
import { resolveAgentMode } from './modes';

/**
 * Minimal reasonable shape for a single opencode `--format json` event.
 * The real event stream (see live capture) carries many event `type`s
 * (`step_start`, `tool_use`, `step_finish`, ...); we only need the final
 * assistant text and error/exit signalling for the PoC, so this is
 * intentionally narrow rather than a full schema of opencode's wire
 * format.
 */
export interface OpencodeEvent {
  type: string;
  timestamp?: number;
  part?: {
    type?: string;
    text?: string;
  };
  [key: string]: unknown;
}

export interface RawAgentOutput {
  events: OpencodeEvent[];
  /** Concatenated text of every `type: "text"` event part — the agent's final reply. */
  finalText: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  timedOut: boolean;
}

export class SubprocessFailedError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`opencode run exited with code ${exitCode}`);
    this.name = 'SubprocessFailedError';
  }
}

export class SubprocessTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`opencode run timed out after ${timeoutMs}ms`);
    this.name = 'SubprocessTimeoutError';
  }
}

export interface OpencodeAdapterOptions {
  /** Overridable for tests: point at a stub binary on PATH instead of the real `opencode`. */
  binary?: string;
  model?: string;
  dir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/** Parses NDJSON stdout — one JSON event per line, tolerating blank lines. */
function parseEventStream(stdout: string): OpencodeEvent[] {
  const events: OpencodeEvent[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed) as OpencodeEvent);
  }
  return events;
}

function finalTextOf(events: OpencodeEvent[]): string {
  return events
    .filter((event) => event.type === 'text' && typeof event.part?.text === 'string')
    .map((event) => event.part?.text ?? '')
    .join('\n')
    .trim();
}

/** A deterministic fixture used by mock mode — no subprocess spawned. */
function mockOutput(prompt: string): RawAgentOutput {
  const startedAt = new Date(0).toISOString();
  const endedAt = new Date(1).toISOString();
  const finalText = `[mock] processed prompt of ${prompt.length} chars`;
  return {
    events: [{ type: 'text', part: { type: 'text', text: finalText } }],
    finalText,
    stdout: '',
    stderr: '',
    exitCode: 0,
    startedAt,
    endedAt,
    durationMs: 1,
    timedOut: false,
  };
}

/**
 * Spawns `opencode run --format json ...` (per PLAN §6.3) and parses its
 * NDJSON event stream. In mock mode (`AGENT_MODE=mock`, the default),
 * returns a fixture instead of spawning anything.
 *
 * Throws `SubprocessFailedError` on non-zero exit and
 * `SubprocessTimeoutError` when execa reports a timeout. Malformed JSON in
 * the event stream propagates as a `SyntaxError` from `JSON.parse`, which
 * callers should treat the same as any other malformed-output failure.
 */
export async function runOpencode(
  prompt: string,
  options: OpencodeAdapterOptions,
): Promise<RawAgentOutput> {
  const env = options.env ?? process.env;
  if (resolveAgentMode(env) === 'mock') {
    return mockOutput(prompt);
  }

  const binary = options.binary ?? 'opencode';
  const args = ['run', '--format', 'json', '--dir', options.dir, '--auto', '--print-logs'];
  if (options.model) args.push('--model', options.model);
  args.push(prompt);

  const startedAt = new Date().toISOString();
  const start = Date.now();

  const execaOptions: {
    reject: false;
    stdin: 'ignore';
    timeout?: number;
    cancelSignal?: AbortSignal;
  } = {
    reject: false,
    // `opencode run` reads/waits on stdin in some environments even with
    // `--auto`; without a tty this leaves the pipe open and the subprocess
    // (and execa) hangs indefinitely. Confirmed by direct reproduction:
    // identical args succeed immediately with `stdin: 'ignore'` and hang
    // for 150s+ otherwise.
    stdin: 'ignore',
  };
  if (options.timeoutMs !== undefined) execaOptions.timeout = options.timeoutMs;
  if (options.signal !== undefined) execaOptions.cancelSignal = options.signal;

  try {
    const result = await execa(binary, args, execaOptions);

    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - start;

    if (result.timedOut) {
      throw new SubprocessTimeoutError(options.timeoutMs ?? 0);
    }

    if (result.exitCode !== 0) {
      throw new SubprocessFailedError(result.exitCode ?? -1, String(result.stderr ?? ''));
    }

    const events = parseEventStream(String(result.stdout ?? ''));

    return {
      events,
      finalText: finalTextOf(events),
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      exitCode: result.exitCode ?? 0,
      startedAt,
      endedAt,
      durationMs,
      timedOut: false,
    };
  } catch (error) {
    if (error instanceof SubprocessFailedError || error instanceof SubprocessTimeoutError) {
      throw error;
    }
    // execa itself throws (with reject:false this is rare, but a spawn
    // failure — e.g. ENOENT — still throws) — surface timeouts distinctly.
    if (
      error &&
      typeof error === 'object' &&
      'timedOut' in error &&
      (error as { timedOut?: boolean }).timedOut
    ) {
      throw new SubprocessTimeoutError(options.timeoutMs ?? 0);
    }
    throw error;
  }
}

export type { AgentInput };
