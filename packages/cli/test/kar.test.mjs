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
  assert.match(root.stdout, /KAR evidence-set retrieval/);
  assert.match(help.stdout, /knolo kar conformance/);
  assert.match(help.stdout, /knolo kar coverage build/);
  assert.match(help.stdout, /knolo kar coverage verify/);
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

test('kar dossier builds, repeats, and fails closed on tampering', () => {
  const built = spawnSync(process.execPath, [path.join(exampleDir, 'run.mjs')], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const dir = mkdtempSync(path.join(tmpdir(), 'kar-dossier-'));
  const out = path.join(dir, 'dossier');
  const args = [
    '--image', path.join(exampleDir, 'knowledge.knolo'),
    '--graph', path.join(exampleDir, 'knowledge.kar.json'),
    '--plan', path.join(exampleDir, 'plan.json'),
    '--query', 'Can this enterprise customer cancel?',
    '--out', out,
  ];
  try {
    const first = run(['kar', 'dossier', 'build', ...args]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /Evidence requirements satisfied/);
    const evidence = readFileSync(path.join(out, 'evidence.md'), 'utf8');
    assert.match(evidence, /PROPOSITION/);
    assert.match(evidence, /Evidence requirements satisfied/);
    assert.doesNotMatch(evidence, /Claim proven true|Claim false/);
    const verified = run(['kar', 'dossier', 'verify', out]);
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    assert.equal(verified.stdout.trim(), 'VERIFIED');
    const againDir = path.join(dir, 'again');
    const again = run(['kar', 'dossier', 'build', ...args.slice(0, -1), againDir]);
    assert.equal(again.status, 0, again.stderr || again.stdout);
    assert.equal(readFileSync(path.join(out, 'manifest.json'), 'utf8'), readFileSync(path.join(againDir, 'manifest.json'), 'utf8'));
    assert.equal(readFileSync(path.join(out, 'certificate.json'), 'utf8'), readFileSync(path.join(againDir, 'certificate.json'), 'utf8'));
    assert.equal(readFileSync(path.join(out, 'evidence.md'), 'utf8'), readFileSync(path.join(againDir, 'evidence.md'), 'utf8'));
    const refused = run(['kar', 'dossier', 'build', ...args]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to overwrite/);
    const certificate = JSON.parse(readFileSync(path.join(out, 'certificate.json'), 'utf8'));
    certificate.roots.karRoot = `${certificate.roots.karRoot.slice(0, -1)}0`;
    writeFileSync(path.join(out, 'certificate.json'), JSON.stringify(certificate));
    const failed = run(['kar', 'dossier', 'verify', out]);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout, /KAR_RESULT_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('kar coverage builds a gap report and fails closed on tampering', () => {
  const built = spawnSync(process.execPath, [path.join(repo, 'examples', 'kar-coverage', 'run.mjs')], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  assert.match(built.stdout, /Evidence requirements not satisfied/);
  const exampleDir = path.join(repo, 'examples', 'kar-coverage');
  const dir = mkdtempSync(path.join(tmpdir(), 'kar-coverage-'));
  const out = path.join(dir, 'coverage');
  const args = [
    '--image', path.join(exampleDir, 'knowledge.knolo'),
    '--graph', path.join(exampleDir, 'knowledge.kar.json'),
    '--plan', path.join(exampleDir, 'met.json'),
    '--query', 'What evidence shows the valve is closed?',
    '--plan', path.join(exampleDir, 'gap.json'),
    '--query', 'What evidence shows the missing permit?',
    '--out', out,
  ];
  try {
    const first = run(['kar', 'coverage', 'build', ...args]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /Evidence requirements not satisfied/);
    assert.match(first.stdout, /Evidence requirements satisfied/);
    const verified = run(['kar', 'coverage', 'verify', out]);
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    assert.equal(verified.stdout.trim(), 'VERIFIED');
    const domainOut = path.join(dir, 'domain');
    const domainBuild = run(['kar', 'coverage', 'build',
      '--image', path.join(exampleDir, 'knowledge.knolo'),
      '--graph', path.join(exampleDir, 'knowledge.kar.json'),
      '--domain', path.join(repo, 'domains', 'contracts-v4'),
      '--template', 'support-only',
      '--query', 'May this agreement terminate?',
      '--out', domainOut,
    ]);
    assert.equal(domainBuild.status, 0, domainBuild.stderr || domainBuild.stdout);
    const domainVerify = run(['kar', 'coverage', 'verify', domainOut, '--domain', path.join(repo, 'domains', 'contracts-v4')]);
    assert.equal(domainVerify.status, 0, domainVerify.stderr || domainVerify.stdout);
    assert.equal(domainVerify.stdout.trim(), 'VERIFIED');
    const refused = run(['kar', 'coverage', 'build', ...args]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to overwrite/);
    const renderingPath = path.join(out, 'coverage.md');
    const rendering = readFileSync(renderingPath, 'utf8').replace('Evidence requirements satisfied', 'Claim proven');
    writeFileSync(renderingPath, rendering);
    const failed = run(['kar', 'coverage', 'verify', out]);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout, /KAR_RESULT_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('kar benchmark annotation stays blind and rejects model humans', () => {
  const help = run(['kar', 'benchmark', '--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /benchmark annotate/);
  const dir = mkdtempSync(path.join(tmpdir(), 'kar-benchmark-'));
  const packet = {
    format: 'kar-annotation-packet-1',
    documentId: 'guide-example',
    domain: 'contracts',
    source: { title: 'Guide example', family: 'example', license: 'guide' },
    blocks: [
      { evidenceId: 'pay', heading: 'Payment', text: 'The customer shall pay the monthly fee.' },
      { evidenceId: 'missing', heading: 'Fees', text: 'Fees are subject to Schedule A.' },
      { evidenceId: 'dated', heading: 'Term', text: 'The agreement is effective 2026-04-01.' },
    ],
  };
  const decisions = {
    items: [
      {
        evidenceId: 'pay',
        action: 'label',
        quote: 'The customer shall pay the monthly fee.',
        relation: 'requires',
        from: 'agreement',
        fromKind: 'agreement',
        to: 'pay-fee',
        toKind: 'payment',
        requirements: ['payment-duty'],
      },
      { evidenceId: 'missing', action: 'incomplete', quote: 'Fees are subject to Schedule A.' },
      {
        evidenceId: 'dated',
        action: 'label',
        quote: 'The agreement is effective 2026-04-01.',
        relation: 'valid_after',
        from: 'agreement',
        fromKind: 'agreement',
        to: 'effective-date',
        toKind: 'effective-date',
        requirements: ['temporal-bound'],
        validFrom: '2026-04-01',
      },
    ],
  };
  const packetPath = path.join(dir, 'packet.json');
  const decisionsPath = path.join(dir, 'decisions.json');
  const out = path.join(dir, 'pass-a.json');
  writeFileSync(packetPath, JSON.stringify(packet));
  writeFileSync(decisionsPath, JSON.stringify(decisions));
  try {
    const labeled = run([
      'kar', 'benchmark', 'annotate',
      '--packet', packetPath,
      '--decisions', decisionsPath,
      '--out', out,
      '--role', 'human',
      '--reviewer-id', 'reviewer-a',
    ]);
    assert.equal(labeled.status, 0, labeled.stderr || labeled.stdout);
    const pass = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(pass.human, true);
    assert.equal(pass.blind, true);
    assert.equal(pass.sawProducerOutput, false);
    assert.equal(pass.items.length, 2);
    assert.equal(pass.items[1].validFrom, '2026-04-01');
    assert.equal(pass.incomplete[0].code, 'INCOMPLETE_REFERENCE');

    const invented = run([
      'kar', 'benchmark', 'annotate',
      '--packet', packetPath,
      '--decisions', decisionsPath,
      '--out', path.join(dir, 'bad-date.json'),
      '--role', 'human',
      '--reviewer-id', 'reviewer-a',
      '--proposals', 'proposals.json',
    ]);
    assert.notEqual(invented.status, 0);
    assert.match(invented.stderr, /Refusing --proposals/);

    const model = run([
      'kar', 'benchmark', 'annotate',
      '--packet', packetPath,
      '--decisions', decisionsPath,
      '--out', path.join(dir, 'model.json'),
      '--role', 'human',
      '--reviewer-id', 'llama3.1:latest',
    ]);
    assert.notEqual(model.status, 0);
    assert.match(model.stderr, /model-assistant/);

    const otherDecisions = {
      items: [
        {
          evidenceId: 'pay',
          action: 'label',
          quote: 'The customer shall pay the monthly fee.',
          relation: 'requires',
          from: 'agreement',
          fromKind: 'agreement',
          to: 'pay-monthly-fee',
          toKind: 'payment',
          requirements: ['payment-duty'],
        },
        {
          evidenceId: 'dated',
          action: 'label',
          quote: 'The agreement is effective 2026-04-01.',
          relation: 'valid_after',
          from: 'agreement',
          fromKind: 'agreement',
          to: 'effective-date',
          toKind: 'effective-date',
          requirements: ['temporal-bound'],
          validFrom: '2026-04-01',
        },
      ],
    };
    const otherPath = path.join(dir, 'decisions-b.json');
    const passB = path.join(dir, 'pass-b.json');
    writeFileSync(otherPath, JSON.stringify(otherDecisions));
    const second = run([
      'kar', 'benchmark', 'annotate',
      '--packet', packetPath,
      '--decisions', otherPath,
      '--out', passB,
      '--role', 'domain-expert',
      '--reviewer-id', 'reviewer-b',
    ]);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const compared = run(['kar', 'benchmark', 'agreement', '--a', out, '--b', passB, '--json']);
    assert.equal(compared.status, 0, compared.stderr || compared.stdout);
    const report = JSON.parse(compared.stdout);
    assert.equal(report.relation.agreement, 1);
    assert.equal(report.conceptKind.agreement, 1);
    assert.ok(Math.abs(report.strictEndpoint.agreement - (1 / 3)) < 1e-12);
    assert.equal(report.gates.stable, true);

    const prose = {
      items: [{
        evidenceId: 'dated',
        action: 'label',
        quote: 'The agreement is effective 2026-04-01.',
        relation: 'valid_after',
        from: 'agreement',
        fromKind: 'agreement',
        to: 'effective-date',
        toKind: 'effective-date',
        requirements: ['temporal-bound'],
        validFrom: '2020-07-01',
      }],
    };
    writeFileSync(path.join(dir, 'prose.json'), JSON.stringify(prose));
    const normalized = run([
      'kar', 'benchmark', 'annotate',
      '--packet', packetPath,
      '--decisions', path.join(dir, 'prose.json'),
      '--out', path.join(dir, 'prose-out.json'),
      '--role', 'human',
      '--reviewer-id', 'reviewer-a',
    ]);
    assert.notEqual(normalized.status, 0);
    assert.match(normalized.stderr, /validFrom/);

    const goldDecisions = {
      items: [{
        evidenceId: 'pay',
        quote: 'The customer shall pay the monthly fee.',
        relation: 'requires',
        from: 'agreement',
        fromKind: 'agreement',
        to: 'pay-fee',
        toKind: 'payment',
        requirements: ['payment-duty'],
      }],
    };
    writeFileSync(path.join(dir, 'gold-decisions.json'), JSON.stringify(goldDecisions));
    const machine = run([
      'kar', 'benchmark', 'adjudicate',
      '--packet', packetPath,
      '--a', out,
      '--b', passB,
      '--decisions', path.join(dir, 'gold-decisions.json'),
      '--out', path.join(dir, 'gold.json'),
      '--role', 'model-assistant',
      '--reviewer-id', 'openchat:latest',
    ]);
    assert.equal(machine.status, 0, machine.stderr || machine.stdout);
    const gold = JSON.parse(readFileSync(path.join(dir, 'gold.json'), 'utf8'));
    assert.equal(gold.humanAdjudicator, false);
    assert.equal(gold.releaseGold, false);
    assert.equal(gold.items[0].quote, 'The customer shall pay the monthly fee.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('version, demo, and conformance', () => {
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /@knolo\/cli 6\.2\.0(?!-)/);
  assert.match(version.stdout, /@knolo\/core 6\.2\.0(?!-)/);
  const conformance = run(['kar', 'conformance']);
  assert.equal(conformance.status, 0, conformance.stderr || conformance.stdout);
  assert.match(conformance.stdout, /support SATISFIED/);
  assert.match(conformance.stdout, /abstention UNSATISFIED_EVIDENCE_REQUIREMENTS/);
  assert.match(conformance.stdout, /tamper-rejection KAR_RESULT_MISMATCH/);
  const demo = run(['kar', 'demo']);
  assert.equal(demo.status, 0, demo.stderr || demo.stdout);
  assert.match(demo.stdout, /contracts SATISFIED support\+opposition/);
  assert.match(demo.stdout, /policy SATISFIED rule\+exception/);
  assert.match(demo.stdout, /operations UNSATISFIED_EVIDENCE_REQUIREMENTS missing-permit/);
  assert.match(demo.stdout, /VERIFIED/);
});
