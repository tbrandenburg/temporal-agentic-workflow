import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from '../store';

const config = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'agent-artifacts',
  accessKeyId: 'test',
  secretAccessKey: 'test',
};

describe('ArtifactStore', () => {
  it('put() writes to the deterministic key and returns the artifact ref', async () => {
    const send = vi.fn(async () => ({}));
    const store = new ArtifactStore(config, { send } as never);

    const ref = await store.put('r1', 'planner', 'plan.md', 'plan body');

    expect(ref).toBe('artifact://runs/r1/planner/plan.md');
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'agent-artifacts',
      Key: 'runs/r1/planner/plan.md',
      Body: 'plan body',
    });
  });

  it('get() reads the body for an artifact:// ref', async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      return { Body: { transformToString: async () => 'plan body' } };
    });
    const store = new ArtifactStore(config, { send } as never);

    const body = await store.get('artifact://runs/r1/planner/plan.md');

    expect(body).toBe('plan body');
  });

  it('get() returns empty string when the object has no body', async () => {
    const send = vi.fn(async () => ({ Body: undefined }));
    const store = new ArtifactStore(config, { send } as never);

    expect(await store.get('artifact://runs/r1/planner/plan.md')).toBe('');
  });

  it('presign() rejects a malformed ref before calling the client', async () => {
    const send = vi.fn();
    const store = new ArtifactStore(config, { send } as never);

    await expect(store.presign('not-a-ref')).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
