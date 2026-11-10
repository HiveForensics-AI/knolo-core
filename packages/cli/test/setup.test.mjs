import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bin/knolo.mjs'
);

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'knolo-setup-'));
}

function writeBox(binDir, script) {
  const file = path.join(binDir, 'knolo-box');
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return file;
}

function runSetup(args, env, cwd) {
  return spawnSync(process.execPath, [cliPath, 'setup', ...args], {
    env,
    cwd,
    encoding: 'utf8',
  });
}

test('setup runs knolo-box build and prints the resolved registry', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'box.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(home, '.grok'));
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$1" >> "$KNOLO_BOX_LOG"
printf '%s\\n' '{"output":"box-status"}'
if [ "$1" != build ]; then
  exit 3
fi
exit 0
`
  );
  const result = runSetup(['--registry', 'https://hub.example.test'], {
    PATH: bin,
    HOME: home,
    KNOLO_BOX_LOG: log,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(log, 'utf8'), 'build\n');
  assert.doesNotMatch(result.stdout, /box-status/);
  assert.match(result.stdout, /knolo-mcp\.json/);
  assert.match(
    result.stdout,
    /knolo login --registry https:\/\/hub\.example\.test/
  );
  assert.match(
    result.stdout,
    /knolo skill publish --registry https:\/\/hub\.example\.test/
  );
  assert.match(
    result.stdout,
    /knolo yank --registry https:\/\/hub\.example\.test/
  );
  assert.equal(existsSync(path.join(home, '.config', 'knolo')), false);
  assert.doesNotMatch(result.stdout, /First search:[\s\S]*init/);
});

test('setup skips init and build when the Grok home or knolo-box is missing', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'box.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$1" >> "$KNOLO_BOX_LOG"
exit 0
`
  );
  const missingHome = runSetup(['--registry', 'https://hub.example.test'], {
    PATH: bin,
    HOME: home,
    KNOLO_BOX_LOG: log,
  });
  assert.equal(missingHome.status, 0, missingHome.stderr);
  assert.match(missingHome.stderr, /No Grok home at/);
  assert.equal(existsSync(log), false);

  mkdirSync(path.join(home, '.grok'));
  const missingBox = runSetup(['--registry', 'https://hub.example.test'], {
    PATH: path.join(root, 'empty'),
    HOME: home,
    KNOLO_BOX_LOG: log,
  });
  assert.equal(missingBox.status, 0, missingBox.stderr);
  assert.match(missingBox.stderr, /knolo-box is not on PATH/);
  assert.equal(existsSync(log), false);
  assert.match(missingBox.stdout, /First install:/);
});

test('setup uses GROK_HOME and fails when build exits non-zero', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const grok = path.join(root, 'grok');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'box.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(grok);
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$1" >> "$KNOLO_BOX_LOG"
exit 2
`
  );
  const built = runSetup([], {
    PATH: bin,
    HOME: home,
    GROK_HOME: grok,
    KNOLO_BOX_LOG: log,
    KNOLO_HUB_URL: 'https://hub.example.test/',
  });
  assert.notEqual(built.status, 0);
  assert.match(built.stderr, /exited with status 2/);
  assert.equal(readFileSync(log, 'utf8'), 'build\n');
  assert.doesNotMatch(built.stdout, /First install:/);
});

test('setup resolves a relative GROK_HOME from the current directory', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const work = path.join(root, 'work');
  const log = path.join(root, 'box.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(work, 'grok'), { recursive: true });
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$1" >> "$KNOLO_BOX_LOG"
exit 0
`
  );
  const result = runSetup(
    ['--registry', 'https://hub.example.test'],
    {
      PATH: bin,
      HOME: home,
      GROK_HOME: 'work/grok',
      KNOLO_BOX_LOG: log,
    },
    root
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(log, 'utf8'), 'build\n');
  assert.doesNotMatch(result.stderr, /No Grok home/);
});

test('setup help does not run knolo-box', () => {
  const root = tempDir();
  const result = runSetup(['--help'], {
    PATH: path.join(root, 'missing'),
    HOME: root,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Does not run knolo-box init/);
});
