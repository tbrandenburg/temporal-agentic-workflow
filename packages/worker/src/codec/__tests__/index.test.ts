import { afterEach, describe, expect, it } from 'vitest';
import { AesGcmCodec, buildPayloadCodecs, IdentityCodec, resolvePayloadCodecMode } from '../index';

const KEY = Buffer.alloc(32, 9).toString('base64');

describe('resolvePayloadCodecMode / buildPayloadCodecs', () => {
  afterEach(() => {
    delete process.env.PAYLOAD_CODEC;
    delete process.env.PAYLOAD_CODEC_AES_KEY;
  });

  it('defaults to identity when PAYLOAD_CODEC is unset', () => {
    expect(resolvePayloadCodecMode({})).toBe('identity');
    const [codec] = buildPayloadCodecs({});
    expect(codec).toBeInstanceOf(IdentityCodec);
  });

  it('selects aes-gcm when PAYLOAD_CODEC=aes-gcm and a key is present', () => {
    const env = { PAYLOAD_CODEC: 'aes-gcm', PAYLOAD_CODEC_AES_KEY: KEY };
    expect(resolvePayloadCodecMode(env)).toBe('aes-gcm');
    const [codec] = buildPayloadCodecs(env);
    expect(codec).toBeInstanceOf(AesGcmCodec);
  });

  it('throws if aes-gcm is selected without a key', () => {
    expect(() => buildPayloadCodecs({ PAYLOAD_CODEC: 'aes-gcm' })).toThrow();
  });
});
