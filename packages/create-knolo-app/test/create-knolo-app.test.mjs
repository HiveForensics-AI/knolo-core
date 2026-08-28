import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

const canSpawnNpm = process.env.CODEX_SANDBOX_NETWORK_DISABLED ? false : (() => {
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
    out = execFileSync('npm', ['pack', '--json', '--pack-destination', destination], npmOptions({
      cwd: workdir,
      encoding: 'utf8',
    }));
  } catch (error) {
    process.stderr.write(error.stderr?.toString() || `${error.stack || error}\n`);
    throw error;
  }
  const [result] = JSON.parse(out);
  return path.join(destination, result.filename);
}

test('scaffolded app installs and builds with publish-style tarball dependencies', { skip: !canSpawnNpm && 'npm subprocesses are unavailable in this sandbox' }, () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'create-knolo-app-'));
  const packDir = mkdtempSync(path.join(tmpdir(), 'knolo-pack-'));

  const coreTarball = npmPack(path.resolve(process.cwd(), '../core'), packDir);
  const cliTarball = npmPack(path.resolve(process.cwd(), '../cli'), packDir);
  const createAppTarball = npmPack(process.cwd(), packDir);

  const launcherDir = mkdtempSync(path.join(tmpdir(), 'create-knolo-launcher-'));
  writeFileSync(
    path.join(launcherDir, 'package.json'),
    `${JSON.stringify({ name: 'launcher', private: true, type: 'module' }, null, 2)}\n`,
    'utf8'
  );
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', createAppTarball], npmOptions({
    cwd: launcherDir,
    stdio: 'inherit',
  }));

  execFileSync(process.execPath, [path.join(launcherDir, 'node_modules/create-knolo-app/bin/index.mjs'), 'my-kb-chat'], {
    cwd,
    stdio: 'inherit',
  });

  const target = path.join(cwd, 'my-kb-chat');
  assert.ok(existsSync(path.join(target, 'knolo.config.json')));
  assert.ok(existsSync(path.join(target, 'docs', 'getting-started.md')));
  assert.ok(existsSync(path.join(target, 'docs', 'citations.md')));

  const packageJsonPath = path.join(target, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  assert.equal(packageJson.name, 'my-kb-chat');
  assert.equal(packageJson.scripts['knolo:build'], 'knolo build');
  assert.match(packageJson.devDependencies['@knolo/cli'], /^\^\d+\.\d+\.\d+/);
  assert.doesNotMatch(packageJson.devDependencies['@knolo/cli'], /^(file:|workspace:|link:)/);

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
  };
  writeFileSync(packageJsonPath, `${JSON.stringify(installPackageJson, null, 2)}\n`, 'utf8');

  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], npmOptions({
    cwd: target,
    stdio: 'inherit',
  }));

  execFileSync('npm', ['run', 'knolo:build'], npmOptions({
    cwd: target,
    stdio: 'inherit',
  }));

  assert.ok(existsSync(path.join(target, 'dist', 'knowledge.knolo')));
});
