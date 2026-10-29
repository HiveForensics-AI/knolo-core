import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildPack,
  createKnowledgeImageV5,
} from '../../../../packages/core/dist/index.js';
import {
  compileCegSource,
  validateCegSource,
} from '../../../../packages/core/dist/kar/authoring/index.js';
import {
  createCompositionAttestation,
  createCompositionRecord,
} from '../../../../packages/core/dist/composition/index.js';
import {
  askCortex,
  createCortexSession,
} from '../../../../packages/core/dist/cortex/index.js';
import {
  createKarCoverage,
  createKarDossier,
  renderKarCoverage,
  renderKarDossier,
} from '../../../../packages/core/dist/kar/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const runner = path.join(here, '..', 'run.mjs');
const installer = path.join(here, '..', 'install-cli.mjs');
const cli = path.join(repo, 'packages/cli/bin/knolo.mjs');
const encoder = new TextEncoder();

const sourceText = `format: ceg-source-1
concepts:
  procedure:
    label: Procedure
  valve:
    label: Valve
evidence:
  step:
    source: step.txt
relations:
  - from: procedure
    type: requires
    to: valve
bindings:
  - concept: valve
    evidence: step
    requirements:
      - close-valve
requirements:
  - close-valve
`;

const otherSourceText = sourceText.replaceAll('close-valve', 'open-valve');

function runRunner(workspace, inputs) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'knolo-verify-out-'));
  const summary = path.join(scratch, 'summary.md');
  const output = path.join(scratch, 'github-output.txt');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  const result = spawnSync(process.execPath, [runner], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      INPUTS_JSON: JSON.stringify(inputs),
      GITHUB_WORKSPACE: workspace,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      KNOLO_BIN: cli,
      KNOLO_VERIFY_TEST_BIN: '1',
      RUNNER_TEMP: scratch,
    },
  });
  const resultsFile = readFileSync(output, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('results='))
    ?.slice('results='.length);
  const returned = {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    summary: readFileSync(summary, 'utf8'),
    output: readFileSync(output, 'utf8'),
    results: resultsFile ? JSON.parse(readFileSync(resultsFile, 'utf8')) : [],
  };
  rmSync(scratch, { recursive: true, force: true });
  return returned;
}

function cliRun(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function flipDigest(value) {
  const last = value.at(-1) === '0' ? '1' : '0';
  return `${value.slice(0, -1)}${last}`;
}

function flipByte(bytes) {
  const copy = Uint8Array.from(bytes);
  copy[copy.length - 1] ^= 0xff;
  return copy;
}

function compile(image, source) {
  const parsed = validateCegSource(source);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
  const compiled = compileCegSource({ source: parsed.source, image });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const graphBytes = encoder.encode(
    `${JSON.stringify(compiled.sidecar, null, 2)}\n`
  );
  return {
    sidecar: compiled.sidecar,
    graphBytes,
    nodeId: compiled.sidecar.graph.relations[0].from,
  };
}

function planFor(nodeId) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId, queryTerm: 'evidence' }] },
    frontierMap: { requires: 'F_S', prohibits: 'F_O' },
    depth: 2,
    cardinalityBound: 4,
    coverageMode: 'requirements',
    requirements: { F_S: ['close-valve'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds: {
      maxAnchorNodes: 8,
      maxClosureNodes: 32,
      maxClosureEdges: 32,
      maxFrontierEvidence: 8,
      maxRequirementsPerFrontier: 4,
      maxEvidenceBindings: 8,
      maxCoverVisits: 256,
    },
    lexical: null,
  };
}

