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

// knolo-box.mjs imports packages/box/dist. The CLI suite only builds core,
// so this test compiles the connector when that file is absent.
function ensureBoxBuilt() {
  const dist = path.resolve(path.dirname(boxBin), '../dist/cli.js');
  if (existsSync(dist)) return;
  const repo = path.resolve(path.dirname(boxBin), '../../..');
  const built = spawnSync(
    'npm',
    ['run', 'build', '--workspace', '@knolo/box'],
    { cwd: repo, encoding: 'utf8', env: process.env }
  );
  assert.equal(built.status, 0, built.stderr || built.stdout);
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
  assert.doesNotMatch(built.stderr, /\bat /);
  assert.equal(built.stderr.trim().split('\n').length, 1);
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
  assert.match(result.stdout, /--reset/);
  assert.doesNotMatch(result.stdout, /Does not run knolo-box init/);
});

test('setup writes agent, auto-rebuild, and hub skills from a skill folder', () => {
  ensureBoxBuilt();
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

test('setup keeps an existing config and only rebuilds it', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'box.log');
  const configPath = path.join(home, '.knolo', 'box', 'box.config.json');
  mkdirSync(path.dirname(configPath), { recursive: true });
  const hub = path.join(home, '.knolo', 'skills');
  const original = `${JSON.stringify(
    { output: '/keep-me', scopes: { skills: { roots: [hub] } } },
    null,
    2
  )}\n`;
  writeFileSync(configPath, original);
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
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /^build --config /);
  assert.doesNotMatch(calls, /\binit\b/);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  assert.match(result.stderr, /Kept the existing config/);
  rmSync(root, { recursive: true, force: true });
});

test('setup merges flags into an existing config', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'box.log');
  const configPath = path.join(home, '.knolo', 'box', 'box.config.json');
  mkdirSync(path.dirname(configPath), { recursive: true });
  const original = `${JSON.stringify({ agentId: 'kept', output: '/keep-me' })}\n`;
  writeFileSync(configPath, original);
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$KNOLO_BOX_LOG"
exit 0
`
  );
  const merged = runSetup(['--agent', 'grok-bot', '--root', path.join(root, 'agent-data')], {
    PATH: bin,
    HOME: home,
    KNOLO_BOX_LOG: log,
  });
  assert.equal(merged.status, 0, merged.stderr);
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /init /);
  assert.match(calls, /--merge/);
  assert.match(calls, /--agent grok-bot/);
  assert.match(calls, /--hub-skills/);
  assert.doesNotMatch(calls, /--force/);
  assert.match(merged.stderr, /Kept the existing config/);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  const reset = runSetup(['--reset'], {
    PATH: bin,
    HOME: home,
    KNOLO_BOX_LOG: log,
  });
  assert.equal(reset.status, 0, reset.stderr);
  assert.match(readFileSync(log, 'utf8'), /--force/);
  rmSync(root, { recursive: true, force: true });
});

test('setup names the scanned root when no skill folder is found', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const agentData = path.join(root, 'agent-data');
  mkdirSync(bin);
  writeBox(
    bin,
    `#!/bin/sh
exit 0
`
  );
  const result = runSetup(['--root', agentData], { PATH: bin, HOME: home });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /No Grok skill folder was found/);
  assert.match(result.stderr, new RegExp(`Scanned ${agentData}`));
  assert.match(
    result.stderr,
    /A root needs to contain agent-data or sand-data, or be the skill folder itself/
  );
  rmSync(root, { recursive: true, force: true });
});

test('setup errors stay on one line unless --debug is set', () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const plain = runSetup(['--nope'], { PATH: '', HOME: home });
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /^knolo: Unknown argument for setup: --nope\n$/);
  assert.doesNotMatch(plain.stderr, /\bat /);
  const debug = spawnSync(process.execPath, [cliPath, '--debug', 'setup', '--nope'], {
    env: { PATH: '', HOME: home },
    encoding: 'utf8',
  });
  assert.equal(debug.status, 1);
  assert.match(debug.stderr, /\n {4}at /);
  rmSync(root, { recursive: true, force: true });
});
