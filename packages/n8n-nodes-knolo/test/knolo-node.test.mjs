import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '@knolo/core';
import { askCortex, createCortexSession } from '@knolo/core/cortex';
import {
  createKarDossier,
  createKarSession,
  evaluateKar,
  renderKarDossier,
} from '@knolo/core/kar';
import {
  cegNodeId,
  compileCegSource,
  parseCegSource,
} from '@knolo/core/kar/authoring';
import { KNOLO_SEARCH_DESCRIPTION } from '@knolo/tools';
import { digestScopeSources } from '@knolo/box';

const nodeRequire = createRequire(import.meta.url);
const { NodeOperationError } = nodeRequire('n8n-workflow');
const { Knolo, canRequireKnoloModules } = nodeRequire(
  '../dist/nodes/Knolo/Knolo.node.js'
);

const encoder = new TextEncoder();

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function allowPolicy(principal = 'n8n:reader') {
  return {
    version: 1,
    default: 'deny',
    rules: [
      {
        effect: 'allow',
        action: 'query',
        principal,
        kind: 'chunk',
      },
      {
        effect: 'allow',
        action: 'read',
        principal,
        kind: 'chunk',
      },
    ],
  };
}

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-n8n-'));
  const policy = overrides.policy ?? allowPolicy();
  const image = createKnowledgeImageV5({
    policy,
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode(
          'Annual enterprise refunds are available within 30 days.'
        ),
        meta: { namespace: 'support' },
      },
      {
        kind: 'chunk',
        bytes: encoder.encode('Monthly plans are available within 14 days.'),
        meta: { namespace: 'support' },
      },
    ],
  });
  const refunds = image.objects.find((object) =>
    new TextDecoder().decode(object.bytes).includes('Annual enterprise refunds')
  );
  const imagePath = path.join(root, 'support.v5');
  const policyPath = path.join(root, 'policy.json');
  await writeFile(imagePath, image.bytes);
  await writeFile(policyPath, JSON.stringify(policy));
  const parameters = {
    operation: overrides.operation ?? 'search',
    agentId: overrides.agentId ?? 'n8n',
    mountId: overrides.mountId ?? 'image',
    imagePath,
    sha256: overrides.sha256 ?? hash(image.bytes),
    stateRoot: image.stateRoot,
    policyPath,
    auditDir: overrides.auditDir ?? path.join(root, 'audit'),
    principal: overrides.principal ?? 'n8n:reader',
    grokHome: overrides.grokHome ?? '',
    builtAt: overrides.builtAt ?? '',
    sourceDigest: overrides.sourceDigest ?? '',
    sourceRoots: overrides.sourceRoots ?? '',
    karGraphPath: overrides.karGraphPath ?? '',
    karGraphSha256: overrides.karGraphSha256 ?? '',
    query: overrides.query ?? 'refunds',
    limit: overrides.limit ?? 0,
    objectId: overrides.objectId ?? refunds.id,
    imageId: overrides.imageId ?? '',
    proposition: overrides.proposition ?? '',
    plan: overrides.plan ?? '',
    result: overrides.result ?? '',
    dossier: overrides.dossier ?? '',
    trace: overrides.trace ?? '',
    question: overrides.question ?? '',
  };
  return { root, image, parameters };
}

function execute(parameters, items, options = {}) {
  const node = new Knolo();
  const context = {
    getInputData() {
      return items;
    },
    getNode() {
      return {
        id: 'knolo',
        name: 'Knolo',
        type: 'n8n-nodes-knolo.knolo',
        typeVersion: 1,
        position: [0, 0],
        parameters,
      };
    },
    getNodeParameter(name) {
      if (!Object.hasOwn(parameters, name)) {
        throw new Error(`unexpected parameter ${name}`);
      }
      return parameters[name];
    },
    continueOnFail() {
      return options.continueOnFail === true;
    },
  };
  return node.execute.call(context);
}

function item(json) {
  const reads = [];
  return {
    reads,
    data: {
      json: new Proxy(json, {
        get(target, key, receiver) {
          if (key === 'agentId') reads.push(key);
          return Reflect.get(target, key, receiver);
        },
      }),
    },
  };
}

