import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

/** Mutation tests must import the instrumented sources, including self-imports. */
export default mergeConfig(base, defineConfig({
  resolve: {
    conditions: ['source', 'import', 'module', 'node', 'default'],
    alias: { '@frenchexdev2/result': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
  test: {
    coverage: { enabled: false },
    maxWorkers: 1,
    fileParallelism: false,
    reporters: ['default'],
  },
}));