function materialize(dir) {
  const image = createKnowledgeImageV5({
    actor: 'knolo-verify-action',
    sequence: 1,
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode(
          'The operator must close the valve. This sentence is evidence for the plan.'
        ),
        meta: { source: 'step.txt' },
      },
    ],
  });
  const graph = compile(image.bytes, sourceText);
  const other = compile(image.bytes, otherSourceText);
  const plan = planFor(graph.nodeId);
  const proposition = 'What evidence shows the valve is closed?';
  writeFileSync(path.join(dir, 'image.v5'), image.bytes);
  writeFileSync(path.join(dir, 'image-bad.v5'), flipByte(image.bytes));
  writeFileSync(path.join(dir, 'knowledge.kar.json'), graph.graphBytes);
  writeFileSync(path.join(dir, 'knowledge-other.kar.json'), other.graphBytes);
  writeFileSync(
    path.join(dir, 'knowledge-bad.kar.json'),
    flipByte(graph.graphBytes)
  );

  cliRun(
    [
      'kar',
      'package',
      '--image',
      'image.v5',
      '--graph',
      'knowledge.kar.json',
      '--out',
      'kar-package',
    ],
    dir
  );
  cpSync(path.join(dir, 'kar-package'), path.join(dir, 'kar-package-bad'), {
    recursive: true,
  });
  writeFileSync(
    path.join(dir, 'kar-package-bad', 'knowledge.kar.json'),
    flipByte(readFileSync(path.join(dir, 'kar-package', 'knowledge.kar.json')))
  );

  const dossier = createKarDossier({
    image: image.bytes,
    graph: graph.sidecar,
    plan,
    proposition,
  });
  const dossierDir = path.join(dir, 'dossier');
  const badDossierDir = path.join(dir, 'dossier-bad');
  for (const target of [dossierDir, badDossierDir]) {
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'knowledge.knolo'), image.bytes);
    writeFileSync(path.join(target, 'knowledge.kar.json'), graph.graphBytes);
    writeJson(path.join(target, 'plan.json'), plan);
    writeJson(path.join(target, 'manifest.json'), dossier.manifest);
    writeJson(path.join(target, 'certificate.json'), dossier.certificate);
    writeJson(path.join(target, 'result.json'), dossier.evaluation);
    writeFileSync(path.join(target, 'evidence.md'), renderKarDossier(dossier));
  }
  writeFileSync(
    path.join(badDossierDir, 'evidence.md'),
    `${renderKarDossier(dossier)}\nchanged\n`
  );

  const coverage = createKarCoverage({
    image: image.bytes,
    graph: graph.sidecar,
    cases: [{ id: 'met', proposition, plan }],
  });
  for (const name of ['coverage', 'coverage-bad']) {
    const target = path.join(dir, name);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'knowledge.knolo'), image.bytes);
    writeFileSync(path.join(target, 'knowledge.kar.json'), graph.graphBytes);
    writeJson(path.join(target, 'cases.json'), {
      format: 'kar-coverage-cases-1',
      domainPack: coverage.domainPack,
      cases: [{ id: 'met', proposition, plan }],
    });
    writeJson(path.join(target, 'report.json'), coverage);
    writeJson(path.join(target, 'manifest.json'), coverage.manifest);
    writeFileSync(
      path.join(target, 'coverage.md'),
      renderKarCoverage(coverage)
    );
  }
  const badManifest = {
    ...coverage.manifest,
    coverageRoot: flipDigest(coverage.manifest.coverageRoot),
  };
  writeJson(path.join(dir, 'coverage-bad', 'manifest.json'), badManifest);

  const composition = createCompositionRecord({
    availability: 'material',
    members: [{ alias: 'image', kind: 'v5-image', bytes: image.bytes }],
  });
  const compositionDir = path.join(dir, 'composition');
  const badCompositionDir = path.join(dir, 'composition-bad');
  mkdirSync(compositionDir, { recursive: true });
  mkdirSync(badCompositionDir, { recursive: true });
  writeMemberBundle(compositionDir, composition, image.bytes);
  writeMemberBundle(badCompositionDir, composition, image.bytes);
  const badRecord = JSON.parse(
    readFileSync(path.join(badCompositionDir, 'composition.json'), 'utf8')
  );
  badRecord.availability = 'digest';
  writeJson(path.join(badCompositionDir, 'composition.json'), badRecord);

  const attestation = createCompositionAttestation({
    record: composition.record,
    statement: 'cited',
    subject: {
      kind: 'composition',
      compositionRoot: composition.compositionRoot,
    },
  }).attestation;
  writeJson(path.join(dir, 'attestation.json'), attestation);
  writeJson(path.join(dir, 'attestation-bad.json'), {
    ...attestation,
    statement: 'used',
  });

  return { image, graph };
}

