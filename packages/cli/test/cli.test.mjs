import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');
const cliPackageJson = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runShellCommand(command, { cwd, env = {} } = {}) {
  const captureDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-shell-'));
  const stdoutFile = path.join(captureDir, 'stdout.txt');
  const stderrFile = path.join(captureDir, 'stderr.txt');

  try {
    try {
      execSync(`${command} > ${shellQuote(stdoutFile)} 2> ${shellQuote(stderrFile)}`, {
        cwd,
        env: { ...process.env, ...env },
        shell: '/bin/bash',
        encoding: 'utf8',
      });
    } catch (error) {
      if (error?.status !== 0) {
        const stdout = existsSync(stdoutFile) ? readFileSync(stdoutFile, 'utf8') : '';
        const stderr = existsSync(stderrFile) ? readFileSync(stderrFile, 'utf8') : '';
        const wrapped = new Error((stderr || stdout || error.message).trim());
        wrapped.cause = error;
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        throw wrapped;
      }
    }

    return {
      stdout: existsSync(stdoutFile) ? readFileSync(stdoutFile, 'utf8') : '',
      stderr: existsSync(stderrFile) ? readFileSync(stderrFile, 'utf8') : '',
    };
  } catch (error) {
    throw error;
  } finally {
    rmSync(captureDir, { recursive: true, force: true });
  }
}

function runCli(args, cwd, env = {}) {
  const command = ['node', cliPath, ...args].map(shellQuote).join(' ');
  return runShellCommand(command, { cwd, env }).stdout;
}

function npmPack(workdir, destination) {
  const out = runShellCommand(
    `npm pack --json --pack-destination ${shellQuote(destination)}`,
    {
      cwd: workdir,
      env: {
        ...process.env,
        npm_config_cache: path.join(destination, '.npm-cache'),
      },
    }
  ).stdout;
  const [result] = JSON.parse(out);
  return path.join(destination, result.filename);
}

