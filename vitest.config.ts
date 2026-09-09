import { defineConfig } from 'vitest/config';

// Vitest 5 removed `test.workspace` / `vitest.workspace.ts` in favor of `test.projects`.
// Kept as the root config so `vitest` run from the repo root picks up every package.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
});
