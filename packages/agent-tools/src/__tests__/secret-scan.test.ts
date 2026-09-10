import { describe, expect, it } from 'vitest';
import { redact, scanForSecrets } from '../secret-scan';

describe('scanForSecrets', () => {
  it('returns no matches for clean content', () => {
    expect(scanForSecrets('const greeting = "hello world";')).toEqual([]);
  });

  it('detects a planted AWS access key id', () => {
    const matches = scanForSecrets('const key = "AKIAABCDEFGHIJKLMNOP";');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe('aws-access-key-id');
    expect(matches[0]?.preview).not.toContain('ABCDEFGHIJKLMNOP');
  });

  it('detects a generic api_key assignment', () => {
    const matches = scanForSecrets('api_key: "sk_live_1234567890abcdef1234"');
    expect(matches.some((m) => m.kind === 'generic-api-key')).toBe(true);
  });

  it('detects a private key block', () => {
    const matches = scanForSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n-----END RSA PRIVATE KEY-----',
    );
    expect(matches.some((m) => m.kind === 'private-key-block')).toBe(true);
  });

  it('never includes the raw secret value in the preview', () => {
    const secret = 'AKIAABCDEFGHIJKLMNOP';
    const matches = scanForSecrets(`token=${secret}`);
    for (const match of matches) {
      expect(match.preview).not.toBe(secret);
    }
  });
});

describe('redact', () => {
  it('replaces every detected secret with a redaction marker', () => {
    const content = 'key = "AKIAABCDEFGHIJKLMNOP"';
    const redacted = redact(content);
    expect(redacted).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(redacted).toContain('[REDACTED]');
  });

  it('leaves clean content untouched', () => {
    expect(redact('nothing to see here')).toBe('nothing to see here');
  });
});
