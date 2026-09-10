import type { Payload } from '@temporalio/common';
import { describe, expect, it } from 'vitest';
import { IdentityCodec } from '../identity-codec';

describe('IdentityCodec', () => {
  const codec = new IdentityCodec();

  it('returns payloads unchanged on encode and decode', async () => {
    const payloads: Payload[] = [
      { metadata: { encoding: Buffer.from('json/plain') }, data: Buffer.from('{"a":1}') },
    ];
    expect(await codec.encode(payloads)).toBe(payloads);
    expect(await codec.decode(payloads)).toBe(payloads);
  });
});
