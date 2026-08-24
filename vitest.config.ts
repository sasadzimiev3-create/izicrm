import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['tests/unit/**/*.test.ts', 'tests/property/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/finance/**/*.ts'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
