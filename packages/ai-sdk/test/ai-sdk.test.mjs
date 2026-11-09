import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '@knolo/core';
import { askCortex, createCortexSession } from '@knolo/core/cortex';
import { createKarSession, evaluateKar } from '@knolo/core/kar';
import {
  cegNodeId,
  compileCegSource,
  parseCegSource,
} from '@knolo/core/kar/authoring';
import { KnoloPluginError } from '@knolo/tools';

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

const [{ Client }, { InMemoryTransport }, mcp, aiSdk] = await Promise.all([
  import('@modelcontextprotocol/client'),
  import('@modelcontextprotocol/server'),
  import('@knolo/mcp'),
  import('../dist/index.js'),
]);

const { createKnoloMcp } = mcp;
const { knoloTools, loadKnoloAiSdkConfigFile } = aiSdk;
const encoder = new TextEncoder();
const executeOptions = { toolCallId: 't', messages: [] };
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-ai-sdk-'));
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
  for (const key of [
    'maxHits',
    'maxExcerptBytes',
    'maxQueryBytes',
    'maxImageBytes',
    'maxAuditRecords',
    'maxAuditBytes',
  ]) {
    if (overrides[key] !== undefined) config[key] = overrides[key];
  }
  return { root, image, config };
}

async function connected(config) {
  const opened = await createKnoloMcp(config);
  const client = new Client({ name: 'knolo-mcp-test', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    opened.server.connect(serverTransport),
  ]);
  return { client };
}

async function call(client, name, args = {}) {
  return client.callTool({ name, arguments: args });
}

function textOf(result) {
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

function withoutReceiptIds(value) {
  if (Array.isArray(value)) return value.map(withoutReceiptIds);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === 'receiptId') continue;
      copy[key] = withoutReceiptIds(item);
    }
    return copy;
  }
  return value;
}

function assertSameBody(actual, expected) {
  assert.deepEqual(withoutReceiptIds(actual), withoutReceiptIds(expected));
}

function schemaKeys(schema) {
  assert.equal(typeof schema?.shape, 'object');
  return Object.keys(schema.shape);
}

async function assertThrowsSame(work, mcpResult) {
  await assert.rejects(work, (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, textOf(mcpResult));
    assert.equal(mcpResult.structuredContent, undefined);
    return true;
  });
}