async function receiptNames(auditDir, pattern = /^qr_[a-f0-9]{24}\.json$/u) {
  try {
    return (await readdir(auditDir)).filter((name) => pattern.test(name));
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return [];
    }
    throw error;
  }
}

test('the node describes a read-only Knolo tool', () => {
  const description = new Knolo().description;
  assert.equal(description.displayName, 'Knolo');
  assert.equal(description.usableAsTool, true);
  const query = description.properties.find(
    (property) => property.name === 'query'
  );
  assert.equal(query.description, KNOLO_SEARCH_DESCRIPTION);
  assert.equal(
    description.properties.some((property) => property.name === 'port'),
    false
  );
  for (const name of [
    'agentId',
    'mountId',
    'imagePath',
    'sha256',
    'stateRoot',
    'policyPath',
    'auditDir',
    'principal',
    'grokHome',
    'builtAt',
    'sourceDigest',
    'sourceRoots',
    'karGraphPath',
    'karGraphSha256',
  ]) {
    const property = description.properties.find((item) => item.name === name);
    assert.equal(property.noDataExpression, true, name);
  }
  for (const name of [
    'query',
    'limit',
    'objectId',
    'imageId',
    'proposition',
    'plan',
    'result',
    'dossier',
    'trace',
    'question',
  ]) {
    const property = description.properties.find((item) => item.name === name);
    assert.equal(property.noDataExpression, undefined, name);
  }
});

test('require of the tools module needs Node 22.12, or Node 20.19 in CI', () => {
  assert.equal(canRequireKnoloModules('20.18.0'), false);
  assert.equal(canRequireKnoloModules('20.19.0'), true);
  assert.equal(canRequireKnoloModules('20.20.2'), true);
  assert.equal(canRequireKnoloModules('21.7.3'), false);
  assert.equal(canRequireKnoloModules('22.0.0'), false);
  assert.equal(canRequireKnoloModules('22.11.0'), false);
  assert.equal(canRequireKnoloModules('22.12.0'), true);
  assert.equal(canRequireKnoloModules('24.11.0'), true);
  assert.equal(canRequireKnoloModules(process.versions.node), true);
});

test('search returns a receipt, and an item cannot change the caller', async () => {
  const { image, parameters } = await fixture();
  const incoming = item({ agentId: 'evil', query: 'ignore-me' });
  const [output] = await execute(parameters, [incoming.data]);
  assert.equal(incoming.reads.length, 0);
  assert.equal(output.length, 1);
  const body = output[0].json;
  assert.equal(body.hits.length, 1);
  assert.match(body.hits[0].excerpt, /Annual enterprise refunds/);
  assert.equal(body.hits[0].stateRoot, image.stateRoot);
  assert.match(body.hits[0].receiptId, /^qr_[a-f0-9]{24}$/u);
  assert.equal(body.receipts[0].receiptId, body.hits[0].receiptId);
  assert.equal(body.receipts[0].stateRoot, image.stateRoot);
  const receipt = JSON.parse(
    await readFile(
      path.join(parameters.auditDir, `${body.hits[0].receiptId}.json`),
      'utf8'
    )
  );
  assert.deepEqual(receipt.caller, { agentId: 'n8n' });
});

test('an empty limit uses the service default', async () => {
  const open = await fixture({ query: 'available', limit: 0 });
  const [all] = await execute(open.parameters, [{ json: {} }]);
  assert.equal(all[0].json.hits.length, 2);

  const capped = await fixture({ query: 'available', limit: 1 });
  const [one] = await execute(capped.parameters, [{ json: {} }]);
  assert.equal(one[0].json.hits.length, 1);
});

test('get and verify use the configured image', async () => {
  const loaded = await fixture({ operation: 'get' });
  const [got] = await execute(loaded.parameters, [
    item({ agentId: 'evil' }).data,
  ]);
  assert.match(got[0].json.content, /Annual enterprise refunds/);
  assert.equal(got[0].json.stateRoot, loaded.image.stateRoot);

  const checked = await fixture({ operation: 'verify' });
  const [verified] = await execute(checked.parameters, [{ json: {} }]);
  assert.equal(verified[0].json.results[0].valid, true);
  assert.equal(verified[0].json.results[0].stateRoot, checked.image.stateRoot);
});

