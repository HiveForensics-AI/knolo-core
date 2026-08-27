import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('V5 release preflight validates the built package', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const result = await import(`${pathToFileURL(path.join(root, 'scripts/check-v5-release.mjs')).href}?test=${Date.now()}`);

  assert.equal(result.releasePreflightPassed, true);
});
