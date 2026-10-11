import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../../core/dist/index.js';
import { openEvidenceCatalog } from '../../core/dist/experimental/kar/authoring/catalog.js';

const repo = path.resolve(process.cwd(), '../..');
const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');
const encoder = new TextEncoder();

function run(args, cwd = repo) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('domain commands validate, inspect, and test the contracts pack', () => {
  const validated = run(['kar', 'domain', 'validate', 'domains/contracts']);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  assert.match(validated.stdout, /CEG DOMAIN VALID/);
  assert.match(validated.stdout, /sha256-/);
  const inspected = run(['kar', 'domain', 'inspect', 'domains/contracts', '--json']);
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  const report = JSON.parse(inspected.stdout);
  assert.equal(report.id, 'contracts');
  assert.equal(report.version, '1');
  assert.ok(report.relations.includes('permits'));
  assert.ok(report.planTemplates.includes('balanced-review'));
  const tested = run(['kar', 'domain', 'test', 'domains/contracts']);
  assert.equal(tested.status, 0, tested.stderr || tested.stdout);
  assert.match(tested.stdout, /CEG DOMAIN PASS/);
  assert.match(tested.stdout, /rules unmatched  \(none\)/);
});

test('produce rules, review, and apply do not overwrite or auto-accept a model', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kar-produce-'));
  const image = createKnowledgeImageV5({
    actor: 'kar-produce-cli',
    sequence: 1,
    objects: [{
      kind: 'chunk',
      bytes: encoder.encode('The agreement may terminate after notice.\nThe agreement may not terminate during the annual term.\nThe duty stands except when notice is late.\n'),
      meta: { source: 'terms.md', type: 'contract' },
    }],
  });
  const imagePath = path.join(directory, 'knowledge.knolo');
  writeFileSync(imagePath, image.bytes);
  const proposals = path.join(directory, 'proposals.json');
  const produced = run(['kar', 'produce', 'rules', '--image', imagePath, '--domain', 'domains/contracts', '--out', proposals]);
  assert.equal(produced.status, 0, produced.stderr || produced.stdout);
  const again = run(['kar', 'produce', 'rules', '--image', imagePath, '--domain', 'domains/contracts', '--out', proposals]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /Refusing to overwrite/);
  const review = run(['kar', 'produce', 'review', proposals]);
  assert.equal(review.status, 0, review.stderr || review.stdout);
  assert.match(review.stdout, /PROPOSAL/);
  assert.match(review.stdout, /contracts\.termination\.permission\.v1/);
  assert.match(review.stdout, /contracts\.termination\.prohibition\.v1/);
  const source = path.join(directory, 'generated.ceg.yaml');
  const applied = run(['kar', 'produce', 'apply', '--proposals', proposals, '--out', source]);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.match(readFileSync(source, 'utf8'), /permits/);
  assert.match(readFileSync(source, 'utf8'), /prohibits/);
  const auto = path.join(directory, 'auto.ceg.yaml');
  const automatic = run(['kar', 'produce', 'rules', '--image', imagePath, '--domain', 'domains/contracts', '--out', auto, '--auto']);
  assert.equal(automatic.status, 0, automatic.stderr || automatic.stdout);
  assert.equal(readFileSync(`${directory}/auto.ceg.production.json`, 'utf8').includes('"format": "ceg-producer-run-1'), true);
  const catalog = openEvidenceCatalog(image.bytes);
  const evidenceId = catalog.catalog.objects[0].id;
  const modelPath = path.join(directory, 'model.json');
  writeFileSync(modelPath, JSON.stringify({
    format: 'ceg-model-proposals-1',
    model: { id: 'mock', version: '0' },
    concepts: [],
    relations: [{ from: 'agreement', type: 'permits', to: 'termination', evidenceId, quote: 'may terminate' }],
    bindings: [],
    aliases: [{ phrase: 'room', concept: 'lodging' }],
  }));
  const blocked = run(['kar', 'produce', 'model', '--input', modelPath, '--out', path.join(directory, 'model-run.json'), '--auto', '--image', imagePath, '--domain', 'domains/contracts']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /cannot be auto-accepted/);
  const modelOut = path.join(directory, 'model-run.json');
  const modeled = run(['kar', 'produce', 'model', '--input', modelPath, '--out', modelOut, '--image', imagePath, '--domain', 'domains/contracts']);
  assert.equal(modeled.status, 0, modeled.stderr || modeled.stdout);
  const modelRun = JSON.parse(readFileSync(modelOut, 'utf8'));
  assert.equal(modelRun.proposals.every((item) => item.state === 'PROPOSED'), true);
  const modelSource = path.join(directory, 'model.ceg.yaml');
  const modelApplied = run(['kar', 'produce', 'apply', '--proposals', modelOut, '--out', modelSource]);
  assert.equal(modelApplied.status, 0, modelApplied.stderr || modelApplied.stdout);
  assert.equal(readFileSync(modelSource, 'utf8').includes('lodging'), false);
  assert.equal(readFileSync(modelSource, 'utf8').includes('permits'), false);
});
