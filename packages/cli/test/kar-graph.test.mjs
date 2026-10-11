import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../../core/dist/index.js';

const repo = path.resolve(process.cwd(), '../..');
const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');
const manual = path.resolve(repo, 'examples/kar-ceg/manual');

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

test('ceg examples compile and evaluate offline', () => {
  const ran = spawnSync(process.execPath, [path.join(repo, 'examples/kar-ceg/run-all.mjs')], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  assert.match(ran.stdout, /SATISFIED/);
  assert.match(ran.stdout, /IMPORTED related/);
  assert.match(ran.stdout, /VERIFIED/);
});

test('kar graph and package commands round-trip the manual example', () => {
  const lint = run(['kar', 'graph', 'lint', 'knowledge.ceg.yaml', '--image', 'knowledge.knolo'], manual);
  assert.equal(lint.status, 0, lint.stderr || lint.stdout);
  const review = run(['kar', 'graph', 'review', 'knowledge.ceg.yaml', '--image', 'knowledge.knolo'], manual);
  assert.equal(review.status, 0, review.stderr || review.stdout);
  assert.match(review.stdout, /CEG SOURCE REVIEW/);
  assert.match(review.stdout, /cancel-barred/);
  assert.match(review.stdout, /enterprise customer may not cancel/i);
  const built = run([
    'kar', 'graph', 'build',
    '--image', 'knowledge.knolo',
    '--source', 'knowledge.ceg.yaml',
    '--out', 'knowledge.kar.json',
    '--json',
  ], manual);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const report = JSON.parse(built.stdout);
  assert.equal(report.ok, true);
  assert.match(report.semanticRoot, /^sha256-[0-9a-f]{64}$/);
  assert.equal(report.nodes, 2);
  assert.equal(report.relations, 2);
  assert.equal(report.bindings, 2);
  const validated = run([
    'kar', 'graph', 'validate',
    '--image', 'knowledge.knolo',
    '--graph', 'knowledge.kar.json',
    '--build', 'knowledge.kar.build.json',
  ], manual);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  assert.match(validated.stdout, /CEG VALID/);
  const inspected = run(['kar', 'graph', 'inspect', 'knowledge.kar.json'], manual);
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  assert.match(inspected.stdout, /knolo-ceg-compiler\/source-v1/);
  assert.match(inspected.stdout, /semanticRoot/);
  assert.match(inspected.stdout, /prohibits/);
  const bound = run(['kar', 'graph', 'inspect', 'knowledge.kar.json', '--image', 'knowledge.knolo'], manual);
  assert.equal(bound.status, 0, bound.stderr || bound.stdout);
  assert.match(bound.stdout, /image binding        bound/);
  const checked = run(['kar', 'graph', 'check', '--image', 'knowledge.knolo', '--graph', 'knowledge.kar.json'], manual);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /CEG BOUND/);
  const rebuilt = run([
    'kar', 'graph', 'rebuild',
    '--image', 'knowledge.knolo',
    '--source', 'knowledge.ceg.yaml',
    '--previous', 'knowledge.kar.json',
    '--out', 'rebuilt.kar.json',
  ], manual);
  assert.equal(rebuilt.status, 0, rebuilt.stderr || rebuilt.stdout);
  assert.match(rebuilt.stdout, /CEG REBUILT/);
  const same = readFileSync(path.join(manual, 'knowledge.kar.json'), 'utf8');
  assert.equal(readFileSync(path.join(manual, 'rebuilt.kar.json'), 'utf8'), same);
  const other = path.join(manual, 'changed.ceg.yaml');
  writeFileSync(other, readFileSync(path.join(manual, 'knowledge.ceg.yaml'), 'utf8').replace('permits', 'qualifies'));
  const changed = run([
    'kar', 'graph', 'build',
    '--image', 'knowledge.knolo',
    '--source', 'changed.ceg.yaml',
    '--out', 'changed.kar.json',
  ], manual);
  assert.equal(changed.status, 0, changed.stderr || changed.stdout);
  const diff = run(['kar', 'graph', 'diff', 'knowledge.kar.json', 'changed.kar.json'], manual);
  assert.equal(diff.status, 0, diff.stderr || diff.stdout);
  assert.match(diff.stdout, /relations added\s+1/);
  assert.match(diff.stdout, /relations removed\s+1/);
  assert.match(diff.stdout, /old SemanticRoot/);
  assert.match(diff.stdout, /new SemanticRoot/);
  const packed = run([
    'kar', 'package',
    '--image', 'knowledge.knolo',
    '--graph', 'knowledge.kar.json',
    '--out', 'dist-bundle',
  ], manual);
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  assert.match(packed.stdout, /KAR PACKAGED/);
  const verified = run(['kar', 'package', 'verify', 'dist-bundle'], manual);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.match(verified.stdout, /KAR BUNDLE VERIFIED/);
  const encoder = new TextEncoder();
  const staleImage = createKnowledgeImageV5({
    actor: 'ceg-stale-cli',
    sequence: 2,
    objects: [{ kind: 'chunk', bytes: encoder.encode('different evidence'), meta: { source: 'policy.md' } }],
  });
  const staleDir = mkdtempSync(path.join(tmpdir(), 'ceg-stale-'));
  writeFileSync(path.join(staleDir, 'knowledge.knolo'), staleImage.bytes);
  writeFileSync(path.join(staleDir, 'knowledge.kar.json'), same);
  const stale = run(['kar', 'graph', 'check', '--image', 'knowledge.knolo', '--graph', 'knowledge.kar.json'], staleDir);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /CEG_STALE_IMAGE/);
  assert.match(stale.stdout, /Recompile from the CEG Source/);
  rmSync(staleDir, { recursive: true, force: true });
  rmSync(path.join(manual, 'rebuilt.kar.json'), { force: true });
  rmSync(path.join(manual, 'rebuilt.kar.build.json'), { force: true });
  rmSync(path.join(manual, 'changed.ceg.yaml'), { force: true });
  rmSync(path.join(manual, 'changed.kar.json'), { force: true });
  rmSync(path.join(manual, 'changed.kar.build.json'), { force: true });
  rmSync(path.join(manual, 'dist-bundle'), { recursive: true, force: true });
});

test('kar graph rejects a missing evidence reference at build time', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ceg-missing-'));
  const encoder = new TextEncoder();
  const image = createKnowledgeImageV5({
    actor: 'ceg-missing-cli',
    sequence: 1,
    objects: [{ kind: 'chunk', bytes: encoder.encode('only policy'), meta: { source: 'policy.md' } }],
  });
  writeFileSync(path.join(dir, 'knowledge.knolo'), image.bytes);
  writeFileSync(path.join(dir, 'knowledge.ceg.yaml'), `format: ceg-source-1
concepts:
  customer:
  cancellation:
evidence:
  missing:
    source: absent.md
relations:
  - from: customer
    type: prohibits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: missing
    requirements:
      - cancel-barred
`);
  const built = run(['kar', 'graph', 'build', '--image', 'knowledge.knolo', '--source', 'knowledge.ceg.yaml', '--out', 'knowledge.kar.json'], dir);
  assert.equal(built.status, 1);
  assert.match(built.stdout, /CEG_EVIDENCE_NOT_FOUND/);
  rmSync(dir, { recursive: true, force: true });
});
