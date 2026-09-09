import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Payload, PayloadCodec } from '@temporalio/common';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Metadata key used to mark a payload as AES-GCM-encrypted, so `decode` knows to reverse it
 * and leaves every other payload (e.g. one produced before the codec was enabled) untouched. */
const MARKER_KEY = 'poc-encoding-codec';
const MARKER_VALUE = Buffer.from(ALGORITHM);

export class AesGcmCodecKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AesGcmCodecKeyError';
  }
}

/** Parses and validates the base64-encoded 32-byte AES-256-GCM key from env, per PLAN §1.2
 * point 8 / §2 (`PayloadCodec` interface, AES-GCM codec behind a flag). */
export function parseAesGcmKey(base64Key: string | undefined): Buffer {
  if (!base64Key) {
    throw new AesGcmCodecKeyError(
      'PAYLOAD_CODEC=aes-gcm requires PAYLOAD_CODEC_AES_KEY (base64, 32 bytes) to be set',
    );
  }
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new AesGcmCodecKeyError(
      `PAYLOAD_CODEC_AES_KEY must decode to ${KEY_LENGTH} bytes, got ${key.length}`,
    );
  }
  return key;
}

function isEncrypted(payload: Payload): boolean {
  const marker = payload.metadata?.[MARKER_KEY];
  return marker !== undefined && Buffer.from(marker).equals(MARKER_VALUE);
}

/**
 * AES-256-GCM `PayloadCodec` (PLAN §1.2 point 8 / §2), enabled via
 * `PAYLOAD_CODEC=aes-gcm`. Encrypts every payload's `data` field; the
 * ciphertext layout is `iv (12B) || authTag (16B) || ciphertext`. A single
 * extra metadata marker records that a payload was encrypted so `decode`
 * can pass through anything that wasn't (e.g. payloads written before the
 * codec was enabled).
 */
export class AesGcmCodec implements PayloadCodec {
  constructor(private readonly key: Buffer) {}

  async encode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map((payload) => {
      if (payload.data === undefined || payload.data === null) return payload;

      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this.key, iv);
      const ciphertext = Buffer.concat([cipher.update(payload.data), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return {
        metadata: { ...payload.metadata, [MARKER_KEY]: MARKER_VALUE },
        data: Buffer.concat([iv, authTag, ciphertext]),
      };
    });
  }

  async decode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map((payload) => {
      if (payload.data === undefined || payload.data === null || !isEncrypted(payload)) {
        return payload;
      }

      const buf = Buffer.from(payload.data);
      const iv = buf.subarray(0, IV_LENGTH);
      const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      const metadata = { ...payload.metadata };
      delete metadata[MARKER_KEY];
      return { metadata, data: plaintext };
    });
  }
}
