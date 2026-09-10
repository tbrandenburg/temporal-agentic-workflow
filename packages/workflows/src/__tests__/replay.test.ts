import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { historyFromJSON } from '@temporalio/common/lib/proto-utils';
import { Worker } from '@temporalio/worker';
import { describe, it } from 'vitest';

/**
 * Replay-determinism regression test, per PLAN §9 Phase 3 evidence:
 * "`Worker.runReplayHistory()` passing against the recorded history."
 *
 * The fixture (`fixtures/agent-run-history.json`) was captured once from a
 * real `agentRunWorkflow` execution (see
 * `scripts/generate-replay-fixture.ts`) and is committed. This test proves
 * the *current* workflow code produces the exact same command sequence
 * against that history — any future edit to `agent-run.workflow.ts` that
 * changes control flow non-deterministically (extra/missing/reordered
 * awaits, non-deterministic branching, etc.) fails this test without
 * needing a live Temporal server.
 */
describe('agentRunWorkflow replay determinism', () => {
  it('replays the recorded history without a non-determinism error', async () => {
    const raw = await readFile(join(__dirname, 'fixtures', 'agent-run-history.json'), 'utf8');
    const history = historyFromJSON(JSON.parse(raw));

    await Worker.runReplayHistory(
      { workflowsPath: join(__dirname, '..', 'index.ts') },
      history,
      'agent-run/replay-fixture',
    );
  }, 30_000);
});
