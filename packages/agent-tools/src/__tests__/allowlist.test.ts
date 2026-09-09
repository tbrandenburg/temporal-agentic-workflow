import { describe, expect, it } from 'vitest';
import {
  AllowlistViolationError,
  enforceAllowlist,
  matchesAllowlist,
  parseTouchedPaths,
} from '../allowlist';

const VALID_PATCH = `diff --git a/src/greet.js b/src/greet.js
index 1111111..2222222 100644
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,3 +1,3 @@
 function greet(name) {
-  return \`Hello, \${name}!\`;
+  return \`Hi, \${name}!\`;
 }
`;

const ESCAPING_PATCH = `diff --git a/../../etc/passwd b/../../etc/passwd
index 1111111..2222222 100644
--- a/../../etc/passwd
+++ b/../../etc/passwd
@@ -1 +1 @@
-root:x:0:0:root:/root:/bin/bash
+pwned:x:0:0:root:/root:/bin/bash
`;

describe('parseTouchedPaths', () => {
  it('extracts a/ and b/ paths from a diff header', () => {
    expect(parseTouchedPaths(VALID_PATCH)).toEqual(['src/greet.js']);
  });

  it('extracts multiple distinct files across hunks', () => {
    const patch = `${VALID_PATCH}diff --git a/src/other.js b/src/other.js\n--- a/src/other.js\n+++ b/src/other.js\n`;
    expect(parseTouchedPaths(patch).sort()).toEqual(['src/greet.js', 'src/other.js']);
  });
});

describe('matchesAllowlist', () => {
  it('matches an exact path', () => {
    expect(matchesAllowlist('src/greet.js', ['src/greet.js'])).toBe(true);
  });

  it('matches a `dir/**` glob at any depth', () => {
    expect(matchesAllowlist('src/nested/greet.js', ['src/**'])).toBe(true);
    expect(matchesAllowlist('src/greet.js', ['src/**'])).toBe(true);
  });

  it('rejects a path outside every pattern', () => {
    expect(matchesAllowlist('lib/greet.js', ['src/**'])).toBe(false);
  });

  it('matches a single-segment `*.ext` glob', () => {
    expect(matchesAllowlist('README.md', ['*.md'])).toBe(true);
    expect(matchesAllowlist('docs/README.md', ['*.md'])).toBe(false);
  });
});

describe('enforceAllowlist', () => {
  it('passes a patch entirely within the allowlist', () => {
    expect(() => enforceAllowlist(VALID_PATCH, ['src/**'])).not.toThrow();
  });

  it('throws AllowlistViolationError for a patch escaping the workspace (../../etc/passwd)', () => {
    expect(() => enforceAllowlist(ESCAPING_PATCH, ['src/**'])).toThrow(AllowlistViolationError);
  });

  it('throws AllowlistViolationError for a path outside the allowlist but inside the workspace', () => {
    const patch = `diff --git a/config/secrets.yaml b/config/secrets.yaml
--- a/config/secrets.yaml
+++ b/config/secrets.yaml
@@ -1 +1 @@
-a
+b
`;
    expect(() => enforceAllowlist(patch, ['src/**'])).toThrow(AllowlistViolationError);
  });

  it('reports every violating path on the error', () => {
    try {
      enforceAllowlist(ESCAPING_PATCH, ['src/**']);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AllowlistViolationError);
      expect((error as AllowlistViolationError).paths).toContain('../../etc/passwd');
    }
  });
});
