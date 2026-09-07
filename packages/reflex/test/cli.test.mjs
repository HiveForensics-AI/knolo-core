import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

test('package exposes the public Reflex CLI entrypoint', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, 'package.json'), 'utf8')
  );
  assert.equal(packageJson.name, '@knolo/reflex');
  assert.notEqual(packageJson.private, true);
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.license, 'Apache-2.0');
  assert.equal(packageJson.bin.reflex, 'bin/reflex.mjs');
});
