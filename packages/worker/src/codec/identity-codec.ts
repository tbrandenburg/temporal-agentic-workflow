import type { Payload, PayloadCodec } from '@temporalio/common';

/**
 * The default `PayloadCodec` (PLAN §1.2 point 8 / §2 `worker/src/codec/`):
 * passes payloads through unchanged. Enabling encryption later is a config
 * change (`PAYLOAD_CODEC=aes-gcm`), not a refactor — this is why the codec
 * interface exists from Phase 5 rather than being bolted on later.
 */
export class IdentityCodec implements PayloadCodec {
  async encode(payloads: Payload[]): Promise<Payload[]> {
    return payloads;
  }

  async decode(payloads: Payload[]): Promise<Payload[]> {
    return payloads;
  }
}
