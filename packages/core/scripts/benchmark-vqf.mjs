import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  buildPack,
  mountPack,
  query,
  migrateV4ToV5,
  mountKnowledgeImageV5,
  createKnowledgeQueryIndexV5,
  serializeKnowledgeQueryIndexV1,
  queryKnowledgeImageV5,
} from '../dist/index.js';
import { inspectPackV4 } from '../dist/pack.v4.js';

const script = fileURLToPath(import.meta.url);
const execute = promisify(execFile);
const root = path.resolve(path.dirname(script), '../../..');
const hash = (bytes) =>
  `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const json = (value) => JSON.stringify(value);
const corpora = ['low-redundancy', 'enterprise', 'repetitive', 'repository'];
// Explicit and stable: do not include benchmark reports or planning documents.
const repositoryFiles = [
  'README.md',
  'docs/V5_COORDINATION.md',
  'docs/V5_HOST_DEPLOYMENT.md',
  'docs/V5_INTEROPERABILITY.md',
  'packages/core/src/indexer.ts',
  'packages/core/src/tokenize.ts',
  'spec/KIP-0001-v5-container.md',
  'spec/KIP-0002-event-ledger.md',
  'spec/KIP-0003-canonical-encoding.md',
  'spec/KIP-0021-query-index-history-v1.md',
].sort();

function integer(value, label, min, max) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error(`Invalid ${label}.`);
  return number;
}

function configuration(args) {
  const result = {
    sizes: [32, 128],
    samples: 20,
    warmup: 3,
    seed: 20260905,
    output: null,
    compare: null,
  };
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!value) throw new Error(`Missing value for ${key}.`);
    if (key === '--sizes')
      result.sizes = value.split(',').map((v) => integer(v, 'size', 1, 10000));
    else if (key === '--samples')
      result.samples = integer(value, 'samples', 2, 10000);
    else if (key === '--warmup')
      result.warmup = integer(value, 'warmup', 0, 1000);
    else if (key === '--seed')
      result.seed = integer(value, 'seed', 1, 0xffffffff);
    else if (key === '--output') result.output = path.resolve(value);
    else if (key === '--compare') result.compare = path.resolve(value);
    else throw new Error(`Unknown option ${key}.`);
  }
  if (new Set(result.sizes).size !== result.sizes.length)
    throw new Error('Duplicate sizes.');
  return result;
}

function corpus(name, count, seed) {
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const manifest = repositoryFiles.map((file) => {
    const bytes = readFileSync(path.join(root, file));
    return { path: file, bytes: bytes.length, digest: hash(bytes) };
  });
  const fragments =
    name === 'repository'
      ? repositoryFiles.flatMap((file) => {
          // Code-point chunks preserve Unicode; source files are never modified.
          const points = Array.from(
            readFileSync(path.join(root, file), 'utf8')
          );
          return Array.from(
            { length: Math.ceil(points.length / 2048) },
            (_, i) => ({
              text: points.slice(i * 2048, (i + 1) * 2048).join(''),
              file,
              fragment: i,
            })
          );
        })
      : [];
  const docs = Array.from({ length: count }, (_, i) => {
    let text;
    if (name === 'low-redundancy') {
      text = Array.from({ length: 96 }, () => `w${random().toString(36)}`).join(
        ' '
      );
      if (i === 0) text += ' café 東京 verifiable knowledge runtime';
    } else if (name === 'enterprise') {
      const topic = ['access', 'retention', 'audit', 'incident'][i % 4];
      text =
        `Policy ${i}: ${topic}. The verifiable knowledge runtime preserves evidence. ` +
        `Local first operation requires policy authorization. Team ${i % 7} owns procedure ${random() % 1000}. ` +
        `Review ${topic} records before approval. Record the source and revision. `.repeat(
          6
        ) +
        'Unicode evidence: café 東京. Policy policy review.';
    } else if (name === 'repetitive') {
      text =
        `Contract revision ${i % 4}. ` +
        'The verifiable knowledge runtime supports local first evidence and policy authorization. '.repeat(
          12
        ) +
        'Policy policy review. Unicode evidence: café 東京.';
    } else {
      text = fragments[i % fragments.length].text;
    }
    return {
      id: `doc-${i}`,
      heading: `${name} ${i}`,
      namespace: `team-${i % 3}`,
      text,
    };
  });
  return {
    docs,
    digest: hash(json(docs)),
    sourceBytes: docs.reduce((n, doc) => n + Buffer.byteLength(doc.text), 0),
    repositoryManifest: name === 'repository' ? manifest : [],
    repositorySelection:
      name === 'repository'
        ? docs.map((_, i) => {
            const { file, fragment } = fragments[i % fragments.length];
            return { file, fragment, cycle: Math.floor(i / fragments.length) };
          })
        : [],
  };
}

function roots(image) {
  return {
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    objectRoot: image.commit.objectRoot,
    eventRoot: image.commit.eventRoot,
    objects: image.objects.length,
    events: image.events.length,
  };
}

async function measure(fn, options) {
  for (let i = 0; i < options.warmup; i++) await fn();
  const samplesMs = [];
  for (let i = 0; i < options.samples; i++) {
    const start = performance.now();
    await fn();
    samplesMs.push(performance.now() - start);
  }
  const ordered = [...samplesMs].sort((a, b) => a - b);
  const percentile = (p) => ordered[Math.ceil(p * ordered.length) - 1];
  return {
    samplesMs,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

async function worker(options) {
  const input = corpus(options.corpus, options.size, options.seed);
  const buildOptions = { format: 4, graph: { enabled: false } };
  let start = performance.now();
  const bytes = await buildPack(input.docs, buildOptions);
  const buildMs = performance.now() - start;
  assert.deepEqual(
    await buildPack(input.docs, buildOptions),
    bytes,
    'Nondeterministic V4 build'
  );
  const pack = await mountPack({ src: bytes });
  const sections = inspectPackV4(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  ).sections;
  start = performance.now();
  const migrated = await migrateV4ToV5(bytes);
  const migrationMs = performance.now() - start;
  assert.deepEqual(
    (await migrateV4ToV5(bytes)).image,
    migrated.image,
    'Nondeterministic V5 migration'
  );
  const image = mountKnowledgeImageV5(migrated.image);
  start = performance.now();
  const index = createKnowledgeQueryIndexV5(image);
  const indexBuildMs = performance.now() - start;
  const indexBytes = serializeKnowledgeQueryIndexV1(index);
  const lexicalCases = [
    { q: 'verifiable knowledge' },
    { q: '"verifiable knowledge runtime"' },
    { q: '"local first"' },
    { q: '"policy authorization"' },
    { q: 'policy policy' },
    { q: 'café 東京' },
    { q: 'zzvqfmissingtermzz' },
    { q: 'policy', namespace: 'team-1' },
    { q: 'knowledge', expansion: true },
    { q: input.docs[0].text.split(/\s+/u)[0], source: 'doc-0' },
  ];
  const lexical = [];
  for (const entry of lexicalCases) {
    const queryOptions = {
      topK: 5,
      queryExpansion: { enabled: entry.expansion === true },
      ...(entry.namespace ? { namespace: entry.namespace } : {}),
      ...(entry.source ? { source: entry.source } : {}),
    };
    const hits = query(pack, entry.q, queryOptions);
    assert.deepEqual(query(pack, entry.q, queryOptions), hits);
    const latency = await measure(
      () => query(pack, entry.q, queryOptions),
      options
    );
    lexical.push({ query: entry.q, options: queryOptions, hits, latency });
  }
  const eql = [];
  for (const expression of [
    'FROM chunk LIMIT 5',
    'FROM * WHERE meta.namespace = "team-1" ORDER BY id ASC LIMIT 5',
    'FROM source SEARCH "verifiable knowledge" LIMIT 5',
    'FROM chunk SEARCH "café 東京" LIMIT 5',
    'FROM * SEARCH "zzvqfmissingtermzz" LIMIT 5',
  ]) {
    const result = queryKnowledgeImageV5(image, expression);
    assert.deepEqual(
      queryKnowledgeImageV5(image, expression, index),
      result,
      'Indexed EQL differs from scan'
    );
    eql.push({
      expression,
      result,
      scanLatency: await measure(
        () => queryKnowledgeImageV5(image, expression),
        options
      ),
      indexedLatency: await measure(
        () => queryKnowledgeImageV5(image, expression, index),
        options
      ),
    });
  }
  const mountV4 = await measure(() => mountPack({ src: bytes }), options);
  const mountV5 = await measure(
    () => mountKnowledgeImageV5(migrated.image),
    options
  );
  const logicalBytes = image.segments.reduce(
    (n, segment) => n + segment.payloadLength,
    0
  );
  return {
    corpus: options.corpus,
    documents: options.size,
    corpusDigest: input.digest,
    sourceBytes: input.sourceBytes,
    repositoryManifest: input.repositoryManifest,
    repositorySelection: input.repositorySelection,
    artifact: {
      v4Bytes: bytes.length,
      v4Digest: hash(bytes),
      v4Sections: Object.fromEntries(sections.map((s) => [s.name, s.length])),
      v5Bytes: migrated.image.length,
      v5Digest: hash(migrated.image),
      v5Segments: image.segments.map((s) => ({
        kind: s.kind,
        payloadBytes: s.payloadLength,
        digest: s.digest,
      })),
      queryIndexBytes: indexBytes.length,
      queryIndexDigest: hash(indexBytes),
      indexRoot: index.indexRoot,
      logicalSegmentBytes: logicalBytes,
      physicalSegmentPayloadBytes: logicalBytes,
      compressionRatio: 1,
      reduction: 0,
      codec: 'none',
      semanticBytes: 0,
    },
    roots: roots(image),
    lexical,
    eql,
    timing: { buildMs, migrationMs, indexBuildMs, mountV4, mountV5 },
    memory: {
      peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
      final: process.memoryUsage(),
    },
    compressionMs: null,
    decompressionMs: null,
    bytesDecodedPerQuery: null,
    postingStreamsVisited: null,
    microblocksRead: null,
  };
}

function identity(report) {
  return {
    schemaVersion: report.schemaVersion,
    corpusVersion: report.corpusVersion,
    seed: report.configuration.seed,
    sizes: report.configuration.sizes,
    fixtures: report.fixtures,
    cases: report.cases.map((entry) => ({
      corpus: entry.corpus,
      documents: entry.documents,
      corpusDigest: entry.corpusDigest,
      repositoryManifest: entry.repositoryManifest,
      repositorySelection: entry.repositorySelection,
      artifact: entry.artifact,
      roots: entry.roots,
      lexical: entry.lexical.map(({ latency, ...result }) => result),
      eql: entry.eql.map(
        ({ scanLatency, indexedLatency, ...result }) => result
      ),
    })),
  };
}

if (process.argv[2] === '--worker') {
  const output = json(await worker(JSON.parse(process.argv[3])));
  if (process.argv[4]) writeFileSync(process.argv[4], output, { flag: 'wx' });
  else process.stdout.write(output);
} else if (process.argv.includes('--help')) {
  console.log(
    'node packages/core/scripts/benchmark-vqf.mjs [--sizes 32,128] [--samples 20] [--warmup 3] [--seed 20260905] [--output report.json] [--compare baseline.json]'
  );
} else {
  const config = configuration(process.argv.slice(2));
  const git = async (...args) =>
    (await execute('git', args, { cwd: root, encoding: 'utf8' })).stdout.trim();
  const fixtures = [
    'knowledge-image-v5',
    'migrated-legacy-v3',
    'migrated-v4-claims-agents',
    'transaction-snapshot',
  ].map((name) => {
    const file = `conformance/v5/${name}.fixture.base64`;
    const bytes = Buffer.from(
      readFileSync(path.join(root, file), 'utf8').trim(),
      'base64'
    );
    return {
      file,
      bytes: bytes.length,
      digest: hash(bytes),
      ...roots(mountKnowledgeImageV5(bytes)),
    };
  });
  const report = {
    schemaVersion: 1,
    corpusVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      revision: await git('rev-parse', 'HEAD'),
      trackedDirty: Boolean(await git('diff', 'HEAD', '--name-only')),
      harnessDigest: hash(readFileSync(script)),
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    configuration: {
      sizes: config.sizes,
      samples: config.samples,
      warmup: config.warmup,
      seed: config.seed,
    },
    methodology: {
      workers:
        'One sequential fresh process per corpus/size; imports, builds, validation and queries included in peak RSS.',
      query:
        'V4 mounted pack; V5 public EQL API includes remount and index revalidation on each call.',
      clock:
        'performance.now milliseconds; nearest-rank percentiles; build/migration/index build are single cold observations.',
      scope:
        'Lexical-only: graph disabled, no embeddings; V5 produced by migration; repository fragments cycle at larger sizes.',
      unavailable:
        'No codec or instrumentation yet: compression/decompression time and decode/stream counters are null.',
    },
    fixtures,
    cases: [],
  };
  for (const name of corpora)
    for (const size of config.sizes) {
      console.error(`Benchmark ${name}: ${size} documents`);
      const temporary = mkdtempSync(
        path.join(os.tmpdir(), 'knolo-vqf-worker-')
      );
      try {
        const resultPath = path.join(temporary, 'result.json');
        await execute(
          process.execPath,
          [
            script,
            '--worker',
            json({ ...config, corpus: name, size }),
            resultPath,
          ],
          {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
          }
        );
        report.cases.push(JSON.parse(readFileSync(resultPath, 'utf8')));
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  if (config.compare) {
    assert.deepEqual(
      identity(report),
      identity(JSON.parse(readFileSync(config.compare, 'utf8'))),
      'Baseline identity changed'
    );
    console.error(
      'Exact corpus, artifact, root and query-result baseline comparison passed.'
    );
  }
  const output = JSON.stringify(report, null, 2) + '\n';
  if (config.output) {
    mkdirSync(path.dirname(config.output), { recursive: true });
    writeFileSync(config.output, output, { flag: 'wx' });
    console.error(`Saved ${config.output}`);
  } else process.stdout.write(output);
}
