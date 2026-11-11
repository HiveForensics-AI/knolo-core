import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '@knolo/core';
import {
  cegNodeId,
  compileCegSource,
  parseCegSource,
} from '@knolo/core/kar/authoring';
import { KNOLO_SEARCH_DESCRIPTION } from '@knolo/tools';

let networkCalls = 0;
function rejectNetwork() {
  networkCalls += 1;
  throw new Error('network disabled');
}
globalThis.fetch = rejectNetwork;
http.request = rejectNetwork;
http.get = rejectNetwork;
https.request = rejectNetwork;
https.get = rejectNetwork;

const { knoloTools, loadKnoloOpenAIAgentsConfigFile } =
  await import('../dist/index.js');

const encoder = new TextEncoder();
const readToolNames = [
  'knolo_get',
  'knolo_search',
  'knolo_status',
  'knolo_verify',
];
const graphToolNames = [
  'knolo_cortex_verify',
  'knolo_kar_evaluate',
  'knolo_kar_verify',
];

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function allowPolicy() {
  return {
    version: 1,
    default: 'deny',
    rules: [
      {
        effect: 'allow',
        action: 'query',
        principal: 'mcp:reader',
        kind: 'chunk',
      },
      {
        effect: 'allow',
        action: 'read',
        principal: 'mcp:reader',
        kind: 'chunk',
      },
    ],
  };
}

function defaultObjects() {
  return [
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
  ];
}

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-openai-agents-'));
  const policy = overrides.policy ?? allowPolicy();
  const image = createKnowledgeImageV5({
    policy,
    objects: overrides.objects ?? defaultObjects(),
  });
  const imagePath = path.join(root, 'support.v5');
  const policyPath = path.join(root, 'policy.json');
  await writeFile(imagePath, image.bytes);
  await writeFile(policyPath, JSON.stringify(overrides.policyOnDisk ?? policy));
  const config = {
    agentId: overrides.agentId ?? 'mcp',
    auditDir: overrides.auditDir ?? path.join(root, 'audit'),
    mounts: [
      {
        id: 'support-policy',
        path: overrides.path ?? imagePath,
        sha256: overrides.sha256 ?? hash(image.bytes),
        stateRoot: overrides.stateRoot ?? image.stateRoot,
        policyPath: overrides.policyPath ?? policyPath,
        agents: overrides.agents ?? ['mcp'],
        principal: overrides.principal ?? 'mcp:reader',
      },
    ],
  };
  return { root, image, config };
}

const karBounds = {
  maxAnchorNodes: 8,
  maxClosureNodes: 32,
  maxClosureEdges: 32,
  maxFrontierEvidence: 8,
  maxRequirementsPerFrontier: 4,
  maxEvidenceBindings: 8,
  maxCoverVisits: 1000,
};

