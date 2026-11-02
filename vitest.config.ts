import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './test-results/coverage',
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 }
    }
  }
});
