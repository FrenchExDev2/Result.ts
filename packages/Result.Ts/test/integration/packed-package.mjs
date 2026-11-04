// Vérifie l’archive extraite sans dépendre des sources ou des liens du workspace.
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@frenchexdev2/result');
assert.equal(manifest.type, 'module');
assert.deepEqual(manifest.dependencies ?? {}, {});
await access(resolve(directory, manifest.exports['.'].types));
await access(resolve(directory, 'LICENSE'));
await access(resolve(directory, 'README.md'));
const files = await readdir(directory);
assert(!files.includes('src'));
assert(!files.includes('test'));
assert(!files.includes('node_modules'));

const { Result, validationError } = await import(pathToFileURL(resolve(directory, manifest.exports['.'].import)).href);
assert.deepEqual(Result.combine(Result.success(42), Result.success('Ada')).valueOrThrow(), [42, 'Ada']);
const validation = Result.validationFailure(validationError('Required', ['name']));
assert.equal(await validation.matchAsync(() => 'unexpected', async errors => errors[0].errorMessage), 'Required');
console.log(JSON.stringify({ package: manifest.name, version: manifest.version, isolatedEsmImport: true, declarations: true, runtimeDependencies: 0 }));
