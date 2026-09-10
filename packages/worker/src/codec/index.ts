import type { PayloadCodec } from '@temporalio/common';
import { AesGcmCodec, parseAesGcmKey } from './aes-gcm-codec';
import { IdentityCodec } from './identity-codec';

export type PayloadCodecMode = 'identity' | 'aes-gcm';

export function resolvePayloadCodecMode(env: NodeJS.ProcessEnv = process.env): PayloadCodecMode {
  return env.PAYLOAD_CODEC === 'aes-gcm' ? 'aes-gcm' : 'identity';
}

/**
 * Builds the `payloadCodecs` array for `DataConverter` (`Worker.create` /
 * `Client` options), per PLAN §1.2 point 8. Defaults to the identity codec
 * so enabling encryption is a config change (`PAYLOAD_CODEC=aes-gcm` +
 * `PAYLOAD_CODEC_AES_KEY`), never a code change, and nothing breaks when
 * the flag is unset.
 */
export function buildPayloadCodecs(env: NodeJS.ProcessEnv = process.env): PayloadCodec[] {
  if (resolvePayloadCodecMode(env) === 'aes-gcm') {
    return [new AesGcmCodec(parseAesGcmKey(env.PAYLOAD_CODEC_AES_KEY))];
  }
  return [new IdentityCodec()];
}

export { AesGcmCodec, AesGcmCodecKeyError, parseAesGcmKey } from './aes-gcm-codec';
export { IdentityCodec } from './identity-codec';
