import assert from 'node:assert/strict';
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
import { createKnowledgeImageV5 } from '../../core/dist/index.js';
import {
  askCortex,
  createCortexSession,
} from '../../core/dist/cortex/index.js';

const cliPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bin/knolo.mjs'
);

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
  assert.match(help.stdout, /does not mean a claim is proven/);
  assert.doesNotMatch(help.stdout, /Claim proven/);
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
