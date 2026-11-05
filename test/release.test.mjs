import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkRelease, parseTag, prepareRelease, stageRelease } from '../scripts/release.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'npm-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'packages', 'kernel'), { recursive: true });
  await mkdir(join(root, 'packages', 'app'), { recursive: true });
  const json = async (path, value) => writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await json('package.json', { name: 'private-root', private: true, version: '0.0.0', packageManager: 'pnpm@11.20.0' });
  await json('packages/kernel/package.json', { name: '@example/kernel', version: '0.1.0' });
  await json('packages/app/package.json', {
    name: '@example/app', version: '0.2.0',
    dependencies: { '@example/kernel': 'workspace:*', '@external/tool': '2.0.0' },
    peerDependencies: { '@example/kernel': 'workspace:^' },
    builderCompatibility: { '@example/kernel': '^0.1.0' },
  });
  await json('release.config.json', { isolatedPackages: ['kernel'] });
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n', 'utf8');
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8');
  return { root, json, get: async path => JSON.parse(await readFile(join(root, path), 'utf8')) };
}

test('accepts stable and prerelease tags with separate npm channels', () => {
  assert.deepEqual(parseTag('v1.2.3'), { tag: 'v1.2.3', package: null, version: '1.2.3', distTag: 'latest' });
  assert.equal(parseTag('v2.0.0-rc.1').distTag, 'next');
  assert.equal(parseTag('kernel/v0.0.1').package, 'kernel');
});

test('rejects malformed tags, leading zeros, build metadata and command text', () => {
  for (const tag of ['1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-01', 'v1.2.3+build.1', 'v1.2.3\n', 'v1.2.3; echo secret', '../kernel/v1.2.3', 'v9007199254740992.0.0']) {
    assert.throws(() => parseTag(tag), /Expected/);
  }
});

test('prepares all package versions and compatibility without changing external dependencies', async t => {
  const { root, get } = await fixture(t);
  await prepareRelease(root, 'v1.4.0');
  assert.equal((await get('package.json')).version, '1.4.0');
  assert.equal((await get('packages/kernel/package.json')).version, '1.4.0');
  const app = await get('packages/app/package.json');
  assert.equal(app.version, '1.4.0');
  assert.equal(app.dependencies['@example/kernel'], 'workspace:*');
  assert.equal(app.peerDependencies['@example/kernel'], 'workspace:^');
  assert.equal(app.dependencies['@external/tool'], '2.0.0');
  assert.equal(app.builderCompatibility['@example/kernel'], '^1.4.0');
  assert.deepEqual((await checkRelease(root, 'v1.4.0')).packages, ['@example/app', '@example/kernel']);
});

test('rejects a mismatching tag and leaves source bytes unchanged', async t => {
  const { root } = await fixture(t);
  const before = await readFile(join(root, 'packages/app/package.json'), 'utf8');
  await assert.rejects(checkRelease(root, 'v9.0.0'), /does not match/);
  assert.equal(await readFile(join(root, 'packages/app/package.json'), 'utf8'), before);
});

test('checks every package even when the workspace root matches the tag', async t => {
  const { root, json } = await fixture(t);
  await prepareRelease(root, 'v1.0.0');
  await json('packages/kernel/package.json', { name: '@example/kernel', version: '0.1.0' });
  await assert.rejects(checkRelease(root, 'v1.0.0'), /@example\/kernel@0.1.0 does not match/);
});

