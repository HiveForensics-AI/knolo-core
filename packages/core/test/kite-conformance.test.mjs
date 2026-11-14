import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

test('kite conformance vectors match', () => {
  const result = spawnSync(process.execPath, ['conformance/kite/v1/run.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || 'kite conformance failed'
    );
  }
});
