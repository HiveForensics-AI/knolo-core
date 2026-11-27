import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const npmCache = mkdtempSync(path.join(tmpdir(), 'knolo-npm-cache-'));

function npmOptions(options = {}) {
  return {
    ...options,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
  };
}

const canSpawnNpm = process.env.CODEX_SANDBOX_NETWORK_DISABLED
  ? false
  : (() => {
      try {
        execFileSync('npm', ['--version'], npmOptions({ stdio: 'ignore' }));
        return true;
      } catch {
        return false;
      }
    })();

function npmPack(workdir, destination) {
  let out;
  try {
    out = execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', destination],
      npmOptions({
        cwd: workdir,
        encoding: 'utf8',
      })
    );
  } catch (error) {
    process.stderr.write(
      error.stderr?.toString() || `${error.stack || error}\n`
    );
    throw error;
  }
  const [result] = JSON.parse(out);
  return path.join(destination, result.filename);
}

test(
  'scaffolded app installs and builds with publish-style tarball dependencies',
  { skip: !canSpawnNpm && 'npm subprocesses are unavailable in this sandbox' },
  () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'create-knolo-app-'));
    const packDir = mkdtempSync(path.join(tmpdir(), 'knolo-pack-'));

    const coreDir = path.resolve(process.cwd(), '../core');
    const exchangeDir = path.resolve(process.cwd(), '../exchange');
    execFileSync(
      'npm',
      ['run', 'build', '--prefix', coreDir],
      npmOptions({ stdio: 'inherit' })
    );
    execFileSync(
      'npm',
      ['run', 'build', '--prefix', exchangeDir],
      npmOptions({ stdio: 'inherit' })
    );
    const coreTarball = npmPack(coreDir, packDir);
    const exchangeTarball = npmPack(exchangeDir, packDir);
    const cliTarball = npmPack(path.resolve(process.cwd(), '../cli'), packDir);
    const createAppTarball = npmPack(process.cwd(), packDir);

    const launcherDir = mkdtempSync(
      path.join(tmpdir(), 'create-knolo-launcher-')
    );
    writeFileSync(
      path.join(launcherDir, 'package.json'),
      `${JSON.stringify({ name: 'launcher', private: true, type: 'module' }, null, 2)}\n`,
      'utf8'
    );
    execFileSync(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        createAppTarball,
      ],
      npmOptions({
        cwd: launcherDir,
        stdio: 'inherit',
      })
    );

    execFileSync(
      process.execPath,
      [
        path.join(launcherDir, 'node_modules/create-knolo-app/bin/index.mjs'),
        'my-kb-chat',
      ],
      {
        cwd,
        stdio: 'inherit',
      }
    );

    const target = path.join(cwd, 'my-kb-chat');
    assert.ok(existsSync(path.join(target, 'knolo.config.json')));
    assert.ok(existsSync(path.join(target, 'docs', 'getting-started.md')));
    assert.ok(existsSync(path.join(target, 'docs', 'citations.md')));

    const packageJsonPath = path.join(target, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    assert.equal(packageJson.name, 'my-kb-chat');
    assert.equal(packageJson.scripts['knolo:build'], 'knolo build');
    const v6Range = '^6.0.0';
    assert.equal(packageJson.dependencies['@knolo/core'], v6Range);
    assert.equal(packageJson.devDependencies['@knolo/cli'], v6Range);
    assert.doesNotMatch(
      packageJson.dependencies['@knolo/core'],
      /^(file:|workspace:|link:)/
    );
    assert.doesNotMatch(
      packageJson.devDependencies['@knolo/cli'],
      /^(file:|workspace:|link:)/
    );

    const installPackageJson = {
      name: packageJson.name,
      private: true,
      type: 'module',
      scripts: packageJson.scripts,
      dependencies: {
        '@knolo/core': coreTarball,
      },
      devDependencies: {
        '@knolo/cli': cliTarball,
      },
      overrides: {
        '@knolo/exchange': `file:${exchangeTarball}`,
      },
    };
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(installPackageJson, null, 2)}\n`,
      'utf8'
    );

    execFileSync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      npmOptions({
        cwd: target,
        stdio: 'inherit',
      })
    );

    execFileSync(
      'npm',
      ['run', 'knolo:build'],
      npmOptions({
        cwd: target,
        stdio: 'inherit',
      })
    );

    assert.ok(existsSync(path.join(target, 'dist', 'knowledge.knolo')));
  }
);

test('scaffolded chat route answers from a pack on disk', async () => {
  const { buildPack } = await import('@knolo/core');
  const cwd = mkdtempSync(path.join(tmpdir(), 'create-knolo-route-'));
  mkdirSync(path.join(cwd, 'dist'));
  const bytes = await buildPack([
    { id: 'citations.md', text: 'Citations show where an answer came from.' },
  ]);
  writeFileSync(path.join(cwd, 'dist', 'knowledge.knolo'), bytes);

  const routeUrl = pathToFileURL(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../template/app/api/chat/route.js'
    )
  ).href;
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    const { POST } = await import(routeUrl);
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'citations' }),
      })
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.hits.length > 0);
    assert.match(payload.hits[0].snippet, /Citations/);
  } finally {
    process.chdir(previousCwd);
  }
});
