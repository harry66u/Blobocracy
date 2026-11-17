import { defineConfig } from 'vitest/config';

// The full-level solver proof takes ~10 minutes, so it only runs with `npm run test:level` (--mode slow).
export default defineConfig(({ mode }) => {
  const slow = mode === 'slow';
  return {
    test: {
      include: slow ? ['packages/*/test/slow/**/*.test.ts'] : ['packages/*/test/**/*.test.ts'],
      exclude: slow ? ['**/node_modules/**'] : ['**/node_modules/**', 'packages/*/test/slow/**'],
      testTimeout: 15000,
    },
  };
});