function pluginText(error) {
  assert.ok(error instanceof KnoloPluginError);
  return `${error.code}: ${error.message}`;
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-ai-sdk-kar-'));
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
  const cortexImage = createKnowledgeImageV5({
    actor: 'cortex-conformance',
    sequence: 1,
    policy,
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
  const notes = createKnowledgeImageV5({ policy, objects: defaultObjects() });
  const mounts = [
    await writeMount(root, 'support', supportImage, policy, compiled.sidecar),
    await writeMount(root, 'cortex-v5', cortexImage, policy),
    await writeMount(root, 'notes', notes, policy),
  ];
  return {
    root,
    supportImage,
    graph: compiled.sidecar,
    cortexImage,
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

test('read tools match MCP and fail closed', async () => {
  const { config, image, root } = await fixture();
  const mcpClient = await connected(config);
  const tools = await knoloTools(config);
  try {
    assert.deepEqual(Object.keys(tools).sort(), readToolNames);
    const listed = await mcpClient.client.listTools();
    for (const listedTool of listed.tools) {
      const adapter = tools[listedTool.name];
      assert.equal(adapter.description, listedTool.description);
      assert.equal(schemaKeys(adapter.inputSchema).includes('agentId'), false);
      assert.equal(
        schemaKeys(adapter.inputSchema).includes('sessionId'),
        false
      );
    }
    assert.equal(tools.knolo_search.description.includes('exact word'), false);

    const query = { query: 'enterprise refunds', limit: 4 };
    const mcpSearch = await call(mcpClient.client, 'knolo_search', query);
    const search = await tools.knolo_search.execute(query, executeOptions);
    assert.notEqual(mcpSearch.isError, true);
    assertSameBody(search, mcpSearch.structuredContent);
    assert.equal(search.version, 1);
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

    const getArgs = {
      imageId: 'support-policy',
      objectId: search.hits[0].objectId,
      stateRoot: image.stateRoot,
    };
    const mcpGet = await call(mcpClient.client, 'knolo_get', getArgs);
    const got = await tools.knolo_get.execute(getArgs, executeOptions);
    assertSameBody(got, mcpGet.structuredContent);

    const mcpVerify = await call(mcpClient.client, 'knolo_verify', {});
    const verified = await tools.knolo_verify.execute({}, executeOptions);
    assertSameBody(verified, mcpVerify.structuredContent);
    assert.equal(verified.results[0].valid, true);

    const mcpStatus = await call(mcpClient.client, 'knolo_status', {});
    const status = await tools.knolo_status.execute({}, executeOptions);
    assertSameBody(status, mcpStatus.structuredContent);
  } finally {
    await mcpClient.client.close();
  }

  const capped = await fixture({ maxHits: 1 });
  const cappedMcp = await connected(capped.config);
  const cappedTools = await knoloTools(capped.config);
  try {
    const args = { query: 'available', limit: 50 };
    const mcpCapped = await call(cappedMcp.client, 'knolo_search', args);
    const clamped = await cappedTools.knolo_search.execute(
      args,
      executeOptions
    );
    assertSameBody(clamped, mcpCapped.structuredContent);
    assert.equal(clamped.hits.length, 1);
  } finally {
    await cappedMcp.client.close();
  }
});

test('authorization, audit, query, and pin errors match MCP', async () => {
  const hidden = await fixture({ agents: ['other'] });
  const hiddenMcp = await connected(hidden.config);
  const hiddenTools = await knoloTools(hidden.config);
  try {
    const denied = await call(hiddenMcp.client, 'knolo_search', {
      query: 'refunds',
    });
    await assertThrowsSame(
      () =>
        hiddenTools.knolo_search.execute({ query: 'refunds' }, executeOptions),
      denied
    );
    assert.match(textOf(denied), /^ACCESS_DENIED: /);
  } finally {
    await hiddenMcp.client.close();
  }

  const blocked = await fixture({
    policy: {
      version: 1,
      default: 'deny',
      rules: [
        {
          effect: 'allow',
          action: 'query',
          principal: 'mcp:other',
          kind: 'chunk',
        },
      ],
    },
    principal: 'mcp:reader',
  });
  const blockedMcp = await connected(blocked.config);
  const blockedTools = await knoloTools(blocked.config);
  try {
    const denied = await call(blockedMcp.client, 'knolo_search', {
      query: 'refunds',
    });
    await assertThrowsSame(
      () =>
        blockedTools.knolo_search.execute({ query: 'refunds' }, executeOptions),
      denied
    );
  } finally {
    await blockedMcp.client.close();
  }

  const { config, image } = await fixture();
  const liveMcp = await connected(config);
  const live = await knoloTools(config);
  try {
    const stale = await call(liveMcp.client, 'knolo_get', {
      imageId: 'support-policy',
      objectId: image.objects[0].id,
      stateRoot: `sha256-${'0'.repeat(64)}`,
    });
    await assertThrowsSame(
      () =>
        live.knolo_get.execute(
          {
            imageId: 'support-policy',
            objectId: image.objects[0].id,
            stateRoot: `sha256-${'0'.repeat(64)}`,
          },
          executeOptions
        ),
      stale
    );
    assert.match(textOf(stale), /^STATE_ROOT_MISMATCH: /);

    const blank = await call(liveMcp.client, 'knolo_search', { query: '   ' });
    await assertThrowsSame(
      () => live.knolo_search.execute({ query: '   ' }, executeOptions),
      blank
    );
    assert.match(textOf(blank), /^QUERY_INVALID: /);
  } finally {
    await liveMcp.client.close();
  }

  const { root, config: auditConfig } = await fixture();
  const blocker = path.join(root, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  auditConfig.auditDir = path.join(blocker, 'audit');
  const auditMcp = await connected(auditConfig);
  const auditTools = await knoloTools(auditConfig);
  try {
    const failed = await call(auditMcp.client, 'knolo_search', {
      query: 'refunds',
    });
    await assertThrowsSame(
      () =>
        auditTools.knolo_search.execute({ query: 'refunds' }, executeOptions),
      failed
    );
    assert.match(textOf(failed), /^AUDIT_UNAVAILABLE: /);
  } finally {
    await auditMcp.client.close();
  }

  const wrongHash = await fixture({ sha256: 'a'.repeat(64) });
  const mcpPin = await createKnoloMcp(wrongHash.config).then(
    () => {
      throw new Error('MCP accepted a bad image pin');
    },
    (error) => error
  );
  await assert.rejects(
    () => knoloTools(wrongHash.config),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, pluginText(mcpPin));
      assert.match(
        error.message,
        /^IMAGE_INVALID: Image support-policy does not match its SHA-256 pin\./
      );
      return true;
    }
  );

  const mismatched = await fixture({
    policyOnDisk: {
      version: 1,
      default: 'deny',
      rules: [],
    },
  });
  const mcpPolicy = await createKnoloMcp(mismatched.config).then(
    () => {
      throw new Error('MCP accepted a policy root mismatch');
    },
    (error) => error
  );
  await assert.rejects(
    () => knoloTools(mismatched.config),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, pluginText(mcpPolicy));
      assert.match(error.message, /^IMAGE_INVALID: /);
      return true;
    }
  );
});

test('config file errors use the adapter wording', async () => {
  await assert.rejects(
    () => loadKnoloAiSdkConfigFile('knolo-mcp.json'),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        'QUERY_INVALID: Knolo config path must be absolute.'
      );
      return true;
    }
  );

  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-ai-sdk-config-'));
  const badJson = path.join(root, 'knolo-mcp.json');
  await writeFile(badJson, '{');
  await assert.rejects(
    () => loadKnoloAiSdkConfigFile(badJson),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        'IMAGE_INVALID: Knolo config is not valid JSON.'
      );
      return true;
    }
  );

  const { config } = await fixture();
  const configPath = path.join(path.dirname(config.auditDir), 'knolo-mcp.json');
  await writeFile(configPath, JSON.stringify(config));
  const loaded = await loadKnoloAiSdkConfigFile(configPath);
  const tools = await knoloTools(loaded);
  assert.deepEqual(Object.keys(tools).sort(), readToolNames);
});

