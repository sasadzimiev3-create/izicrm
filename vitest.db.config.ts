import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts', 'tests/security/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    passWithNoTests: false,
  },
});