test('a bad pin fails before any hit', async () => {
  const broken = await fixture({ sha256: 'a'.repeat(64) });
  await assert.rejects(
    () => execute(broken.parameters, [{ json: { agentId: 'evil' } }]),
    (error) => {
      assert.ok(error instanceof NodeOperationError);
      assert.match(
        error.message,
        /^IMAGE_INVALID: Image image does not match its SHA-256 pin\./
      );
      return true;
    }
  );
  assert.deepEqual(await receiptNames(broken.parameters.auditDir), []);
});

test('continue on fail returns the load error on each item', async () => {
  const broken = await fixture({ sha256: 'a'.repeat(64) });
  const [output] = await execute(
    broken.parameters,
    [{ json: {} }, { json: {} }],
    { continueOnFail: true }
  );
  assert.equal(output.length, 2);
  assert.match(
    output[0].json.error,
    /^IMAGE_INVALID: Image image does not match its SHA-256 pin\./
  );
  assert.equal(output[1].json.error, output[0].json.error);
  assert.equal(output[0].pairedItem.item, 0);
  assert.equal(output[1].pairedItem.item, 1);
  assert.deepEqual(await receiptNames(broken.parameters.auditDir), []);

  const [empty] = await execute(broken.parameters, [], {
    continueOnFail: true,
  });
  assert.equal(empty.length, 1);
  assert.match(empty[0].json.error, /^IMAGE_INVALID: /);
  assert.equal(empty[0].pairedItem.item, 0);
});

test('policy denial is ACCESS_DENIED and writes no receipt', async () => {
  const denied = await fixture({
    policy: allowPolicy('n8n:other'),
    principal: 'n8n:reader',
    query: 'refunds',
  });
  await assert.rejects(
    () => execute(denied.parameters, [{ json: {} }]),
    (error) => {
      assert.ok(error instanceof NodeOperationError);
      assert.match(error.message, /^ACCESS_DENIED: /);
      return true;
    }
  );
  assert.deepEqual(await receiptNames(denied.parameters.auditDir), []);
});

test('an unwritable audit directory returns no hits', async () => {
  const blocked = await fixture();
  const parent = path.join(blocked.root, 'not-a-directory');
  await writeFile(parent, 'blocked');
  blocked.parameters.auditDir = path.join(parent, 'audit');
  await assert.rejects(
    () => execute(blocked.parameters, [{ json: {} }]),
    (error) => {
      assert.ok(error instanceof NodeOperationError);
      assert.match(error.message, /^AUDIT_UNAVAILABLE: /);
      return true;
    }
  );
  assert.deepEqual(await receiptNames(blocked.parameters.auditDir), []);
});

const evidenceReceipts = /^er_[a-f0-9]{24}\.json$/u;

const karBounds = {
  maxAnchorNodes: 8,
  maxClosureNodes: 32,
  maxClosureEdges: 32,
  maxFrontierEvidence: 8,
  maxRequirementsPerFrontier: 4,
  maxEvidenceBindings: 8,
  maxCoverVisits: 1000,
};

const supportSource = `format: ceg-source-1
concepts:
  customer:
    label: Customer
  cancellation:
    label: Cancellation
evidence:
  policy:
    source: policy.txt
relations:
  - from: customer
    type: permits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: policy
    requirements:
      - cancel-allowed
requirements:
  - cancel-allowed
`;

function supportPlan() {
  return {
    version: 1,
    anchor: {
      mode: 'supplied',
      witness: [{ nodeId: cegNodeId('customer'), queryTerm: 'evidence' }],
    },
    frontierMap: { permits: 'F_S' },
    depth: 2,
    cardinalityBound: 8,
    coverageMode: 'requirements',
    requirements: {
      F_S: ['cancel-allowed'],
      F_O: [],
      F_Q: [],
      F_T: [],
      F_A: [],
    },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds: { ...karBounds },
    lexical: null,
  };
}

