/**
 * Secret scanning across produced artifacts — PLAN §7 step 6. Any hit
 * fails the run; the plan says the offending artifact is redacted before
 * upload, so `redact` is exported alongside `scanForSecrets` for the
 * caller to apply before writing to the artifact store.
 */
export interface SecretMatch {
  kind: string;
  /** Redacted preview — never the raw secret value. */
  preview: string;
}

interface SecretPattern {
  kind: string;
  regex: RegExp;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: 'aws-access-key-id', regex: /AKIA[0-9A-Z]{16}/g },
  {
    kind: 'generic-api-key',
    regex: /(?:api|secret)[_-]?key["']?\s*[:=]\s*["'][A-Za-z0-9/+_-]{16,}["']/gi,
  },
  { kind: 'private-key-block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: 'generic-bearer-token', regex: /Bearer [A-Za-z0-9\-._~+/]{20,}/g },
];

function redactMatch(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}

/** Scans `content` against known secret patterns, returning every match (redacted). */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { kind, regex } of SECRET_PATTERNS) {
    for (const match of content.matchAll(regex)) {
      matches.push({ kind, preview: redactMatch(match[0]) });
    }
  }
  return matches;
}

/** Replaces every secret match in `content` with a redaction marker. */
export function redact(content: string): string {
  let redacted = content;
  for (const { regex } of SECRET_PATTERNS) {
    redacted = redacted.replace(regex, '[REDACTED]');
  }
  return redacted;
}
