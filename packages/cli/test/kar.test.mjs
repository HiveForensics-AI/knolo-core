import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = path.resolve(process.cwd(), '../..');
const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');
const exampleDir = path.resolve(repo, 'examples/kar');

function run(args, cwd = repo) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test('kar help is available and experimental', () => {
  const help = run(['kar', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /knolo kar evaluate/);
  assert.match(help.stdout, /kar-1-research-1/);
  const root = run(['help']);
  assert.match(root.stdout, /kar\s+Experimental/);
});

test('kar evaluate, verify, explain, and inspect the example', () => {
  const built = spawnSync(process.execPath, [path.join(exampleDir, 'run.mjs')], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  assert.match(built.stdout, /SUPPORT/);
  assert.match(built.stdout, /OPPOSITION/);
  assert.match(built.stdout, /VERIFIED/);

  const args = [
    '--image', path.join(exampleDir, 'knowledge.knolo'),
    '--graph', path.join(exampleDir, 'knowledge.kar.json'),
    '--plan', path.join(exampleDir, 'plan.json'),
    '--query', 'Can this enterprise customer cancel?',
  ];
  const human = run(['kar', 'evaluate', ...args]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /STATUS\nSATISFIED/);
  assert.match(human.stdout, /SUPPORT/);
  assert.match(human.stdout, /OPPOSITION/);
  assert.match(human.stdout, /QUALIFICATION/);
  assert.match(human.stdout, /TEMPORAL/);
  assert.match(human.stdout, /AUTHORITY/);
  assert.match(human.stdout, /SELECTED EVIDENCE/);
  assert.match(human.stdout, /KAR ROOT/);
  assert.match(human.stdout, /V5 STATE ROOT/);
  assert.match(human.stdout, /KAR KNOWLEDGE ROOT/);

  const json = run(['kar', 'evaluate', ...args, '--json']);
  assert.equal(json.status, 0, json.stderr);
  const evaluation = JSON.parse(json.stdout);
  assert.equal(evaluation.status, 'SATISFIED');
  assert.equal(evaluation.certificate.version, 'kar-1-research-1');
  assert.notEqual(evaluation.image.stateRoot, evaluation.image.knowledgeRoot);
  assert.ok(!('hits' in evaluation));

  const verified = run(['kar', 'verify', ...args, '--result', path.join(exampleDir, 'result.json')]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.stdout.trim(), 'VERIFIED');

  const dir = mkdtempSync(path.join(tmpdir(), 'kar-cli-'));
  try {
    const tampered = JSON.parse(readFileSync(path.join(exampleDir, 'result.json'), 'utf8'));
    tampered.certificate.roots.karRoot = `${tampered.certificate.roots.karRoot.slice(0, -1)}0`;
    const tamperedPath = path.join(dir, 'tampered.json');
    writeFileSync(tamperedPath, JSON.stringify(tampered));
    const failed = run(['kar', 'verify', ...args, '--result', tamperedPath]);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout, /KAR_RESULT_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const explained = run(['kar', 'explain', '--result', path.join(exampleDir, 'result.json')]);
  assert.equal(explained.status, 0, explained.stderr);
  assert.match(explained.stdout, /status SATISFIED/);
  const partial = run(['kar', 'explain', '--result', path.join(exampleDir, 'result.json'), '--image', path.join(exampleDir, 'knowledge.knolo')]);
  assert.notEqual(partial.status, 0);
  assert.match(partial.stderr, /requires --image, --graph, --plan, and --query/);

  const inspected = run(['kar', 'inspect', '--image', args[1], '--graph', args[3], '--plan', args[5], '--query', args[7]]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /V5 state root/);
  assert.match(inspected.stdout, /KAR knowledge root/);
  assert.match(inspected.stdout, /CEG semantic root/);
  assert.match(inspected.stdout, /cover risk\s+low/);
  const state = inspected.stdout.match(/V5 state root\s+(\S+)/)?.[1];
  const knowledge = inspected.stdout.match(/KAR knowledge root\s+(\S+)/)?.[1];
  assert.notEqual(state, knowledge);
});
