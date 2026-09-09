import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOpencode, SubprocessFailedError, SubprocessTimeoutError } from '../opencode-adapter';

const FIXTURES = join(__dirname, 'fixtures');
const realEnv = { AGENT_MODE: 'real' };

describe('runOpencode (mock mode)', () => {
  it('returns a fixture without spawning anything — mock is the default', async () => {
    const result = await runOpencode('some prompt', { dir: '/tmp' });
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toContain('mock');
    expect(result.timedOut).toBe(false);
  });

  it('is explicit about mock mode via AGENT_MODE=mock', async () => {
    const result = await runOpencode('some prompt', { dir: '/tmp', env: { AGENT_MODE: 'mock' } });
    expect(result.exitCode).toBe(0);
  });
});

describe('runOpencode (real mode, stub binary — exercises the real spawn/parse path)', () => {
  it('parses a valid NDJSON event stream from a real subprocess', async () => {
    const result = await runOpencode('prompt', {
      binary: join(FIXTURES, 'stub-ok.js'),
      dir: '/tmp',
      env: realEnv,
    });
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe('stub ok response');
    expect(result.events).toHaveLength(1);
  });

  it('throws a SyntaxError on malformed JSON in the event stream', async () => {
    await expect(
      runOpencode('prompt', {
        binary: join(FIXTURES, 'stub-malformed.js'),
        dir: '/tmp',
        env: realEnv,
      }),
    ).rejects.toThrow(SyntaxError);
  });

  it('throws SubprocessFailedError on non-zero exit', async () => {
    await expect(
      runOpencode('prompt', {
        binary: join(FIXTURES, 'stub-fail.js'),
        dir: '/tmp',
        env: realEnv,
      }),
    ).rejects.toThrow(SubprocessFailedError);
  });

  it('captures stderr in the SubprocessFailedError', async () => {
    try {
      await runOpencode('prompt', {
        binary: join(FIXTURES, 'stub-fail.js'),
        dir: '/tmp',
        env: realEnv,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SubprocessFailedError);
      expect((error as SubprocessFailedError).stderr).toContain('simulated fatal error');
      expect((error as SubprocessFailedError).exitCode).toBe(3);
    }
  });

  it('throws SubprocessTimeoutError when the subprocess exceeds timeoutMs', async () => {
    await expect(
      runOpencode('prompt', {
        binary: join(FIXTURES, 'stub-hang.js'),
        dir: '/tmp',
        env: realEnv,
        timeoutMs: 200,
      }),
    ).rejects.toThrow(SubprocessTimeoutError);
  }, 10_000);
});
