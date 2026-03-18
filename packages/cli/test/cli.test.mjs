import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');
const cliPackageJson = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
);

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
  assert.equal(
    packedPackageJson.dependencies['@knolo/core'],
    cliPackageJson.dependencies['@knolo/core']
  );
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

test('semantic:validate succeeds for matching pack/model and fails on mismatch', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-sem-validate-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);

  const coreModule = await import(pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href);
  const packPath = path.join(cwd, 'dist/knowledge.knolo');
  const packBytes = readFileSync(packPath);
  const pack = await coreModule.mountPack({ src: Uint8Array.from(packBytes) });
  const sidecarPath = path.join(cwd, 'dist/knowledge.knolo.semantic.json');
  const sidecar = {
    version: 1,
    packFingerprint: coreModule.createPackFingerprint(pack),
    modelId: 'qwen3-embedding:4b',
    dimension: 3,
    metric: 'cosine',
    createdAt: new Date().toISOString(),
    blocks: pack.blocks.map((_, blockId) => ({ blockId, vector: [1, 0, 0] })),
  };
  writeFileSync(sidecarPath, coreModule.serializeSidecar(sidecar), 'utf8');

  const output = runCli(['semantic:validate', '--pack', './dist/knowledge.knolo', '--sidecar', './dist/knowledge.knolo.semantic.json', '--model', 'qwen3-embedding:4b'], cwd);
  assert.match(output, /validation passed/);

  assert.throws(
    () => runCli(['semantic:validate', '--pack', './dist/knowledge.knolo', '--sidecar', './dist/knowledge.knolo.semantic.json', '--model', 'other-model'], cwd),
    /Semantic model mismatch/
  );
});
