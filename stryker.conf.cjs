/**
 * Full mutation campaign for Result.Ts using the workspace's installed plugins.
 * Static mutants are included and every run starts from fresh results.
 */
const path = require('node:path');
const preset = require('../rac.ts/stryker.preset.cjs');

const workspace = path.resolve(__dirname, '../rac.ts');
const reportDir = (process.env.STRYKER_REPORT_DIR ?? 'reports/mutation').replace(/\\/g, '/');

module.exports = preset({
  plugins: [
    require.resolve('@stryker-mutator/vitest-runner', { paths: [workspace] }),
    require.resolve('@stryker-mutator/typescript-checker', { paths: [workspace] }),
  ],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: false },
  ignoreStatic: false,
  incremental: false,
  reporters: ['html', 'json', 'clear-text', 'progress-append-only', 'event-recorder'],
  eventReporter: { baseDir: `${reportDir}/events` },
});
