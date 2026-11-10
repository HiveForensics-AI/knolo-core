import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
const boxBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../box/bin/knolo-box.mjs'
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

function fakeBox(bin, log) {
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$KNOLO_BOX_LOG"
if [ "$1" = build ]; then
  exit 2
fi
exit 0
`
  );
  return log;
}

test('setup runs init then build and prints the connector', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'box.log');
  mkdirSync(path.join(home, '.grok'), { recursive: true });
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$KNOLO_BOX_LOG"
exit 0
`
  );
  const result = runSetup(['--registry', 'https://hub.example.test'], {
    PATH: bin,
    HOME: home,
    KNOLO_BOX_LOG: log,
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.match(lines[0], /^init /);
  assert.match(lines[0], /--tolerant/);
  assert.match(lines[0], /--hub-skills/);
  assert.match(lines[1], /^build --config /);
  assert.doesNotMatch(result.stdout, /box-status/);
  const configPath = path.join(home, '.knolo', 'box', 'box.config.json');
  assert.match(result.stdout, new RegExp(`Config: ${configPath}`));
  assert.match(
    result.stdout,
    /First install: knolo skill install <publisher>\/<name>/
  );
  assert.match(
    result.stdout,
    new RegExp(`Connector: knolo-box mcp --config ${configPath}`)
  );
  assert.match(
    result.stdout,
    /Publish needs a token from https:\/\/hub\.example\.test\/dashboard\/tokens/
  );
  assert.match(result.stderr, /No Grok skill folder was found/);
  assert.equal(existsSync(path.join(home, '.config', 'knolo')), false);
});

test('setup still builds when no Grok home exists and skips a missing binary', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'box.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$KNOLO_BOX_LOG"
exit 0
`
  );
  const missingHome = runSetup(['--registry', 'https://hub.example.test'], {
    PATH: bin,
    HOME: home,
    KNOLO_BOX_LOG: log,
  });
  assert.equal(missingHome.status, 0, missingHome.stderr);
  assert.doesNotMatch(missingHome.stderr, /No Grok home at/);
  assert.match(readFileSync(log, 'utf8'), /^init /m);
  assert.match(missingHome.stdout, /First install:/);
  assert.match(missingHome.stderr, /No Grok skill folder was found/);

  const missingBox = runSetup(['--registry', 'https://hub.example.test'], {
    PATH: path.join(root, 'empty'),
    HOME: home,
    KNOLO_BOX_LOG: path.join(root, 'unused.log'),
  });
  assert.equal(missingBox.status, 0, missingBox.stderr);
  assert.match(missingBox.stderr, /knolo-box is not on PATH/);
  assert.equal(existsSync(path.join(root, 'unused.log')), false);
  assert.match(missingBox.stdout, /First install:/);
  assert.match(missingBox.stdout, /Connector: knolo-box mcp --config /);
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
  fakeBox(bin, log);
  const built = runSetup([], {
    PATH: bin,
    HOME: home,
    GROK_HOME: grok,
    KNOLO_BOX_LOG: log,
    KNOLO_HUB_URL: 'https://hub.example.test/',
  });
  assert.notEqual(built.status, 0);
  assert.match(built.stderr, /knolo-box build exited with status 2/);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.match(lines[0], /^init /);
  assert.match(lines[0], new RegExp(`--root ${grok}`));
  assert.match(lines[1], /^build --config /);
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
printf '%s\\n' "$*" >> "$KNOLO_BOX_LOG"
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
  assert.match(readFileSync(log, 'utf8'), /--root .*\/work\/grok/);
  assert.doesNotMatch(result.stderr, /No Grok home/);
});

test('setup help names the caller and auto-rebuild flags', () => {
  const root = tempDir();
  const result = runSetup(['--help'], {
    PATH: path.join(root, 'missing'),
    HOME: root,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--root/);
  assert.match(result.stdout, /--agent/);
  assert.match(result.stdout, /--auto-rebuild/);
  assert.doesNotMatch(result.stdout, /Does not run knolo-box init/);
});

test('setup writes agent, auto-rebuild, and hub skills from a skill folder', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const source = path.join(root, 'bot');
  mkdirSync(
    path.join(source, 'agent-data', 'managed-skills', 'skills', 'hive'),
    { recursive: true }
  );
  writeFileSync(
    path.join(
      source,
      'agent-data',
      'managed-skills',
      'skills',
      'hive',
      'SKILL.md'
    ),
    '# Hive\n\nSETUP_SKILL_PHRASE\n'
  );
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(boxBin)} "$@"
`
  );
  const result = runSetup(
    [
      '--root',
      source,
      '--agent',
      'grok-bot',
      '--auto-rebuild',
      '--registry',
      'https://hub.example.test',
    ],
    { PATH: bin, HOME: home }
  );
  assert.equal(result.status, 0, result.stderr);
  const configPath = path.join(home, '.knolo', 'box', 'box.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.agentId, 'grok-bot');
  assert.equal(config.autoRebuild, true);
  const hub = realpathSync(path.join(home, '.knolo', 'skills'));
  assert.equal(config.scopes.skills.roots.includes(hub), true);
  assert.equal(
    config.scopes.skills.roots.some((rootPath) =>
      rootPath.includes(`${path.sep}managed-skills${path.sep}`)
    ),
    true
  );
  assert.match(
    result.stdout,
    new RegExp(`Connector: knolo-box mcp --config ${configPath}`)
  );
  assert.doesNotMatch(result.stderr, /No Grok skill folder was found/);
  rmSync(root, { recursive: true, force: true });
});
