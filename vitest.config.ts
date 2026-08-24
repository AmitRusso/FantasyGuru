import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // PGlite spins up a real Postgres per suite; the default 5s is not enough on
    // a cold run.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
