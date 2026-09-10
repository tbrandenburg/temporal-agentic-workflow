// Phase 6 evidence-capture fault injection — PLAN §9 Phase 6.
//
// Every hook here is opt-in via an `EVIDENCE_*` env var and a no-op
// otherwise, so production and every existing test path is unaffected.
// It exists because mock mode's opencode stand-in never touches the
// filesystem or produces varying output, so on its own it cannot exercise:
// a transient retry, a non-retryable malformed-output failure, a real git
// diff for `validatePatch` to accept or reject, or an activity slow enough
// to `kill -9` its worker mid-flight. This is the one place all five
// failure scenarios' evidence-only behaviour lives, kept out of
// `run-agent.ts` itself to keep that file's real logic readable.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const transientAttempts = new Map<string, number>();

/** EVIDENCE_DELAY_MS / EVIDENCE_DELAY_ROLE (default "coder") — scenario 1
 * (worker restart mid-run) needs an activity slow enough to `kill -9` the
 * worker while it is in flight. */
export async function maybeDelay(role: string): Promise<void> {
  const delayMs = Number(process.env.EVIDENCE_DELAY_MS ?? '');
  const targetRole = process.env.EVIDENCE_DELAY_ROLE ?? 'coder';
  if (!delayMs || role !== targetRole) return;
  await sleep(delayMs);
}

/** EVIDENCE_TRANSIENT_FAILS / EVIDENCE_TRANSIENT_ROLE (default "planner") —
 * scenario 2 (model failure and retry): throws a plain `Error` (retryable
 * by `activity-options.ts`'s default classification) for the first N
 * attempts, then lets the call through. */
export function maybeThrowTransient(role: string): void {
  const failCount = Number(process.env.EVIDENCE_TRANSIENT_FAILS ?? '');
  const targetRole = process.env.EVIDENCE_TRANSIENT_ROLE ?? 'planner';
  if (!failCount || role !== targetRole) return;
  const attempts = (transientAttempts.get(role) ?? 0) + 1;
  transientAttempts.set(role, attempts);
  if (attempts <= failCount) {
    throw new Error(`[evidence] simulated transient failure, attempt ${attempts}/${failCount}`);
  }
}

/** EVIDENCE_INVALID_JSON=1 / EVIDENCE_INVALID_JSON_ROLE (default "planner")
 * — scenario 3 (invalid agent JSON): busts `AgentResult.summary`'s 2048
 * char cap (`agent-contracts`) so `normalizeAgentResult` throws the real
 * `InvalidAgentOutputError` — a non-retryable type per §5.2 — instead of
 * a hand-rolled duplicate of that validation logic. */
export function maybeCorruptSummary(role: string, finalText: string): string {
  const targetRole = process.env.EVIDENCE_INVALID_JSON_ROLE ?? 'planner';
  if (process.env.EVIDENCE_INVALID_JSON !== '1' || role !== targetRole) return finalText;
  return finalText.repeat(200);
}

const SAFE_GREET = [
  '// evidence: safe edit, keeps the test-asserted greeting string intact',
  'function greet(name) {',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: generated JS source, not a template literal.
  '  return `Hello, ${name}!`;',
  '}',
  '',
  'module.exports = { greet };',
  '',
].join('\n');

const BREAKING_GREET = [
  "// evidence: deliberately breaks greet.test.js's expected string",
  'function greet(name) {',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: generated JS source, not a template literal.
  '  return `Goodbye, ${name}!`;',
  '}',
  '',
  'module.exports = { greet };',
  '',
].join('\n');

/** EVIDENCE_CODER_EDIT=safe|break-tests — scenarios 1/5/happy-path need a
 * real filesystem edit in the coder's seeded workspace so `git diff`
 * produces a genuine patch artifact for `validatePatch` to act on; mock
 * mode's opencode stand-in never touches the filesystem on its own. */
export async function maybeEditCoderWorkspace(workspacePath: string): Promise<void> {
  const mode = process.env.EVIDENCE_CODER_EDIT;
  if (mode !== 'safe' && mode !== 'break-tests') return;
  const target = join(workspacePath, 'src', 'greet.js');
  await writeFile(target, mode === 'safe' ? SAFE_GREET : BREAKING_GREET);
}

/** EVIDENCE_CORRUPT_PATCH=1 — scenario 4 (invalid patch): mangles the real
 * diff's hunk-header line counts so `git apply --check` rejects it as
 * corrupt, without hand-writing a fake patch that bypasses the real
 * git-diff path `run-agent.ts` exercises for every other scenario. */
export function maybeCorruptPatch(diffText: string): string {
  if (process.env.EVIDENCE_CORRUPT_PATCH !== '1') return diffText;
  return diffText.replace(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/m, '@@ -$1,99 +$3,99 @@');
}