function writeMemberBundle(dir, composition, image) {
  const recordText = `${JSON.stringify(composition.record, null, 2)}\n`;
  const memberPath = 'members/image.knolo';
  mkdirSync(path.join(dir, 'members'), { recursive: true });
  writeFileSync(path.join(dir, memberPath), image);
  writeFileSync(path.join(dir, 'composition.json'), recordText);
  const sha = sha256(image);
  const recordSha = sha256(encoder.encode(recordText));
  writeJson(path.join(dir, 'bundle.json'), {
    format: 'composition-bundle-1',
    version: 1,
    compositionRoot: composition.compositionRoot,
    members: [
      { alias: 'image', kind: 'v5-image', path: memberPath, sha256: sha },
    ],
    files: [
      { path: 'composition.json', sha256: recordSha },
      { path: memberPath, sha256: sha },
    ],
  });
}

function sha256(bytes) {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

test('installer rejects a range before npm runs', () => {
  const marker = path.join(tmpdir(), `knolo-verify-npm-${process.pid}`);
  rmSync(marker, { force: true });
  const bin = mkdtempSync(path.join(tmpdir(), 'knolo-verify-bin-'));
  writeFileSync(
    path.join(bin, 'npm'),
    `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`
  );
  spawnSync('chmod', ['+x', path.join(bin, 'npm')]);
  const result = spawnSync(process.execPath, [installer], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      KNOLO_CLI_VERSION: 'latest',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact version/);
  assert.equal(readOptional(marker), null);
  rmSync(bin, { recursive: true, force: true });
});

test('committed pack fixtures pass and fail closed', () => {
  const good = runRunner(repo, {
    packs: 'conformance/packs/verified-v4.knolo',
    summary: true,
  });
  assert.equal(good.status, 0, good.stderr || good.stdout);
  assert.equal(good.results[0].status, 'pass');
  assert.equal(good.results[0].check, 'pack verify');
  assert.match(good.summary, /does not mean a claim is proven/);
  assert.match(good.output, /passed=true/);
  const bad = runRunner(repo, { packs: 'conformance/packs/truncated.knolo' });
  assert.equal(bad.status, 1);
  assert.equal(bad.results[0].status, 'fail');
});

test('clean artifacts pass and tampered artifacts fail', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-'));
  try {
    const pack = await buildPack([
      { id: 'notes', text: 'billing appears in the verified pack' },
    ]);
    const otherPack = await buildPack([
      { id: 'notes', text: 'shipping appears in the other pack' },
    ]);
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'dist', 'notes.knolo'), pack);
    writeFileSync(path.join(dir, 'dist', 'notes-bad.knolo'), flipByte(pack));
    writeFileSync(path.join(dir, 'other.knolo'), otherPack);
    writeFileSync(path.join(dir, 'same.knolo'), pack);
    materialize(dir);
    const cortexPack = await buildPack([
      { id: 'alpha', text: 'Alpha inspection of the valve passed on Monday.' },
    ]);
    writeFileSync(path.join(dir, 'cortex.knolo'), cortexPack);
    const session = await createCortexSession({ image: cortexPack });
    const trace = await askCortex(session, {
      question: 'valve inspection',
      mode: 'find_relevant',
    });
    writeJson(path.join(dir, 'answer.cortex.json'), trace);
    const tampered = {
      ...trace,
      answer: { ...trace.answer, text: 'invented' },
    };
    writeJson(path.join(dir, 'answer-bad.cortex.json'), tampered);

    const good = runRunner(dir, {
      packs: 'dist/notes.knolo',
      images: 'image.v5',
      'kar-packages': 'kar-package',
      'kar-graphs': 'image.v5=knowledge.kar.json',
      'kar-dossiers': 'dossier',
      'kar-coverage': 'coverage',
      compositions: 'composition',
      attestations: 'attestation.json',
      'attestation-args': '--content-only',
      'cortex-traces': 'cortex.knolo=answer.cortex.json',
      'diff-pairs': 'dist/notes.knolo=same.knolo',
      'kar-graph-diffs': 'knowledge.kar.json=knowledge.kar.json',
      summary: true,
    });
    assert.equal(
      good.status,
      0,
      `${good.stderr}\n${JSON.stringify(good.results, null, 2)}`
    );
    assert.equal(
      good.results.every((row) => row.status === 'pass'),
      true
    );
    assert.equal(
      good.results.some((row) => row.root.length > 0),
      true
    );
    assert.match(good.summary, /pack verify/);

    const bad = runRunner(dir, {
      packs: 'dist/notes-bad.knolo',
      images: 'image-bad.v5',
      'kar-packages': 'kar-package-bad',
      'kar-graphs': 'image.v5=knowledge-bad.kar.json',
      'kar-dossiers': 'dossier-bad',
      'kar-coverage': 'coverage-bad',
      compositions: 'composition-bad',
      attestations: 'attestation-bad.json',
      'attestation-args': '--content-only',
      'cortex-traces': 'cortex.knolo=answer-bad.cortex.json',
      'diff-pairs': 'dist/notes.knolo=other.knolo',
      'kar-graph-diffs': 'knowledge.kar.json=knowledge-other.kar.json',
      'fail-on-diff': true,
    });
    assert.equal(bad.status, 1, JSON.stringify(bad.results, null, 2));
    const failed = bad.results.filter((row) => row.status !== 'pass');
    assert.equal(
      failed.length,
      bad.results.length,
      JSON.stringify(bad.results, null, 2)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a reported diff stays changed until fail-on-diff is set', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-diff-'));
  try {
    const pack = await buildPack([
      { id: 'notes', text: 'billing appears in the verified pack' },
    ]);
    const other = await buildPack([
      { id: 'notes', text: 'shipping appears in the other pack' },
    ]);
    writeFileSync(path.join(dir, 'base.knolo'), pack);
    writeFileSync(path.join(dir, 'next.knolo'), other);
    const reported = runRunner(dir, {
      'diff-pairs': 'base.knolo=next.knolo',
      'fail-on-diff': false,
    });
    assert.equal(
      reported.status,
      0,
      reported.stderr || JSON.stringify(reported.results)
    );
    assert.equal(reported.results[0].status, 'changed');
    const denied = runRunner(dir, {
      'diff-pairs': 'base.knolo=next.knolo',
      'fail-on-diff': true,
    });
    assert.equal(denied.status, 1);
    assert.equal(denied.results[0].status, 'fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diff-base compares a pack with the committed bytes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-git-'));
  try {
    const pack = await buildPack([
      { id: 'notes', text: 'billing appears in the verified pack' },
    ]);
    const other = await buildPack([
      { id: 'notes', text: 'shipping appears in the other pack' },
    ]);
    writeFileSync(path.join(dir, 'notes.knolo'), pack);
    git(dir, ['init']);
    git(dir, ['add', 'notes.knolo']);
    git(dir, [
      '-c',
      'user.email=knolo-verify@example.com',
      '-c',
      'user.name=Knolo Verify',
      'commit',
      '-m',
      'base',
    ]);
    writeFileSync(path.join(dir, 'notes.knolo'), other);
    const reported = runRunner(dir, {
      packs: 'notes.knolo',
      'diff-base': 'HEAD',
      'fail-on-diff': false,
    });
    assert.equal(
      reported.status,
      0,
      reported.stderr || JSON.stringify(reported.results)
    );
    assert.equal(
      reported.results.find((row) => row.check === 'pack verify').status,
      'pass'
    );
    assert.equal(
      reported.results.find((row) => row.check === 'pack diff').status,
      'changed'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing diff-base fails instead of reporting a change', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-ref-'));
  try {
    const pack = await buildPack([
      { id: 'notes', text: 'billing appears in the verified pack' },
    ]);
    writeFileSync(path.join(dir, 'notes.knolo'), pack);
    git(dir, ['init']);
    const missing = runRunner(dir, {
      packs: 'notes.knolo',
      'diff-base': 'refs/not-a-base',
      'fail-on-diff': false,
    });
    assert.equal(missing.status, 1, JSON.stringify(missing.results));
    const row = missing.results.find((item) => item.check === 'pack diff');
    assert.equal(row.status, 'fail');
    assert.match(row.detail, /not a commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pack missing from a resolved diff-base is a change', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-absent-'));
  try {
    writeFileSync(path.join(dir, 'keep.txt'), 'keep\n');
    git(dir, ['init']);
    git(dir, ['add', 'keep.txt']);
    git(dir, [
      '-c',
      'user.email=knolo-verify@example.com',
      '-c',
      'user.name=Knolo Verify',
      'commit',
      '-m',
      'base',
    ]);
    const pack = await buildPack([
      { id: 'notes', text: 'billing appears in the verified pack' },
    ]);
    writeFileSync(path.join(dir, 'notes.knolo'), pack);
    const reported = runRunner(dir, {
      packs: 'notes.knolo',
      'diff-base': 'HEAD',
      'fail-on-diff': false,
    });
    assert.equal(reported.status, 0, JSON.stringify(reported.results));
    assert.equal(
      reported.results.find((row) => row.check === 'pack diff').status,
      'changed'
    );
    const denied = runRunner(dir, {
      packs: 'notes.knolo',
      'diff-base': 'HEAD',
      'fail-on-diff': true,
    });
    assert.equal(denied.status, 1);
    assert.equal(
      denied.results.find((row) => row.check === 'pack diff').status,
      'fail'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ambient KNOLO_BIN does not replace the installed CLI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-bin-'));
  const scratch = mkdtempSync(path.join(tmpdir(), 'knolo-verify-bin-out-'));
  const marker = path.join(dir, 'used-ambient-bin');
  const fake = path.join(dir, 'fake-knolo.mjs');
  try {
    writeFileSync(
      fake,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'used');\nprocess.exit(0);\n`
    );
    writeFileSync(path.join(scratch, 'summary.md'), '');
    writeFileSync(path.join(scratch, 'github-output.txt'), '');
    const env = {
      ...process.env,
      INPUTS_JSON: JSON.stringify({ packs: 'notes.knolo' }),
      GITHUB_WORKSPACE: dir,
      GITHUB_STEP_SUMMARY: path.join(scratch, 'summary.md'),
      GITHUB_OUTPUT: path.join(scratch, 'github-output.txt'),
      KNOLO_BIN: fake,
      RUNNER_TEMP: scratch,
    };
    delete env.KNOLO_VERIFY_TEST_BIN;
    const result = spawnSync(process.execPath, [runner], {
      cwd: dir,
      encoding: 'utf8',
      env,
    });
    assert.equal(readOptional(marker), null);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('each invocation writes its own results file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-unique-'));
  const temp = mkdtempSync(path.join(tmpdir(), 'knolo-verify-unique-temp-'));
  try {
    const first = spawnRunner(dir, temp, { packs: 'missing-a.knolo' });
    const second = spawnRunner(dir, temp, { packs: 'missing-b.knolo' });
    assert.notEqual(first.resultsPath, second.resultsPath);
    assert.equal(
      JSON.parse(readFileSync(first.resultsPath, 'utf8'))[0].artifact,
      'missing-a.knolo'
    );
    assert.equal(
      JSON.parse(readFileSync(second.resultsPath, 'utf8'))[0].artifact,
      'missing-b.knolo'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
});

test('attestation args are not passed through a shell', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-shell-'));
  const marker = path.join(dir, 'pwned');
  try {
    writeFileSync(path.join(dir, 'attestation.json'), '{}\n');
    const result = runRunner(dir, {
      attestations: 'attestation.json',
      'attestation-args': `$(touch ${marker})`,
    });
    assert.equal(result.status, 1);
    assert.equal(readOptional(marker), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty selection fails closed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-empty-'));
  try {
    const result = runRunner(dir, {});
    assert.equal(result.status, 1);
    assert.equal(result.results[0].check, 'selection');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function spawnRunner(workspace, temp, inputs) {
  const summary = path.join(temp, `summary-${inputs.packs}.md`);
  const output = path.join(temp, `output-${inputs.packs}.txt`);
  writeFileSync(summary, '');
  writeFileSync(output, '');
  const result = spawnSync(process.execPath, [runner], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      INPUTS_JSON: JSON.stringify(inputs),
      GITHUB_WORKSPACE: workspace,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      KNOLO_BIN: cli,
      KNOLO_VERIFY_TEST_BIN: '1',
      RUNNER_TEMP: temp,
    },
  });
  const resultsPath = readFileSync(output, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('results='))
    ?.slice('results='.length);
  assert.equal(result.status ?? 1, 1, result.stderr || result.stdout);
  assert.ok(resultsPath);
  return { resultsPath };
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function readOptional(file) {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}