function createFakeDfxHarness(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  const scriptPath = path.join(cwd, 'fake-dfx.sh');
  const argsFile = path.join(cwd, 'args.txt');
  const didFile = path.join(cwd, 'args.did');

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$FAKE_DFX_ARGS_FILE"
prev=""
for arg in "$@"; do
  if [ "$prev" = "--argument-file" ]; then
    cp "$arg" "$FAKE_DFX_DID_FILE"
  fi
  prev="$arg"
done
printf '{"ok":true}\n'
`,
    'utf8'
  );
  chmodSync(scriptPath, 0o755);

  return {
    env: {
      DFX_BIN: scriptPath,
      FAKE_DFX_ARGS_FILE: argsFile,
      FAKE_DFX_DID_FILE: didFile,
    },
    argsFile,
    didFile,
  };
}

test('packed @knolo/cli tarball includes expected runtime files only', () => {
  const packDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-pack-'));
  const cliDir = process.cwd();
  const tarballPath = npmPack(cliDir, packDir);

  const entries = runShellCommand(`tar -tzf ${shellQuote(tarballPath)}`, { cwd: cliDir }).stdout
    .trim()
    .split('\n')
    .filter(Boolean);

  assert.ok(entries.includes('package/bin/knolo.mjs'));
  assert.ok(entries.includes('package/package.json'));
  assert.ok(entries.includes('package/templates/icp-knowledge-canister/dfx.json'));
  assert.equal(entries.some((entry) => entry.startsWith('package/test/')), false);
  assert.equal(entries.some((entry) => entry.startsWith('package/src/')), false);

  const packedPackageJson = JSON.parse(
    runShellCommand(
      `tar -xOf ${shellQuote(tarballPath)} ${shellQuote('package/package.json')}`,
      { cwd: cliDir }
    ).stdout
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

test('inspect and verify expose the v4 container', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-v4-inspect-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);

  const inspected = JSON.parse(runCli(['inspect', './dist/knowledge.knolo'], cwd));
  assert.equal(inspected.format, 'v4');
  assert.ok(inspected.container.sections.some((section) => section.name === 'manifest'));

  const verified = JSON.parse(runCli(['verify', './dist/knowledge.knolo'], cwd));
  assert.equal(verified.verified, true);
});

test('v5 info and health expose verified runtime diagnostics', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-v5-diagnostics-'));
  const core = await import(pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href);
  const image = core.createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('cli v5'), meta: {} }] });
  const imagePath = path.join(cwd, 'knowledge.v5');
  writeFileSync(imagePath, image.bytes);

  const info = JSON.parse(runCli(['v5', 'info', './knowledge.v5'], cwd));
  assert.equal(info.valid, true);
  assert.equal(info.image.stateRoot, image.stateRoot);
  assert.equal(info.image.objectCount, 1);

  const health = JSON.parse(runCli(['v5', 'health', '--image', './knowledge.v5'], cwd));
  assert.equal(health.healthy, true);
  assert.equal(health.diagnosticsRoot, info.diagnosticsRoot);

  const studio = JSON.parse(runCli(['v5', 'studio', './knowledge.v5'], cwd));
  assert.equal(studio.valid, true);
  assert.equal(studio.surface, 'studio-management');
  assert.equal(studio.readOnly, true);
  assert.equal(studio.diagnostics.diagnosticsRoot, info.diagnosticsRoot);
  assert.equal(studio.capabilities.mutateImage, false);
});

test('migrate converts an ICP-compatible legacy pack to v4', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-v4-migrate-'));
  const docsDir = path.join(cwd, 'docs');
  mkdirSync(docsDir);
  writeFileSync(path.join(docsDir, 'alpha.txt'), 'alpha legacy text', 'utf8');
  runCli(['icp', 'build-pack', './docs', '--out', './legacy.knolo'], cwd);
  runCli(['migrate', './legacy.knolo', '--out', './migrated.knolo', '--to', '4'], cwd);
  const verified = JSON.parse(runCli(['verify', './migrated.knolo'], cwd));
  assert.equal(verified.format, 'v4');
});

test('query returns hit from sample doc', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-query-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);

  const output = runCli(['query', 'hello'], cwd);
  assert.match(output, /Top 1 hit\(s\)/);
  assert.match(output, /docs\/hello\.md/);
});

test('query receipts can be explained and verified', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-receipt-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);
  runCli(['query', 'hello', '--receipt', './receipt.json', '--json'], cwd);
  assert.ok(existsSync(path.join(cwd, 'receipt.json')));
  const explained = runCli(['explain', './receipt.json', '--pack', './dist/knowledge.knolo'], cwd);
  assert.match(explained, /"verified": true/);
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

test('icp init copies the bundled scaffold', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-init-'));
  const target = path.join(cwd, 'demo');

  const output = runCli(['icp', 'init', target], cwd);

  assert.match(output, /created .*demo/);
  assert.ok(existsSync(path.join(target, 'dfx.json')));
  assert.ok(existsSync(path.join(target, 'knowledge/alpha.md')));
  assert.ok(existsSync(path.join(target, 'canisters/knolo-icp-canister/Cargo.toml')));
});

test('icp build-pack produces a pack from a docs directory', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-build-pack-'));
  const docsDir = path.join(cwd, 'knowledge');
  mkdirSync(path.join(docsDir, 'guides'), { recursive: true });
  writeFileSync(path.join(docsDir, 'alpha.md'), '# Alpha\n\nOne two three.\n', 'utf8');
  writeFileSync(path.join(docsDir, 'guides', 'beta.txt'), 'Beta guide text.\n', 'utf8');

  const output = runCli(['icp', 'build-pack', './knowledge', '--out', './dist/knowledge.knolo'], cwd);

  assert.match(output, /indexed 2 files/);
  assert.ok(existsSync(path.join(cwd, 'dist/knowledge.knolo')));
});

test('icp upload shells out through dfx with an argument file', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-upload-'));
  const packPath = path.join(cwd, 'knowledge.knolo');
  writeFileSync(packPath, Buffer.from([1, 2, 3, 255]));
  const harness = createFakeDfxHarness('knolo-cli-fake-dfx-upload-');

  const output = runCli(
    ['icp', 'upload', './knowledge.knolo', '--canister', 'knolo_knowledge', '--label', 'sample-pack'],
    cwd,
    harness.env
  );

  const args = readFileSync(harness.argsFile, 'utf8');
  const didArgs = readFileSync(harness.didFile, 'utf8');
  assert.match(output, /\{"ok":true\}/);
  assert.match(args, /canister\ncall\nknolo_knowledge\nset_pack/);
  assert.match(didArgs, /\(vec \{ 1; 2; 3; 255 \}, "sample-pack"\)/);
});

test('icp query shells out through dfx query with top-k', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-query-'));
  const harness = createFakeDfxHarness('knolo-cli-fake-dfx-query-');

  const output = runCli(
    ['icp', 'query', 'alpha beta', '--canister', 'knolo_knowledge', '--k', '7'],
    cwd,
    harness.env
  );

  const args = readFileSync(harness.argsFile, 'utf8');
  const didArgs = readFileSync(harness.didFile, 'utf8');
  assert.match(output, /\{"ok":true\}/);
  assert.match(args, /canister\ncall\nknolo_knowledge\nsearch\n--query/);
  assert.match(didArgs, /\("alpha beta", 7 : nat32\)/);
});

test('icp health and info call query methods', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-health-'));
  const healthHarness = createFakeDfxHarness('knolo-cli-fake-dfx-health-');
  const healthOut = runCli(['icp', 'health', '--canister', 'knolo_knowledge'], cwd, healthHarness.env);
  assert.match(healthOut, /\{"ok":true\}/);
  assert.match(readFileSync(healthHarness.argsFile, 'utf8'), /canister\ncall\nknolo_knowledge\nhealth\n--query/);

  const infoHarness = createFakeDfxHarness('knolo-cli-fake-dfx-info-');
  const infoOut = runCli(['icp', 'info', '--canister', 'knolo_knowledge'], cwd, infoHarness.env);
  assert.match(infoOut, /\{"ok":true\}/);
  assert.match(readFileSync(infoHarness.argsFile, 'utf8'), /canister\ncall\nknolo_knowledge\npack_info\n--query/);
});

test('icp clear shells out to clear_pack', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-clear-'));
  const harness = createFakeDfxHarness('knolo-cli-fake-dfx-clear-');
  const output = runCli(['icp', 'clear', '--canister', 'knolo_knowledge'], cwd, harness.env);
  assert.match(output, /\{"ok":true\}/);
  assert.match(readFileSync(harness.argsFile, 'utf8'), /canister\ncall\nknolo_knowledge\nclear_pack/);
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
