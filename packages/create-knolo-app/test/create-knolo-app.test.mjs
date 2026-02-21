import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const cliPath = path.resolve(process.cwd(), 'bin/index.mjs');

test('scaffolder creates next starter files', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'create-knolo-app-'));
  execFileSync(process.execPath, [cliPath, 'my-kb-chat'], { cwd, encoding: 'utf8' });

  const target = path.join(cwd, 'my-kb-chat');
  assert.ok(existsSync(path.join(target, 'knolo.config.json')));
  assert.ok(existsSync(path.join(target, 'docs', 'getting-started.md')));
  assert.ok(existsSync(path.join(target, 'docs', 'citations.md')));
  assert.ok(existsSync(path.join(target, 'app', 'api', 'chat', 'route.js')));

  const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'my-kb-chat');
  assert.equal(packageJson.scripts['knolo:build'], 'knolo build');
});
