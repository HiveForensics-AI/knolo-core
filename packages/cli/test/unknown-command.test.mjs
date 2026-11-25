import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-unknown-command-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a mistyped command suggests the closest command and exits 2', () => {
  withTempDir((dir) => {
    for (const [typo, expected] of [
      ['serach', 'search'],
      ['biuld', 'build'],
      ['veriyf', 'verify'],
      ['persna', 'persona'],
    ]) {
      const { status, stderr } = runCli([typo], dir);
      assert.equal(status, 2, `exit code for ${typo}`);
      assert.match(
        stderr,
        new RegExp(`Unknown command "${typo}"\\. Did you mean "${expected}"\\?`)
      );
      assert.doesNotMatch(stderr, /ENOENT/);
    }
  });
});

test('a typo with --help reports the typo instead of direct-mode usage', () => {
  withTempDir((dir) => {
    const { status, stderr, stdout } = runCli(['serach', '--help'], dir);
    assert.equal(status, 2);
    assert.match(stderr, /Did you mean "search"\?/);
    assert.doesNotMatch(stdout, /Usage: knolo <input\.json>/);
  });
});

test('an unknown word with no close match points at knolo help', () => {
  withTempDir((dir) => {
    const { status, stderr } = runCli(['zzzzzz'], dir);
    assert.equal(status, 2);
    assert.match(
      stderr,
      /Unknown command "zzzzzz"\. Run "knolo help" to list commands\./
    );
  });
});

test('direct mode still builds from an existing file without an extension', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'notes'),
      JSON.stringify([{ id: 'a', text: 'hello knolo' }])
    );
    const { status, stdout, stderr } = runCli(['notes'], dir);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /wrote knowledge\.knolo/);
    assert.ok(existsSync(path.join(dir, 'knowledge.knolo')));
  });
});

test('a missing path keeps the original file error and exit code 1', () => {
  withTempDir((dir) => {
    for (const missing of ['missing.json', './nope']) {
      const { status, stderr } = runCli([missing], dir);
      assert.equal(status, 1, `exit code for ${missing}`);
      assert.match(stderr, /ENOENT/);
      assert.doesNotMatch(stderr, /Unknown command/);
    }
  });
});
