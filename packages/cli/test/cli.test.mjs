import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');

function runCli(args, cwd) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function npmPack(workdir, destination) {
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', destination], {
    cwd: workdir,
    encoding: 'utf8',
  });
  const [result] = JSON.parse(out);
  return path.join(destination, result.filename);
}

test('packed @knolo/cli tarball includes expected runtime files only', () => {
  const packDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-pack-'));
  const cliDir = process.cwd();
  const tarballPath = npmPack(cliDir, packDir);

  const entries = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  assert.ok(entries.includes('package/bin/knolo.mjs'));
  assert.ok(entries.includes('package/package.json'));
  assert.equal(entries.some((entry) => entry.startsWith('package/test/')), false);
  assert.equal(entries.some((entry) => entry.startsWith('package/src/')), false);

  const packedPackageJson = JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], { encoding: 'utf8' })
  );
  assert.equal(packedPackageJson.private, false);
  assert.equal(packedPackageJson.bin.knolo, 'bin/knolo.mjs');
  assert.equal(packedPackageJson.dependencies['@knolo/core'], '^0.3.1');
});

test('init creates config and sample docs', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-init-'));
  const output = runCli(['init'], cwd);

  assert.match(output, /created knolo\.config\.json/);
  assert.ok(existsSync(path.join(cwd, 'knolo.config.json')));
  assert.ok(existsSync(path.join(cwd, 'docs/hello.md')));
});

test('build produces default pack', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-build-'));
  runCli(['init'], cwd);

  const output = runCli(['build'], cwd);
  assert.match(output, /indexed 1 files/);
  assert.ok(existsSync(path.join(cwd, 'dist/knowledge.knolo')));
});

test('query returns hit from sample doc', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-query-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);

  const output = runCli(['query', 'hello'], cwd);
  assert.match(output, /Top 1 hit\(s\)/);
  assert.match(output, /docs\/hello\.md/);
});

test('add updates existing source path', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-add-'));
  runCli(['init'], cwd);
  mkdirSync(path.join(cwd, 'knowledge-base'));
  writeFileSync(path.join(cwd, 'knowledge-base', 'a.txt'), 'alpha', 'utf8');

  runCli(['add', 'docs', './knowledge-base'], cwd);

  const config = JSON.parse(readFileSync(path.join(cwd, 'knolo.config.json'), 'utf8'));
  assert.equal(config.sources[0].path, './knowledge-base');
});
