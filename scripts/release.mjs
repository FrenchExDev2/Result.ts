/** Prepare committed versions and verify tag releases without publishing or invoking a shell. */
import { appendFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;
const registry = 'https://registry.npmjs.org/';

/** Parse an npm-compatible release tag; build metadata is intentionally unsupported. */
export function parseTag(tag) {
  if (typeof tag !== 'string' || /[\r\n\s]/.test(tag)) throw new Error('Expected a release tag without whitespace.');
  const match = /^(?:([a-z0-9][a-z0-9-]*)\/)?v(.+)$/.exec(tag ?? '');
  if (!match || !versionPattern.test(match[2]) || !match[2].split('-')[0].split('.').every(value => Number.isSafeInteger(Number(value)))) {
    throw new Error('Expected vMAJOR.MINOR.PATCH[-prerelease] or package-name/vMAJOR.MINOR.PATCH[-prerelease].');
  }
  return { tag, package: match[1] ?? null, version: match[2], distTag: match[2].includes('-') ? 'next' : 'latest' };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Read the packages/* workspace explicitly, excluding generated directories. */
export async function loadWorkspace(root) {
  root = resolve(root);
  const manifest = await readJson(join(root, 'package.json'));
  if (manifest.private !== true) throw new Error('The workspace root must remain private.');
  const packages = [];
  for (const directory of (await readdir(join(root, 'packages'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!directory.isDirectory()) continue;
    const path = join(root, 'packages', directory.name, 'package.json');
    try {
      packages.push({ directory: directory.name, path, manifest: await readJson(path) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const names = packages.map(item => item.manifest.name);
  if (!packages.length || names.some(name => !name) || new Set(names).size !== names.length) {
    throw new Error('Expected uniquely named packages in packages/*.');
  }
  let config = { isolatedPackages: [] };
  try { config = await readJson(join(root, 'release.config.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { root, manifest, packages, config };
}

function selectedPackages(workspace, release) {
  if (!release.package) return workspace.packages;
  if (!workspace.config.isolatedPackages?.includes(release.package)) {
    throw new Error(`Isolated release is not configured for ${release.package}.`);
  }
  const selected = workspace.packages.filter(item => item.manifest.name.split('/').at(-1) === release.package);
  if (selected.length !== 1 || selected[0].manifest.private) throw new Error(`No public package named ${release.package}.`);
  return selected;
}

/** Reject local dependency transports and workspace references to missing/private packages. */
export async function checkSources(workspace) {
  const known = new Map(workspace.packages.map(item => [item.manifest.name, item.manifest]));
  for (const item of [{ path: join(workspace.root, 'package.json'), manifest: workspace.manifest }, ...workspace.packages]) {
    for (const section of sections) {
      for (const [name, specifier] of Object.entries(item.manifest[section] ?? {})) {
        if (/^(?:file|link|portal):/i.test(specifier)) throw new Error(`Local dependency in ${item.path}: ${name}=${specifier}`);
        if (specifier.startsWith('workspace:') && !known.has(name)) throw new Error(`Missing workspace package: ${name}`);
        if (known.has(name) && !['workspace:*', 'workspace:^', 'workspace:~'].includes(specifier)) {
          throw new Error(`Use a rolling workspace protocol for ${name} in ${item.path}.`);
        }
        if (section !== 'devDependencies' && item.manifest.private !== true && known.get(name)?.private) {
          throw new Error(`Public package ${item.manifest.name} depends on private package ${name}.`);
        }
      }
    }
    const publish = item.manifest.publishConfig;
    if (publish?.registry && publish.registry.replace(/\/$/, '') !== registry.replace(/\/$/, '')) {
      throw new Error(`Unexpected publish registry in ${item.path}.`);
    }
    if (publish?.access && publish.access !== 'public') throw new Error(`Expected public npm access in ${item.path}.`);
    if (publish?.version) throw new Error(`publishConfig.version would override the release version in ${item.path}.`);
  }
  for (const filename of ['pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    try {
      const text = await readFile(join(workspace.root, filename), 'utf8');
      if (/\bfile:/i.test(text) || (filename === 'pnpm-workspace.yaml' && /\blink:/i.test(text))) {
        throw new Error(`${filename} still contains local dependency transports; resolve published npm versions first.`);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

/** Prepare manifest changes for review; the caller must regenerate and commit the lockfile before tagging. */
export async function prepareRelease(root, tag) {
  const release = parseTag(tag);
  const workspace = await loadWorkspace(root);
  await checkSources(workspace);
  const selected = selectedPackages(workspace, release);
  const selectedNames = new Set(selected.map(item => item.manifest.name));
  if (!release.package) {
    workspace.manifest.version = release.version;
    await writeJson(join(workspace.root, 'package.json'), workspace.manifest);
  }
  for (const item of workspace.packages) {
    if (selectedNames.has(item.manifest.name)) item.manifest.version = release.version;
    for (const name of Object.keys(item.manifest.builderCompatibility ?? {})) {
      if (selectedNames.has(name)) item.manifest.builderCompatibility[name] = `^${release.version}`;
    }
    await writeJson(item.path, item.manifest);
  }
  return { ...release, packages: selected.map(item => item.manifest.name), next: 'Regenerate pnpm-lock.yaml, review and commit all changes, then tag that commit.' };
}

/** Verify committed versions against the tag; never bump versions in CI. */
export async function checkRelease(root, tag) {
  const workspace = await loadWorkspace(root);
  await checkSources(workspace);
  if (!tag) return { packages: workspace.packages.length, source: 'registry dependencies and workspace protocols' };
  const release = parseTag(tag);
  const selected = selectedPackages(workspace, release);
  const checked = release.package ? selected : [{ manifest: workspace.manifest }, ...selected];
  for (const item of checked) {
    if (item.manifest.version !== release.version) {
      throw new Error(`${item.manifest.name}@${item.manifest.version} does not match ${tag}; prepare and commit the release before tagging.`);
    }
    for (const [name, value] of Object.entries(item.manifest.builderCompatibility ?? {})) {
      if (selected.some(candidate => candidate.manifest.name === name) && value !== `^${release.version}`) {
        throw new Error(`Stale builderCompatibility entry for ${name}.`);
      }
    }
  }
  const publicPackages = selected.filter(item => item.manifest.private !== true);
  if (!publicPackages.length) throw new Error('No public packages to release.');
  return { ...release, packages: publicPackages.map(item => item.manifest.name) };
}

/** Stage an explicitly configured independent package, using its own committed registry lockfile. */
export async function stageRelease(root, tag, destination) {
  const release = parseTag(tag);
  if (!release.package) throw new Error('Staging requires a package-name/vVERSION tag.');
  await checkRelease(root, tag);
  const workspace = await loadWorkspace(root);
  const [selected] = selectedPackages(workspace, release);
  for (const section of sections) {
    if (Object.values(selected.manifest[section] ?? {}).some(value => value.startsWith('workspace:'))) {
      throw new Error('An isolated package must not depend on another workspace package.');
    }
  }
  destination = resolve(destination);
  const fromSource = relative(dirname(selected.path), destination);
  if (!fromSource || (!isAbsolute(fromSource) && fromSource !== '..' && !fromSource.startsWith(`..${sep}`))) {
    throw new Error('The staging directory must be outside the selected package sources.');
  }
  const testSources = (workspace.config.isolatedTestSources?.[release.package] ?? []).map(source => {
    const fullPath = resolve(workspace.root, source);
    const within = relative(workspace.root, fullPath);
    if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`) || basename(fullPath) === 'package.json') {
      throw new Error('Isolated test support must reference source files within the workspace.');
    }
    return { fullPath, within };
  });
  // mkdir without recursive refuses to overwrite any existing staging directory.
  await mkdir(destination);
  const excluded = new Set(['node_modules', '.git', 'dist', 'coverage', 'test-results', 'reports']);
  await cp(dirname(selected.path), join(destination, 'packages', selected.directory), {
    recursive: true,
    filter: source => !excluded.has(basename(source)) && !basename(source).endsWith('.tsbuildinfo') && !basename(source).startsWith('.stryker'),
  });
  for (const source of testSources) {
    await mkdir(dirname(join(destination, source.within)), { recursive: true });
    await cp(source.fullPath, join(destination, source.within), {
      recursive: true,
      filter: path => !excluded.has(basename(path)) && basename(path) !== 'package.json',
    });
  }
  await writeJson(join(destination, 'package.json'), {
    name: '@frenchexdev2/isolated-release', version: '0.0.0', private: true, type: 'module',
    packageManager: workspace.manifest.packageManager,
    scripts: { build: 'pnpm -r run build', 'test:ci': selected.manifest.scripts?.['test:isolated'] ? 'pnpm -r run test:isolated' : 'pnpm -r run test' },
  });
  await cp(join(workspace.root, 'pnpm-workspace.yaml'), join(destination, 'pnpm-workspace.yaml'));
  for (const filename of ['LICENSE', 'README.md']) {
    try { await cp(join(workspace.root, filename), join(destination, filename)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const lockfile = join(workspace.root, 'release', release.package, 'pnpm-lock.yaml');
  try { await cp(lockfile, join(destination, 'pnpm-lock.yaml')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...release, destination, lockfile };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const [command, tag, destination] = process.argv.slice(2);
  let result;
  if (command === 'prepare' && tag && !destination) result = await prepareRelease(root, tag);
  else if (command === 'check' && !destination) result = await checkRelease(root, tag);
  else if (command === 'stage' && tag && destination) result = await stageRelease(root, tag, destination);
  else throw new Error('Usage: node scripts/release.mjs prepare <tag> | check [tag] | stage <package-tag> <new-directory>');
  if (process.env.GITHUB_OUTPUT && result.distTag) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\ndist-tag=${result.distTag}\n`, 'utf8');
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
