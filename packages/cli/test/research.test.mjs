import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createKnowledgeImageV5,
  mountKnowledgeImageV5,
} from '../../core/dist/index.js';
import {
  askCortex,
  createCortexSession,
} from '../../core/dist/cortex/index.js';
import { createCompositionRecord } from '../../core/dist/composition/index.js';

const cliPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bin/knolo.mjs'
);

function compositionRootFor(citeBytes) {
  const cited = mountKnowledgeImageV5(citeBytes);
  return createCompositionRecord({
    host: { kind: 'none' },
    availability: 'digest',
    members: [
      {
        alias: 'cite',
        kind: 'v5-image',
        stateRoot: cited.stateRoot,
        objectRoot: cited.commit.objectRoot,
        commitDigest: cited.commitDigest,
        sha256: `sha256-${createHash('sha256').update(citeBytes).digest('hex')}`,
      },
    ],
  }).compositionRoot;
}

function run(args, cwd) {
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

test('research help states the evidence limit', () => {
  const help = run(['research', '--help'], process.cwd());
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /research package/);
  assert.match(help.stdout, /--graph/);
  assert.match(help.stdout, /does not mean a claim is proven/);
  assert.doesNotMatch(help.stdout, /Claim proven/);
  const packageHelp = run(['research', 'package', '--help'], process.cwd());
  assert.equal(packageHelp.status, 0, packageHelp.stderr);
  assert.match(packageHelp.stdout, /--graph/);
});

