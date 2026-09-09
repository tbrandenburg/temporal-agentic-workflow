/**
 * File-path allowlist enforcement — PLAN §7 step 3. Runs *before* `git
 * apply` so a hostile patch never lands even in the ephemeral sandbox.
 */
export class AllowlistViolationError extends Error {
  constructor(public readonly paths: readonly string[]) {
    super(`patch touches path(s) outside the allowlist: ${paths.join(', ')}`);
    this.name = 'AllowlistViolationError';
  }
}

/** Conservative default per PLAN §3.1 ("defaults to a conservative set"). */
export const DEFAULT_ALLOWED_PATHS: readonly string[] = ['src/**'];

/**
 * Extracts the set of paths a unified diff touches, from its
 * `diff --git a/<path> b/<path>` headers. Deliberately does not rely on
 * `+++`/`---` lines alone, since `/dev/null` appears there for
 * added/deleted files.
 */
export function parseTouchedPaths(patchText: string): string[] {
  const paths = new Set<string>();
  const headerPattern = /^diff --git a\/(.+?) b\/(.+)$/gm;
  for (const match of patchText.matchAll(headerPattern)) {
    const [, a, b] = match;
    if (a) paths.add(a);
    if (b) paths.add(b);
  }
  return [...paths];
}

/**
 * Minimal glob matcher covering the two shapes this PoC needs:
 * `dir/**` (any depth under `dir/`) and `*.ext` (single path segment).
 * Exact paths match literally. No third-party glob dependency — this is
 * intentionally the smallest matcher that satisfies PLAN §3.1's
 * "glob allowlist", not a general-purpose implementation.
 */
export function matchesAllowlist(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === path) return true;
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -'**'.length);
      return path.startsWith(prefix);
    }
    if (pattern.includes('*')) {
      const regex = new RegExp(
        `^${pattern
          .split('*')
          .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*')}$`,
      );
      return regex.test(path);
    }
    return false;
  });
}

/** A path escapes the workspace root (e.g. `../../etc/passwd`) regardless of allowlist content. */
function escapesWorkspace(path: string): boolean {
  return path.startsWith('/') || path.split('/').includes('..');
}

/**
 * Throws `AllowlistViolationError` if any path the patch touches is
 * outside `allowedPaths` (or escapes the workspace root entirely).
 */
export function enforceAllowlist(
  patchText: string,
  allowedPaths: readonly string[] = DEFAULT_ALLOWED_PATHS,
): void {
  const touched = parseTouchedPaths(patchText);
  const violations = touched.filter(
    (path) => escapesWorkspace(path) || !matchesAllowlist(path, allowedPaths),
  );
  if (violations.length > 0) {
    throw new AllowlistViolationError(violations);
  }
}