async function karFixture() {
  const loaded = await fixture({
    operation: 'karEvaluate',
    policy: allowPolicy(),
  });
  const image = createKnowledgeImageV5({
    actor: 'kar-v1-support',
    sequence: 1,
    policy: allowPolicy(),
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode(
          'The customer may cancel. This sentence is evidence for the plan.'
        ),
        meta: { source: 'policy.txt' },
      },
    ],
  });
  await writeFile(loaded.parameters.imagePath, image.bytes);
  loaded.parameters.sha256 = hash(image.bytes);
  loaded.parameters.stateRoot = image.stateRoot;
  const parsed = parseCegSource(supportSource);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  const compiled = compileCegSource({
    source: parsed.source,
    image: image.bytes,
  });
  if (!compiled.ok) {
    throw new Error(JSON.stringify(compiled.diagnostics));
  }
  const graphBytes = Buffer.from(`${JSON.stringify(compiled.sidecar)}\n`);
  const graphPath = path.join(loaded.root, 'support.kar.json');
  await writeFile(graphPath, graphBytes);
  loaded.parameters.karGraphPath = graphPath;
  loaded.parameters.karGraphSha256 = hash(graphBytes);
  loaded.image = image;
  loaded.graph = compiled.sidecar;
  loaded.plan = supportPlan();
  loaded.proposition = 'What evidence supports cancellation?';
  return loaded;
}

test('status reports the pin and omits freshness without source roots', async () => {
  const loaded = await fixture({ operation: 'status' });
  const incoming = item({ agentId: 'evil', sha256: 'b'.repeat(64) });
  const [output] = await execute(loaded.parameters, [incoming.data]);
  assert.equal(incoming.reads.length, 0);
  const body = output[0].json;
  assert.equal(body.ok, true);
  assert.equal(body.status, 'ready');
  assert.equal(body.pin, loaded.parameters.sha256);
  assert.equal(body.imageId, 'image');
  assert.equal(body.stateRoot, loaded.image.stateRoot);
  assert.equal(body.mounts[0].status, 'ready');
  assert.equal(body.mounts[0].stateRoot, loaded.image.stateRoot);
  assert.equal(Object.hasOwn(body.mounts[0], 'stale'), false);
  assert.equal(body.receipt, null);
  assert.deepEqual(await receiptNames(loaded.parameters.auditDir), []);
  assert.deepEqual(
    await receiptNames(loaded.parameters.auditDir, evidenceReceipts),
    []
  );
});

test('status reports a stale source tree', async () => {
  const loaded = await fixture({ operation: 'status', mountId: 'skills' });
  const grok = path.join(loaded.root, 'grok');
  const skillDir = path.join(grok, 'skills', 'notes');
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), 'fresh skill note\n');
  const digest = await digestScopeSources({
    scope: 'skills',
    roots: [path.join(grok, 'skills')],
    grokHome: grok,
  });
  assert.equal(typeof digest.sourceDigest, 'string');
  loaded.parameters.grokHome = grok;
  loaded.parameters.builtAt = '2026-11-15T00:00:00.000Z';
  loaded.parameters.sourceDigest = digest.sourceDigest;
  loaded.parameters.sourceRoots = path.join(grok, 'skills');
  const [fresh] = await execute(loaded.parameters, [{ json: {} }]);
  assert.equal(fresh[0].json.ok, true);
  assert.equal(fresh[0].json.status, 'ready');
  assert.equal(fresh[0].json.mounts[0].stale, false);
  assert.equal(fresh[0].json.mounts[0].builtAt, '2026-11-15T00:00:00.000Z');

  loaded.parameters.sourceDigest = 'a'.repeat(64);
  const [stale] = await execute(loaded.parameters, [{ json: {} }]);
  assert.equal(stale[0].json.ok, false);
  assert.equal(stale[0].json.status, 'stale');
  assert.equal(stale[0].json.mounts[0].stale, true);
  assert.equal(stale[0].json.pin, loaded.parameters.sha256);
  assert.equal(stale[0].json.receipt, null);
});