test('KAR and Cortex tools match MCP', async () => {
  const workspace = await graphFixture();
  const mcpClient = await connected(workspace.config);
  const tools = await knoloTools(workspace.config);
  try {
    assert.deepEqual(
      Object.keys(tools).sort(),
      [...readToolNames, ...graphToolNames].sort()
    );
    const listed = await mcpClient.client.listTools();
    for (const listedTool of listed.tools) {
      assert.equal(tools[listedTool.name].description, listedTool.description);
      assert.equal(
        schemaKeys(tools[listedTool.name].inputSchema).includes('agentId'),
        false
      );
    }
    assert.match(
      tools.knolo_kar_evaluate.description,
      /does not mean a claim is proven/
    );
    assert.match(
      tools.knolo_cortex_verify.description,
      /does not mean the answer is true/
    );

    const evaluateArgs = {
      mountId: 'support',
      proposition: workspace.proposition,
      plan: workspace.plan,
    };
    const mcpEvaluated = await call(
      mcpClient.client,
      'knolo_kar_evaluate',
      evaluateArgs
    );
    const evaluated = await tools.knolo_kar_evaluate.execute(
      evaluateArgs,
      executeOptions
    );
    assert.notEqual(mcpEvaluated.isError, true);
    assertSameBody(evaluated, mcpEvaluated.structuredContent);
    assert.match(evaluated.receiptId, /^er_/);
    assert.equal(
      evaluated.statement,
      'SATISFIED means evidence requirements were met. It does not mean a claim is proven.'
    );
    const evidenceReceipt = JSON.parse(
      await readFile(
        path.join(workspace.root, 'audit', `${evaluated.receiptId}.json`),
        'utf8'
      )
    );
    assert.equal(evidenceReceipt.version, 'knolo-mcp-evidence-receipt-v1');
    assert.equal(evidenceReceipt.tool, 'knolo_kar_evaluate');
    assert.deepEqual(evidenceReceipt.caller, { agentId: 'mcp' });

    const session = createKarSession({
      image: workspace.supportImage,
      graph: workspace.graph,
    });
    const evaluation = evaluateKar(session, {
      proposition: workspace.proposition,
      plan: workspace.plan,
    });
    const verifyArgs = {
      mountId: 'support',
      proposition: workspace.proposition,
      plan: workspace.plan,
      result: evaluation,
    };
    const mcpVerified = await call(
      mcpClient.client,
      'knolo_kar_verify',
      verifyArgs
    );
    const verified = await tools.knolo_kar_verify.execute(
      verifyArgs,
      executeOptions
    );
    assertSameBody(verified, mcpVerified.structuredContent);
    assert.equal(verified.ok, true);
    assert.equal(verified.code, 'VERIFIED');

    const tampered = JSON.parse(JSON.stringify(evaluation));
    const karRoot = tampered.certificate.roots.karRoot;
    tampered.certificate.roots.karRoot = `${karRoot.slice(0, -1)}${
      karRoot.endsWith('0') ? '1' : '0'
    }`;
    const tamperArgs = { ...verifyArgs, result: tampered };
    const mcpTamper = await call(
      mcpClient.client,
      'knolo_kar_verify',
      tamperArgs
    );
    const tamper = await tools.knolo_kar_verify.execute(
      tamperArgs,
      executeOptions
    );
    assertSameBody(tamper, mcpTamper.structuredContent);
    assert.equal(tamper.ok, false);
    assert.equal(tamper.code, 'KAR_RESULT_MISMATCH');

    const cortexSession = await createCortexSession({
      image: workspace.cortexImage.bytes,
    });
    const found = await askCortex(cortexSession, {
      question: 'valve',
      mode: 'find_relevant',
    });
    const cortexArgs = { mountId: 'cortex-v5', answer: found };
    const mcpCortex = await call(
      mcpClient.client,
      'knolo_cortex_verify',
      cortexArgs
    );
    const cortex = await tools.knolo_cortex_verify.execute(
      cortexArgs,
      executeOptions
    );
    assertSameBody(cortex, mcpCortex.structuredContent);
    assert.equal(cortex.ok, true);
    assert.equal(cortex.traceRoot, found.receipt.traceRoot);
    assert.match(cortex.statement, /does not mean the answer is true/);

    const before = (await readdir(workspace.config.auditDir)).filter((name) =>
      name.startsWith('er_')
    ).length;
    const mcpUnpinned = await call(mcpClient.client, 'knolo_kar_evaluate', {
      mountId: 'notes',
      proposition: workspace.proposition,
      plan: workspace.plan,
    });
    await assertThrowsSame(
      () =>
        tools.knolo_kar_evaluate.execute(
          {
            mountId: 'notes',
            proposition: workspace.proposition,
            plan: workspace.plan,
          },
          executeOptions
        ),
      mcpUnpinned
    );
    assert.match(textOf(mcpUnpinned), /^IMAGE_UNAVAILABLE: /);
    const after = (await readdir(workspace.config.auditDir)).filter((name) =>
      name.startsWith('er_')
    ).length;
    assert.equal(after, before);
  } finally {
    await mcpClient.client.close();
  }
});

test('a KAR graph pin mismatch fails before tools exist', async () => {
  const built = await fixture();
  const graphPath = path.join(built.root, 'graph.json');
  await writeFile(graphPath, '{}\n');
  built.config.mounts[0].kar = {
    graphPath,
    graphSha256: 'ab'.repeat(32),
  };
  const mcpPin = await createKnoloMcp(built.config).then(
    () => {
      throw new Error('MCP accepted a bad graph pin');
    },
    (error) => error
  );
  await assert.rejects(
    () => knoloTools(built.config),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, pluginText(mcpPin));
      assert.match(
        error.message,
        /^IMAGE_INVALID: KAR graph for support-policy does not match its SHA-256 pin\./
      );
      return true;
    }
  );
});

test('the package source does not call a model', async () => {
  const source = await readFile(
    new URL('../src/index.ts', import.meta.url),
    'utf8'
  );
  const evidence = await readFile(
    new URL('../src/evidence.ts', import.meta.url),
    'utf8'
  );
  assert.equal(source.includes('generateText'), false);
  assert.equal(source.includes('streamText'), false);
  assert.equal(evidence.includes('generateText'), false);
  assert.equal(networkCalls, 0);
});
