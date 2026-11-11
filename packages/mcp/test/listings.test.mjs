import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const published = '@knolo/mcp@0.2.2';

test('goose extension is a stdio npx draft', () => {
  const text = readFileSync(
    path.join(packageRoot, 'listings/goose/extension.yaml'),
    'utf8'
  );
  assert.match(text, /^ {4}type: stdio$/m);
  assert.match(text, /^ {4}cmd: npx$/m);
  assert.match(
    text,
    new RegExp(published.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  assert.match(text, /--config/);
  assert.doesNotMatch(text, /\bsse\b/i);
  assert.doesNotMatch(text, /:\/\//);
});

test('awesome-mcp-servers entry matches the directory line', () => {
  const text = readFileSync(
    path.join(packageRoot, 'listings/awesome-mcp-servers.md'),
    'utf8'
  );
  const line =
    '- [HiveForensics-AI/knolo-core](https://github.com/HiveForensics-AI/knolo-core/tree/main/packages/mcp) 📇 🏠 🍎 🪟 🐧 - Read-only stdio search over a pinned local Knolo Knowledge Image (@knolo/mcp@0.2.2), with receipt ids from an integrity check.';
  assert.ok(text.includes(line));
  assert.equal(text.includes('glama.ai'), false);
  assert.match(text, /Knowledge & Memory/);
  assert.match(text, /separate pull request/);
});