test('KAR evaluate and verify write receipts and read item fields', async () => {
  const loaded = await karFixture();
  const incoming = item({
    agentId: 'evil',
    proposition: loaded.proposition,
    plan: loaded.plan,
    sha256: 'c'.repeat(64),
  });
  const [evaluatedOutput] = await execute(loaded.parameters, [incoming.data]);
  assert.equal(incoming.reads.length, 0);
  const evaluated = evaluatedOutput[0].json;
  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.status, 'SATISFIED');
  assert.equal(
    evaluated.statement,
    'SATISFIED means evidence requirements were met. It does not mean a claim is proven.'
  );
  assert.match(evaluated.receiptId, /^er_[a-f0-9]{24}$/u);
  assert.equal(evaluated.receipt.receiptId, evaluated.receiptId);
  assert.equal(evaluated.receipt.tool, 'knolo_kar_evaluate');
  assert.equal(evaluated.receipt.caller.agentId, 'n8n');
  assert.equal(evaluated.receipt.outcome.status, 'SATISFIED');
  const receipt = JSON.parse(
    await readFile(
      path.join(loaded.parameters.auditDir, `${evaluated.receiptId}.json`),
      'utf8'
    )
  );
  assert.equal(receipt.tool, 'knolo_kar_evaluate');
  assert.deepEqual(receipt.caller, { agentId: 'n8n' });

  const session = createKarSession({
    image: loaded.image,
    graph: loaded.graph,
  });
  const evaluation = evaluateKar(session, {
    proposition: loaded.proposition,
    plan: loaded.plan,
  });
  loaded.parameters.operation = 'karVerify';
  loaded.parameters.proposition = loaded.proposition;
  loaded.parameters.plan = JSON.stringify(loaded.plan);
  loaded.parameters.result = JSON.stringify(evaluation);
  const [verifiedOutput] = await execute(loaded.parameters, [
    item({ agentId: 'evil', result: { status: 'tampered' } }).data,
  ]);
  const verified = verifiedOutput[0].json;
  assert.equal(verified.ok, true);
  assert.equal(verified.status, 'SATISFIED');
  assert.equal(verified.code, 'VERIFIED');
  assert.equal(verified.receipt.tool, 'knolo_kar_verify');
  assert.equal(verified.receipt.caller.agentId, 'n8n');

  const dossier = createKarDossier({
    image: loaded.image,
    graph: loaded.graph,
    plan: loaded.plan,
    proposition: loaded.proposition,
  });
  loaded.parameters.result = '';
  loaded.parameters.dossier = JSON.stringify({
    manifest: dossier.manifest,
    certificate: dossier.certificate,
    evaluation: dossier.evaluation,
    evidenceMarkdown: renderKarDossier(dossier),
  });
  const [dossierOutput] = await execute(loaded.parameters, [{ json: {} }]);
  assert.equal(dossierOutput[0].json.ok, true);
  assert.equal(dossierOutput[0].json.code, 'VERIFIED');
  assert.equal(dossierOutput[0].json.receipt.tool, 'knolo_kar_verify');
});

test('a mount without a KAR graph rejects evaluate and writes no receipt', async () => {
  const loaded = await karFixture();
  loaded.parameters.karGraphPath = '';
  loaded.parameters.karGraphSha256 = '';
  loaded.parameters.proposition = loaded.proposition;
  loaded.parameters.plan = JSON.stringify(loaded.plan);
  await assert.rejects(
    () => execute(loaded.parameters, [{ json: {} }]),
    (error) => {
      assert.ok(error instanceof NodeOperationError);
      assert.match(
        error.message,
        /^IMAGE_UNAVAILABLE: Mount image has no pinned KAR graph\./
      );
      return true;
    }
  );
  assert.deepEqual(
    await receiptNames(loaded.parameters.auditDir, evidenceReceipts),
    []
  );
});