function karPlan(anchor, frontierMap, requirements, floors) {
  return {
    version: 1,
    anchor: {
      mode: 'supplied',
      witness: [{ nodeId: anchor, queryTerm: 'evidence' }],
    },
    frontierMap,
    depth: 2,
    cardinalityBound: 8,
    coverageMode: 'requirements',
    requirements: {
      F_S: [],
      F_O: [],
      F_Q: [],
      F_T: [],
      F_A: [],
      ...requirements,
    },
    floors: { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0', ...floors },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds: { ...karBounds },
    lexical: null,
  };
}

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

async function writeMount(root, id, image, policy, graph) {
  const imagePath = path.join(root, `${id}.v5`);
  const policyPath = path.join(root, `${id}.policy.json`);
  await writeFile(imagePath, image.bytes);
  await writeFile(policyPath, JSON.stringify(policy));
  const mount = {
    id,
    path: imagePath,
    sha256: hash(image.bytes),
    stateRoot: image.stateRoot,
    policyPath,
    agents: ['mcp'],
    principal: 'mcp:reader',
  };
  if (graph) {
    const graphPath = path.join(root, `${id}.kar.json`);
    const bytes = Buffer.from(`${JSON.stringify(graph)}\n`);
    await writeFile(graphPath, bytes);
    mount.kar = { graphPath, graphSha256: hash(bytes) };
  }
  return mount;
}

async function graphFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'knolo-openai-agents-kar-')
  );
  const policy = allowPolicy();
  const supportImage = createKnowledgeImageV5({
    actor: 'kar-v1-support',
    sequence: 1,
    policy,
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
  const parsed = parseCegSource(supportSource);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const compiled = compileCegSource({
    source: parsed.source,
    image: supportImage.bytes,
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const mounts = [
    await writeMount(root, 'support', supportImage, policy, compiled.sidecar),
  ];
  return {
    root,
    config: {
      agentId: 'mcp',
      auditDir: path.join(root, 'audit'),
      mounts,
    },
    plan: karPlan(
      cegNodeId('customer'),
      { permits: 'F_S' },
      { F_S: ['cancel-allowed'] },
      { F_S: '1' }
    ),
    proposition: 'What evidence supports cancellation?',
  };
}

function schemaText(knoloTool) {
  return JSON.stringify(knoloTool.parameters);
}

test('read tools search a fixture and fail closed', async () => {
  const { config, root } = await fixture();
  const tools = await knoloTools(config);
  assert.deepEqual(Object.keys(tools).sort(), readToolNames);
  assert.equal(tools.knolo_search.description, KNOLO_SEARCH_DESCRIPTION);
  assert.equal(tools.knolo_search.description.includes('exact word'), false);
  for (const name of readToolNames) {
    assert.equal(schemaText(tools[name]).includes('agentId'), false);
    assert.equal(schemaText(tools[name]).includes('sessionId'), false);
  }

  const search = await tools.knolo_search.invoke(
    {},
    JSON.stringify({ query: 'enterprise refunds', imageIds: null, limit: null })
  );
  assert.equal(typeof search, 'object');
  assert.match(search.hits[0].excerpt, /Annual enterprise refunds/);
  assert.match(search.hits[0].receiptId, /^qr_/);
  const receipt = JSON.parse(
    await readFile(
      path.join(root, 'audit', `${search.receipts[0].receiptId}.json`),
      'utf8'
    )
  );
  assert.equal(receipt.version, 'openclaw-knolo-query-v1');
  assert.deepEqual(receipt.caller, { agentId: 'mcp' });

  const omitted = await tools.knolo_search.invoke(
    {},
    JSON.stringify({ query: 'enterprise refunds' })
  );
  assert.equal(omitted.hits[0].objectId, search.hits[0].objectId);

  const hidden = await fixture({ agents: ['other'] });
  const hiddenTools = await knoloTools(hidden.config);
  const denied = await hiddenTools.knolo_search.invoke(
    {},
    JSON.stringify({ query: 'refunds' })
  );
  assert.match(denied, /^ACCESS_DENIED: /);

  const blockedRoot = await mkdtemp(
    path.join(os.tmpdir(), 'knolo-openai-agents-audit-')
  );
  const blocker = path.join(blockedRoot, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  const { config: auditConfig } = await fixture({
    auditDir: path.join(blocker, 'audit'),
  });
  const auditTools = await knoloTools(auditConfig);
  const failed = await auditTools.knolo_search.invoke(
    {},
    JSON.stringify({ query: 'refunds' })
  );
  assert.match(failed, /^AUDIT_UNAVAILABLE: /);

  const wrongHash = await fixture({ sha256: 'a'.repeat(64) });
  await assert.rejects(
    () => knoloTools(wrongHash.config),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /^IMAGE_INVALID: Image support-policy does not match its SHA-256 pin\./
      );
      return true;
    }
  );
  assert.equal(networkCalls, 0);
});

test('config file errors use the adapter wording', async () => {
  await assert.rejects(
    () => loadKnoloOpenAIAgentsConfigFile('knolo-mcp.json'),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        'QUERY_INVALID: Knolo config path must be absolute.'
      );
      return true;
    }
  );

  const root = await mkdtemp(
    path.join(os.tmpdir(), 'knolo-openai-agents-config-')
  );
  const badJson = path.join(root, 'knolo-mcp.json');
  await writeFile(badJson, '{');
  await assert.rejects(
    () => loadKnoloOpenAIAgentsConfigFile(badJson),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        'IMAGE_INVALID: Knolo config is not valid JSON.'
      );
      return true;
    }
  );
});

test('KAR tools appear only with a pinned graph', async () => {
  const workspace = await graphFixture();
  const tools = await knoloTools(workspace.config);
  assert.deepEqual(
    Object.keys(tools).sort(),
    [...readToolNames, ...graphToolNames].sort()
  );
  for (const name of Object.keys(tools)) {
    assert.equal(schemaText(tools[name]).includes('agentId'), false);
  }
  assert.match(
    tools.knolo_kar_evaluate.description,
    /SATISFIED means evidence requirements were met/
  );
  const evaluated = await tools.knolo_kar_evaluate.invoke(
    {},
    JSON.stringify({
      mountId: 'support',
      proposition: workspace.proposition,
      plan: workspace.plan,
    })
  );
  assert.equal(evaluated.status, 'SATISFIED');
  assert.equal(
    evaluated.statement,
    'SATISFIED means evidence requirements were met. It does not mean a claim is proven.'
  );
  assert.match(evaluated.receiptId, /^er_/);

  const plain = await fixture();
  const plainTools = await knoloTools(plain.config);
  assert.equal(plainTools.knolo_kar_evaluate, undefined);
  assert.equal(plainTools.knolo_kar_verify, undefined);
  assert.equal(plainTools.knolo_cortex_verify, undefined);
});