test('package is byte-identical, refuses overwrite, and the question is searchable', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-research-'));
  try {
    writeFileSync(
      path.join(dir, 'notes.md'),
      'Valve inspection passed on Monday.\n'
    );
    writeFileSync(
      path.join(dir, 'policy.md'),
      'Annual enterprise refunds are recorded in the notes.\n'
    );
    const args = [
      'research',
      'package',
      '--question',
      'Annual enterprise refunds are available within 30 days.',
      '--agent',
      'reviewer',
      '--source',
      'notes.md',
      '--source',
      'policy.md',
      '--out',
      'a.knolo',
      '--json',
    ];
    const first = run(args, dir);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const second = run(
      args
        .map((part) => (part === 'a.knolo' ? 'b.knolo' : part))
        .filter((part) => part !== '--json'),
      dir
    );
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(
      Buffer.compare(
        readFileSync(path.join(dir, 'a.knolo')),
        readFileSync(path.join(dir, 'b.knolo'))
      ),
      0
    );
    const printed = JSON.parse(first.stdout);
    assert.equal(printed.ok, true);
    assert.equal(printed.sources, 2);
    assert.equal(printed.traceRoot, null);
    assert.match(printed.stateRoot, /^sha256-[0-9a-f]{64}$/);
    const again = run(
      args.filter((part) => part !== '--json'),
      dir
    );
    assert.equal(again.status, 1);
    assert.match(again.stderr, /Refusing to overwrite/);
    const query = run(
      [
        'query',
        'FROM metadata SEARCH "refunds" LIMIT 5',
        '--pack',
        'a.knolo',
        '--json',
      ],
      dir
    );
    assert.equal(query.status, 0, query.stderr || query.stdout);
    const hits = JSON.parse(query.stdout).hits;
    assert.ok(hits.length >= 1);
    assert.match(hits[0].snippet, /refunds/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing source writes nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-research-missing-'));
  try {
    const refused = run(
      [
        'research',
        'package',
        '--question',
        'Where is the note?',
        '--agent',
        'reviewer',
        '--source',
        'missing.md',
        '--out',
        'out.knolo',
      ],
      dir
    );
    assert.equal(refused.status, 1);
    assert.equal(existsSync(path.join(dir, 'out.knolo')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tampered trace writes nothing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-research-trace-'));
  try {
    writeFileSync(
      path.join(dir, 'notes.md'),
      'Alpha inspection of the valve passed on Monday.\n'
    );
    const cited = createKnowledgeImageV5({
      actor: 'knolo-research',
      sequence: 1,
      objects: [
        {
          kind: 'chunk',
          bytes: Buffer.from(
            'Alpha inspection of the valve passed on Monday.\n'
          ),
          meta: { source: 'notes.md' },
        },
      ],
    });
    writeFileSync(path.join(dir, 'cite.knolo'), cited.bytes);
    const session = await createCortexSession({ image: cited.bytes });
    const trace = await askCortex(session, {
      question: 'valve inspection',
      mode: 'find_relevant',
    });
    writeFileSync(
      path.join(dir, 'answer.cortex.json'),
      `${JSON.stringify(trace, null, 2)}\n`
    );
    const packed = run(
      [
        'research',
        'package',
        '--question',
        'What did the inspection find?',
        '--agent',
        'reviewer',
        '--source',
        'notes.md',
        '--cite',
        'cite.knolo',
        '--trace',
        'answer.cortex.json',
        '--out',
        'good.knolo',
        '--json',
      ],
      dir
    );
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const printed = JSON.parse(packed.stdout);
    assert.equal(printed.traceRoot, trace.receipt.traceRoot);
    const mounted = mountKnowledgeImageV5(
      readFileSync(path.join(dir, 'good.knolo'))
    );
    const packedTrace = mounted.objects.find(
      (object) => object.meta && object.meta.role === 'cortex-trace'
    );
    assert.ok(packedTrace);
    assert.equal(
      Buffer.compare(
        Buffer.from(packedTrace.bytes),
        readFileSync(path.join(dir, 'answer.cortex.json'))
      ),
      0
    );
    const composition = mounted.objects.find(
      (object) => object.meta && object.meta.role === 'composition'
    );
    assert.ok(composition);
    assert.equal(
      composition.meta.compositionRoot,
      compositionRootFor(readFileSync(path.join(dir, 'cite.knolo')))
    );
    assert.equal(composition.meta.citedStateRoot, cited.stateRoot);
    assert.equal(composition.meta.traceRoot, trace.receipt.traceRoot);
    assert.equal(
      mounted.objects.some(
        (object) => object.meta && object.meta.role === 'kar-graph'
      ),
      false
    );
    const repeated = run(
      [
        'research',
        'package',
        '--question',
        'What did the inspection find?',
        '--agent',
        'reviewer',
        '--source',
        'notes.md',
        '--cite',
        'cite.knolo',
        '--trace',
        'answer.cortex.json',
        '--out',
        'again.knolo',
      ],
      dir
    );
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    assert.equal(
      Buffer.compare(
        readFileSync(path.join(dir, 'good.knolo')),
        readFileSync(path.join(dir, 'again.knolo'))
      ),
      0
    );
    const flipped = Buffer.from(readFileSync(path.join(dir, 'cite.knolo')));
    flipped[flipped.length - 1] ^= 0xff;
    writeFileSync(path.join(dir, 'flipped.knolo'), flipped);
    const flippedPack = run(
      [
        'research',
        'package',
        '--question',
        'What did the inspection find?',
        '--agent',
        'reviewer',
        '--source',
        'notes.md',
        '--cite',
        'flipped.knolo',
        '--trace',
        'answer.cortex.json',
        '--out',
        'flipped-out.knolo',
      ],
      dir
    );
    assert.equal(flippedPack.status, 1);
    assert.equal(existsSync(path.join(dir, 'flipped-out.knolo')), false);
    const tampered = {
      ...trace,
      answer: { ...trace.answer, text: 'invented' },
    };
    writeFileSync(
      path.join(dir, 'bad.cortex.json'),
      `${JSON.stringify(tampered, null, 2)}\n`
    );
    const refused = run(
      [
        'research',
        'package',
        '--question',
        'What did the inspection find?',
        '--agent',
        'reviewer',
        '--source',
        'notes.md',
        '--cite',
        'cite.knolo',
        '--trace',
        'bad.cortex.json',
        '--out',
        'bad.knolo',
      ],
      dir
    );
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /CORTEX_/);
    assert.equal(existsSync(path.join(dir, 'bad.knolo')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a KAR trace packages only with the graph that verified it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-research-kar-'));
  try {
    const example = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../examples/kar-v6/contracts'
    );
    const image = readFileSync(path.join(example, 'knowledge.knolo'));
    const graph = JSON.parse(
      readFileSync(path.join(example, 'knowledge.kar.json'), 'utf8')
    );
    const plan = JSON.parse(
      readFileSync(path.join(example, 'plan.json'), 'utf8')
    );
    writeFileSync(path.join(dir, 'cite.knolo'), image);
    writeFileSync(
      path.join(dir, 'knowledge.kar.json'),
      readFileSync(path.join(example, 'knowledge.kar.json'))
    );
    writeFileSync(
      path.join(dir, 'notes.md'),
      'Customer cancellation evidence.\n'
    );
    const session = await createCortexSession({ image, graph, plan });
    const trace = await askCortex(session, {
      question: 'What evidence bears on customer cancellation?',
      mode: 'prove_or_abstain',
    });
    assert.equal(trace.karEvaluations?.[0]?.status, 'SATISFIED');
    writeFileSync(
      path.join(dir, 'answer.cortex.json'),
      `${JSON.stringify(trace, null, 2)}\n`
    );
    const args = [
      'research',
      'package',
      '--question',
      'What evidence bears on customer cancellation?',
      '--agent',
      'reviewer',
      '--source',
      'notes.md',
      '--cite',
      'cite.knolo',
      '--trace',
      'answer.cortex.json',
    ];
    const loneGraph = run(
      [
        ...args.slice(0, 8),
        '--graph',
        'knowledge.kar.json',
        '--out',
        'lone.knolo',
      ],
      dir
    );
    assert.equal(loneGraph.status, 1);
    assert.match(loneGraph.stderr, /--graph requires --cite and --trace/);
    assert.equal(existsSync(path.join(dir, 'lone.knolo')), false);
    const missing = run([...args, '--out', 'out.knolo', '--json'], dir);
    assert.equal(missing.status, 1, missing.stdout);
    assert.match(missing.stderr, /CORTEX_/);
    assert.equal(existsSync(path.join(dir, 'out.knolo')), false);
    const packed = run(
      [
        ...args,
        '--graph',
        'knowledge.kar.json',
        '--out',
        'out.knolo',
        '--json',
      ],
      dir
    );
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const printed = JSON.parse(packed.stdout);
    assert.equal(printed.traceRoot, trace.receipt.traceRoot);
    const mounted = mountKnowledgeImageV5(
      readFileSync(path.join(dir, 'out.knolo'))
    );
    const graphObject = mounted.objects.find(
      (object) => object.meta && object.meta.role === 'kar-graph'
    );
    assert.ok(graphObject);
    assert.equal(
      Buffer.compare(
        Buffer.from(graphObject.bytes),
        readFileSync(path.join(dir, 'knowledge.kar.json'))
      ),
      0
    );
    const composition = mounted.objects.find(
      (object) => object.meta && object.meta.role === 'composition'
    );
    assert.equal(
      composition.meta.compositionRoot,
      compositionRootFor(readFileSync(path.join(dir, 'cite.knolo')))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
