/**
 * Full mutation campaign using this package's declared workspace tools.
 * Static mutants are included and every run starts from fresh results.
 */
const reportDir = (process.env.STRYKER_REPORT_DIR ?? 'reports/mutation').replace(/\\/g, '/');

module.exports = {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: [
    require.resolve('@stryker-mutator/vitest-runner'),
    require.resolve('@stryker-mutator/typescript-checker'),
  ],
  mutate: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  vitest: { configFile: 'vitest.config.stryker.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: false },
  disableTypeChecks: 'src/**/*.ts',
  coverageAnalysis: 'perTest',
  ignoreStatic: false,
  incremental: false,
  thresholds: { high: 100, low: 100, break: 100 },
  timeoutMS: 30000,
  concurrency: Number(process.env.STRYKER_CONCURRENCY) || 2,
  ignorePatterns: ['dist', 'coverage', 'test-results', 'reports', '.stryker-tmp*', '*.tsbuildinfo'],
  reporters: ['html', 'json', 'clear-text', 'progress-append-only', 'event-recorder'],
  htmlReporter: { fileName: `${reportDir}/index.html` },
  jsonReporter: { fileName: `${reportDir}/mutation-report.json` },
  eventReporter: { baseDir: `${reportDir}/events` },
};
