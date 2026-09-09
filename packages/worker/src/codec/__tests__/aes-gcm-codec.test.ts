import type { Payload } from '@temporalio/common';
import { describe, expect, it } from 'vitest';
import { AesGcmCodec, AesGcmCodecKeyError, parseAesGcmKey } from '../aes-gcm-codec';

const KEY = Buffer.alloc(32, 7).toString('base64');

function first(payloads: Payload[]): Payload {
  const payload = payloads[0];
  if (!payload) throw new Error('expected at least one payload');
  return payload;
}

describe('parseAesGcmKey', () => {
  it('throws when the key is missing', () => {
    expect(() => parseAesGcmKey(undefined)).toThrow(AesGcmCodecKeyError);
  });

  it('throws when the decoded key is the wrong length', () => {
    expect(() => parseAesGcmKey(Buffer.alloc(16).toString('base64'))).toThrow(AesGcmCodecKeyError);
  });

  it('accepts a valid 32-byte base64 key', () => {
    expect(parseAesGcmKey(KEY)).toHaveLength(32);
  });
});

describe('AesGcmCodec', () => {
  const codec = new AesGcmCodec(parseAesGcmKey(KEY));

  it('round-trips a payload, encrypting data and marking metadata', async () => {
    const original: Payload = {
      metadata: { encoding: Buffer.from('json/plain') },
      data: Buffer.from(JSON.stringify({ instruction: 'do the secret thing' })),
    };

    const encoded = first(await codec.encode([original]));
    expect(encoded.data).toBeDefined();
    expect(Buffer.from(encoded.data as Uint8Array)).not.toEqual(
      Buffer.from(original.data as Uint8Array),
    );
    expect(encoded.metadata?.['poc-encoding-codec']).toBeDefined();

    const decoded = first(await codec.decode([encoded]));
    expect(Buffer.from(decoded.data as Uint8Array).toString()).toBe(
      Buffer.from(original.data as Uint8Array).toString(),
    );
    expect(decoded.metadata?.['poc-encoding-codec']).toBeUndefined();
    expect(decoded.metadata?.encoding).toEqual(original.metadata?.encoding);
  });

  it('passes through payloads with no data unchanged', async () => {
    const payload: Payload = { metadata: { encoding: Buffer.from('binary/null') } };
    const encoded = first(await codec.encode([payload]));
    expect(encoded).toEqual(payload);
    const decoded = first(await codec.decode([encoded]));
    expect(decoded).toEqual(payload);
  });

  it('passes through unmarked payloads on decode (e.g. from before the codec was enabled)', async () => {
    const plain: Payload = {
      metadata: { encoding: Buffer.from('json/plain') },
      data: Buffer.from('{}'),
    };
    const decoded = first(await codec.decode([plain]));
    expect(decoded).toEqual(plain);
  });
});