test('rejects archives in both manifests and workspace/lock settings', async t => {
  const { root, json } = await fixture(t);
  await json('packages/kernel/package.json', { name: '@example/kernel', version: '0.1.0', dependencies: { bad: 'file:../bad.tgz' } });
  await assert.rejects(checkRelease(root), /Local dependency/);
  await json('packages/kernel/package.json', { name: '@example/kernel', version: '0.1.0' });
  for (const path of ['pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    const original = await readFile(join(root, path), 'utf8');
    await writeFile(join(root, path), "overrides:\n  bad: file:vendor/bad.tgz\n", 'utf8');
    await assert.rejects(checkRelease(root), /local dependency transports/);
    await writeFile(join(root, path), original, 'utf8');
  }
});

test('rejects missing workspace dependencies and public dependencies on private packages', async t => {
  const { root, json } = await fixture(t);
  await json('packages/app/package.json', { name: '@example/app', dependencies: { missing: 'workspace:*' } });
  await assert.rejects(checkRelease(root), /Missing workspace/);
  await json('packages/app/package.json', { name: '@example/app', dependencies: { '@example/kernel': 'workspace:*' } });
  await json('packages/kernel/package.json', { name: '@example/kernel', private: true });
  await assert.rejects(checkRelease(root), /depends on private/);
});

test('rejects publication settings that redirect the registry or version', async t => {
  const { root, json } = await fixture(t);
  for (const publishConfig of [{ registry: 'https://example.com/' }, { access: 'restricted' }, { version: '9.0.0' }]) {
    await json('packages/kernel/package.json', { name: '@example/kernel', version: '0.1.0', publishConfig });
    await assert.rejects(checkRelease(root), /registry|access|version/);
  }
});

test('isolated release preserves unrelated versions and copies only its own sources', async t => {
  const { root, get } = await fixture(t);
  await prepareRelease(root, 'kernel/v0.0.1');
  assert.equal((await get('package.json')).version, '0.0.0');
  assert.equal((await get('packages/app/package.json')).version, '0.2.0');
  await mkdir(join(root, 'packages/kernel/node_modules'), { recursive: true });
  await writeFile(join(root, 'packages/kernel/node_modules/forbidden.txt'), 'not copied', 'utf8');
  const stage = join(root, 'stage');
  await stageRelease(root, 'kernel/v0.0.1', stage);
  assert.equal(JSON.parse(await readFile(join(stage, 'packages/kernel/package.json'), 'utf8')).version, '0.0.1');
  await assert.rejects(readFile(join(stage, 'packages/app/package.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(stage, 'packages/kernel/node_modules/forbidden.txt')), { code: 'ENOENT' });
  await assert.rejects(stageRelease(root, 'kernel/v0.0.1', stage), { code: 'EEXIST' });
  await assert.rejects(stageRelease(root, 'kernel/v0.0.1', join(root, 'packages/kernel/stage')), /outside the selected package/);
});

test('isolated releases require an explicit selection and an independent package', async t => {
  const { root, json } = await fixture(t);
  await assert.rejects(checkRelease(root, 'app/v0.2.0'), /not configured/);
  await json('packages/kernel/package.json', { name: '@example/kernel', version: '0.1.0', devDependencies: { '@example/app': 'workspace:*' } });
  await assert.rejects(stageRelease(root, 'kernel/v0.1.0', join(root, 'stage')), /must not depend/);
});

test('isolated test support copies source fixtures without adding another installed workspace', async t => {
  const { root, json } = await fixture(t);
  await mkdir(join(root, 'test-support/contracts'), { recursive: true });
  await writeFile(join(root, 'test-support/contracts/source.ts'), 'export const contract = 42;\n', 'utf8');
  await writeFile(join(root, 'test-support/contracts/package.json'), '{"name":"must-not-be-installed"}', 'utf8');
  await json('release.config.json', { isolatedPackages: ['kernel'], isolatedTestSources: { kernel: ['test-support/contracts'] } });
  const stage = join(root, 'stage');
  await stageRelease(root, 'kernel/v0.1.0', stage);
  assert.equal(await readFile(join(stage, 'test-support/contracts/source.ts'), 'utf8'), 'export const contract = 42;\n');
  await assert.rejects(readFile(join(stage, 'test-support/contracts/package.json')), { code: 'ENOENT' });
  await json('release.config.json', { isolatedPackages: ['kernel'], isolatedTestSources: { kernel: ['../outside'] } });
  await assert.rejects(stageRelease(root, 'kernel/v0.1.0', join(root, 'bad-stage')), /within the workspace/);
});

test('workflow shell escapes literal braces for the runner format string', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const block = /    shell: >-\r?\n((?:      [^\r\n]+\r?\n)+)/.exec(workflow);
  assert.ok(block, 'Expected the custom folded shell template');
  const template = block[1].trim().split(/\r?\n/).map(line => line.trim()).join(' ');
  let placeholders = 0;
  const formatted = template.replace(/\{\{|\}\}|\{0\}|[{}]/g, token => {
    if (token === '{0}') {
      placeholders++;
      return 'runner-script.ps1';
    }
    assert.ok(token === '{{' || token === '}}', `Unescaped shell brace: ${token}`);
    return token[0];
  });
  assert.equal(placeholders, 1, 'The runner must substitute exactly one script path');
  assert.match(formatted, /if \(\$PSVersionTable\.PSVersion -lt \[version\]'7\.6'\) \{ throw 'PowerShell 7\.6\+ is required\.' \}/);
  assert.ok(formatted.endsWith(`. 'runner-script.ps1'"`));
});
