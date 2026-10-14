import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPack } from '../../core/dist/index.js';

const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('cortex help says verification is not a truth verdict', () => {
  const help = run(['cortex', '--help'], process.cwd());
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not mean the answer is true/);
  assert.match(help.stdout, /does not mean a claim is proven/);
  assert.doesNotMatch(help.stdout, /Claim proven/);
});

test('cortex find, explain, verify, and refuse a tampered trace', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-cortex-'));
  try {
    const bytes = await buildPack([
      { id: 'alpha', text: 'Alpha inspection of the valve passed on Monday.' },
      { id: 'beta', text: 'Beta inspection of the pump failed on Tuesday.' },
    ]);
    const image = path.join(dir, 'knowledge.knolo');
    writeFileSync(image, bytes);
    const found = run(['cortex', 'find', image, '--question', 'valve inspection', '--out', 'candidates.json'], dir);
    assert.equal(found.status, 0, found.stderr);
    assert.match(found.stdout, /^ANSWERED sha256-/);
    const trace = JSON.parse(readFileSync(path.join(dir, 'candidates.json'), 'utf8'));
    assert.equal(trace.format, 'knolo-cortex-trace-1');
    assert.equal(trace.answer.text, '');
    const explained = run(['cortex', 'explain', 'candidates.json'], dir);
    assert.equal(explained.status, 0, explained.stderr);
    assert.match(explained.stdout, /valve inspection/);
    const verified = run(['cortex', 'verify', '--image', image, '--answer', 'candidates.json'], dir);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /^ok sha256-/);
    trace.answer.gaps.push({ subquestion: trace.question, reason: 'tampered' });
    writeFileSync(path.join(dir, 'tampered.json'), `${JSON.stringify(trace, null, 2)}\n`);
    const bad = run(['cortex', 'verify', '--image', image, '--answer', 'tampered.json'], dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /CORTEX_ROOT_MISMATCH/);
    const again = run(['cortex', 'find', image, '--question', 'valve inspection', '--out', 'candidates.json'], dir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /Refusing to overwrite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
