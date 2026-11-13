import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompositionRecord } from '../../packages/core/dist/composition/index.js';
import {
  askCortex,
  createCortexSession,
} from '../../packages/core/dist/cortex/index.js';
import { mountKnowledgeImageV5 } from '../../packages/core/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const cli = path.join(repo, 'packages/cli/bin/knolo.mjs');
const contracts = path.join(repo, 'examples/kar-v6/contracts');

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      result.stderr || result.stdout || `knolo ${args[0]} failed`
    );
  }
  return result.stdout ?? '';
}

function sha256(bytes) {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

const dir = mkdtempSync(path.join(tmpdir(), 'knolo-research-pack-'));
try {
  writeFileSync(
    path.join(dir, 'notes.md'),
    readFileSync(path.join(here, 'sources/notes.md'))
  );
  writeFileSync(
    path.join(dir, 'policy.md'),
    readFileSync(path.join(here, 'sources/policy.md'))
  );
  run(
    [
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
      'plain.knolo',
      '--json',
    ],
    dir
  );

  const citeBytes = readFileSync(path.join(contracts, 'knowledge.knolo'));
  const graphBytes = readFileSync(path.join(contracts, 'knowledge.kar.json'));
  writeFileSync(path.join(dir, 'cite.knolo'), citeBytes);
  writeFileSync(path.join(dir, 'knowledge.kar.json'), graphBytes);
  const session = await createCortexSession({
    image: citeBytes,
    graph: JSON.parse(graphBytes.toString('utf8')),
    plan: JSON.parse(readFileSync(path.join(contracts, 'plan.json'), 'utf8')),
  });
  const trace = await askCortex(session, {
    question: 'What evidence bears on customer cancellation?',
    mode: 'prove_or_abstain',
  });
  writeFileSync(
    path.join(dir, 'answer.cortex.json'),
    `${JSON.stringify(trace, null, 2)}\n`
  );
  run(
    [
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
      '--graph',
      'knowledge.kar.json',
      '--out',
      'cited.knolo',
      '--json',
    ],
    dir
  );

  const packed = readFileSync(path.join(dir, 'cited.knolo'));
  const mounted = mountKnowledgeImageV5(packed);
  const composition = mounted.objects.find(
    (object) => object.meta?.role === 'composition'
  );
  const graph = mounted.objects.find(
    (object) => object.meta?.role === 'kar-graph'
  );
  if (!composition || !graph)
    throw new Error('Cited pack is missing composition or graph.');
  const cited = mountKnowledgeImageV5(citeBytes);
  const expected = createCompositionRecord({
    host: { kind: 'none' },
    availability: 'digest',
    members: [
      {
        alias: 'cite',
        kind: 'v5-image',
        stateRoot: cited.stateRoot,
        objectRoot: cited.commit.objectRoot,
        commitDigest: cited.commitDigest,
        sha256: sha256(citeBytes),
      },
    ],
  });
  if (composition.meta.compositionRoot !== expected.compositionRoot) {
    throw new Error('compositionRoot does not match the cited image.');
  }
  if (Buffer.compare(Buffer.from(graph.bytes), graphBytes) !== 0) {
    throw new Error('Stored graph bytes do not match the checked file.');
  }

  const query = JSON.parse(
    run(
      [
        'query',
        'FROM metadata SEARCH "cancellation" LIMIT 5',
        '--pack',
        'cited.knolo',
        '--json',
      ],
      dir
    )
  );
  if (!query.hits?.length) throw new Error('The question was not searchable.');
  const verified = JSON.parse(run(['verify', 'cited.knolo'], dir));
  if (verified.verified !== true)
    throw new Error('knolo verify did not accept the pack.');
  if (existsSync(path.join(dir, 'knolo.lock.json'))) {
    throw new Error('The example wrote knolo.lock.json.');
  }
  console.log(mounted.stateRoot);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