test('a tampered KAR result fails verify and still writes a receipt', async () => {
  const loaded = await karFixture();
  const session = createKarSession({
    image: loaded.image,
    graph: loaded.graph,
  });
  const evaluation = evaluateKar(session, {
    proposition: loaded.proposition,
    plan: loaded.plan,
  });
  const tampered = JSON.parse(JSON.stringify(evaluation));
  tampered.certificate.roots.karRoot = `${tampered.certificate.roots.karRoot.slice(0, -1)}${
    tampered.certificate.roots.karRoot.endsWith('0') ? '1' : '0'
  }`;
  loaded.parameters.operation = 'karVerify';
  loaded.parameters.proposition = loaded.proposition;
  loaded.parameters.plan = JSON.stringify(loaded.plan);
  loaded.parameters.result = JSON.stringify(tampered);
  const [output] = await execute(loaded.parameters, [{ json: {} }]);
  assert.equal(output[0].json.ok, false);
  assert.equal(output[0].json.status, 'KAR_RESULT_MISMATCH');
  assert.equal(output[0].json.code, 'KAR_RESULT_MISMATCH');
  assert.equal(output[0].json.receipt.tool, 'knolo_kar_verify');
  assert.equal(output[0].json.receipt.outcome.ok, false);
});

test('Cortex verify checks a trace and rejects a tampered trace', async () => {
  const loaded = await fixture({ operation: 'cortexVerify' });
  const image = createKnowledgeImageV5({
    actor: 'cortex-conformance',
    sequence: 1,
    policy: allowPolicy(),
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode('The valve inspection passed.'),
        meta: { source: 'a.txt' },
      },
      {
        kind: 'chunk',
        bytes: encoder.encode('The pump was replaced.'),
        meta: { source: 'b.txt' },
      },
    ],
  });
  await writeFile(loaded.parameters.imagePath, image.bytes);
  loaded.parameters.sha256 = hash(image.bytes);
  loaded.parameters.stateRoot = image.stateRoot;
  const session = await createCortexSession({ image: image.bytes });
  const found = await askCortex(session, {
    question: 'valve',
    mode: 'find_relevant',
  });
  const incoming = item({ agentId: 'evil', answer: found });
  const [verifiedOutput] = await execute(loaded.parameters, [incoming.data]);
  assert.equal(incoming.reads.length, 0);
  const verified = verifiedOutput[0].json;
  assert.equal(verified.ok, true);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.traceRoot, found.receipt.traceRoot);
  assert.match(verified.statement, /does not mean the answer is true/);
  assert.equal(verified.receipt.tool, 'knolo_cortex_verify');
  assert.equal(verified.receipt.caller.agentId, 'n8n');
  assert.equal(verified.receipt.graphSha256, null);
  const names = await receiptNames(
    loaded.parameters.auditDir,
    evidenceReceipts
  );
  assert.equal(names.length, 1);

  const tampered = structuredClone(found);
  tampered.answer.gaps.push({
    subquestion: found.question,
    reason: 'tampered',
  });
  loaded.parameters.trace = JSON.stringify(tampered);
  loaded.parameters.question = 'valve';
  const [tamperedOutput] = await execute(loaded.parameters, [{ json: {} }]);
  assert.equal(tamperedOutput[0].json.ok, false);
  assert.notEqual(tamperedOutput[0].json.status, 'verified');
  assert.equal(tamperedOutput[0].json.receipt.tool, 'knolo_cortex_verify');
  assert.equal(tamperedOutput[0].json.receipt.outcome.ok, false);
  assert.match(tamperedOutput[0].json.receiptId, /^er_[a-f0-9]{24}$/u);
});

test('Cortex verify uses the pinned graph for a trace from a bound session', async () => {
  const loaded = await karFixture();
  loaded.parameters.operation = 'cortexVerify';
  // A bound graph puts knowledgeRoot in the trace image identity, even
  // when the mode runs no KAR evaluation.
  const session = await createCortexSession({
    image: loaded.image.bytes,
    graph: loaded.graph,
  });
  const found = await askCortex(session, {
    question: loaded.proposition,
    mode: 'find_relevant',
  });
  assert.equal(found.karEvaluations, undefined);
  const incoming = item({ answer: found });
  const [output] = await execute(loaded.parameters, [incoming.data]);
  const verified = output[0].json;
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.traceRoot, found.receipt.traceRoot);
  assert.equal(verified.receipt.graphSha256, loaded.parameters.karGraphSha256);
});
