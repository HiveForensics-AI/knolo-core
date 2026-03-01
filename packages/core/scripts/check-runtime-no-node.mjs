import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distIndexPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const runtimeBundle = await readFile(distIndexPath, 'utf8');

const forbidden = ['node:fs', 'fs/promises', 'node:path'];
for (const token of forbidden) {
  assert.equal(
    runtimeBundle.includes(token),
    false,
    `Runtime entry must not include Node stdlib reference: ${token}`
  );
}

console.log('Runtime bundle contains no Node stdlib specifiers.');
