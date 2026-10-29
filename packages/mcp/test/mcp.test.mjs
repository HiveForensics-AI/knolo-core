import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

const [{ Client }, { InMemoryTransport }, mcp] = await Promise.all([
  import('@modelcontextprotocol/client'),
  import('@modelcontextprotocol/server'),
  import('../dist/index.js'),
]);

const { createKnoloMcp } = mcp;
const binPath = fileURLToPath(new URL('../bin/knolo-mcp.mjs', import.meta.url));
const encoder = new TextEncoder();
const toolNames = ['knolo_search', 'knolo_get', 'knolo_verify', 'knolo_status'];
const evidenceToolNames = [
  'knolo_kar_evaluate',
  'knolo_kar_verify',
  'knolo_cortex_verify',
];
const karExpectedPath = fileURLToPath(
  new URL('../../../conformance/kar/v1/expected.json', import.meta.url)
);

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-mcp-'));
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
  return { root, image, imagePath, policyPath, config };
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
  return { ...opened, client };
}

async function call(client, name, args = {}) {
  return client.callTool({ name, arguments: args });
}

function textOf(result) {
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

test('lists exactly four read-only tools and keeps caller identity in config', async () => {
  const { config, image, root } = await fixture();
  const { client, service } = await connected(config);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [...toolNames].sort()
    );
    for (const tool of listed.tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.inputSchema.properties?.agentId, undefined);
      assert.equal(tool.inputSchema.properties?.sessionId, undefined);
    }
    const search = await call(client, 'knolo_search', {
      query: 'enterprise refunds',
      limit: 4,
    });
    assert.notEqual(search.isError, true);
    const body = search.structuredContent;
    assert.equal(body.version, 1);
    assert.equal(body.hits.length, 1);
    assert.equal(body.hits[0].stateRoot, image.stateRoot);
    assert.match(body.hits[0].excerpt, /Annual enterprise refunds/);
    const receiptPath = path.join(
      root,
      'audit',
      `${body.receipts[0].receiptId}.json`
    );
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.equal(receipt.version, 'openclaw-knolo-query-v1');
    assert.equal(receipt.caller.agentId, 'mcp');
    assert.equal(receipt.caller.sessionId, 'knolo-mcp-test');
    await service.verifyReceipt(body.receipts[0].receiptId);

    const got = await call(client, 'knolo_get', {
      imageId: 'support-policy',
      objectId: body.hits[0].objectId,
      stateRoot: image.stateRoot,
    });
    assert.equal(got.structuredContent.content, body.hits[0].excerpt);
    const verified = await call(client, 'knolo_verify', {});
    assert.equal(verified.structuredContent.results[0].valid, true);
    const status = await call(client, 'knolo_status', {});
    assert.deepEqual(status.structuredContent.mounts, [
      {
        imageId: 'support-policy',
        stateRoot: image.stateRoot,
        source: 'local',
        status: 'ready',
      },
    ]);
  } finally {
    await client.close();
  }
});

test('startup fails closed on pin and policy mismatches', async () => {
  const wrongHash = await fixture({
    sha256: 'a'.repeat(64),
  });
  await assert.rejects(
    () => createKnoloMcp(wrongHash.config),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );

  const wrongRoot = await fixture({
    stateRoot: `sha256-${'b'.repeat(64)}`,
  });
  await assert.rejects(
    () => createKnoloMcp(wrongRoot.config),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );

  const mismatched = await fixture({
    policyOnDisk: {
      version: 1,
      default: 'deny',
      rules: [
        {
          effect: 'allow',
          action: 'query',
          principal: 'mcp:someone-else',
          kind: 'chunk',
        },
      ],
    },
  });
  await assert.rejects(
    () => createKnoloMcp(mismatched.config),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );

  const relative = await fixture();
  relative.config.mounts[0].path = 'support.v5';
  await assert.rejects(
    () => createKnoloMcp(relative.config),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );
});

test('authorization, stale roots, unknown objects, and limits fail closed', async () => {
  const hidden = await fixture({ agents: ['other'] });
  const hiddenClient = await connected(hidden.config);
  try {
    const denied = await call(hiddenClient.client, 'knolo_search', {
      query: 'refunds',
    });
    assert.match(textOf(denied), /^ACCESS_DENIED: /);
  } finally {
    await hiddenClient.client.close();
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
  const blockedClient = await connected(blocked.config);
  try {
    const denied = await call(blockedClient.client, 'knolo_search', {
      query: 'refunds',
    });
    assert.match(textOf(denied), /^ACCESS_DENIED: /);
  } finally {
    await blockedClient.client.close();
  }

  const { config, image } = await fixture();
  const { client } = await connected(config);
  try {
    const stale = await call(client, 'knolo_get', {
      imageId: 'support-policy',
      objectId: image.objects[0].id,
      stateRoot: `sha256-${'0'.repeat(64)}`,
    });
    assert.match(textOf(stale), /^STATE_ROOT_MISMATCH: /);
    const missing = await call(client, 'knolo_get', {
      imageId: 'support-policy',
      objectId: 'missing-object',
      stateRoot: image.stateRoot,
    });
    assert.match(textOf(missing), /^NOT_FOUND: /);
    const blank = await call(client, 'knolo_search', { query: '   ' });
    assert.match(textOf(blank), /^QUERY_INVALID: /);
  } finally {
    await client.close();
  }

  const oversizeConfig = await fixture({ maxQueryBytes: 4 });
  const oversizeClient = await connected(oversizeConfig.config);
  try {
    const oversize = await call(oversizeClient.client, 'knolo_search', {
      query: 'refunds',
    });
    assert.match(textOf(oversize), /^QUERY_INVALID: /);
  } finally {
    await oversizeClient.client.close();
  }

  const capped = await fixture({ maxHits: 1, maxExcerptBytes: 8 });
  const cappedClient = await connected(capped.config);
  try {
    const clamped = await call(cappedClient.client, 'knolo_search', {
      query: 'available',
      limit: 50,
    });
    assert.notEqual(clamped.isError, true);
    assert.equal(clamped.structuredContent.hits.length, 1);
    assert.ok(
      Buffer.byteLength(clamped.structuredContent.hits[0].excerpt) <= 8
    );
  } finally {
    await cappedClient.client.close();
  }
});

test('an unwritable audit directory returns no hits', async () => {
  const { root, config } = await fixture();
  const blocker = path.join(root, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  config.auditDir = path.join(blocker, 'audit');
  const { client } = await connected(config);
  try {
    const failed = await call(client, 'knolo_search', { query: 'refunds' });
    assert.match(textOf(failed), /^AUDIT_UNAVAILABLE: /);
    assert.equal(failed.structuredContent, undefined);
  } finally {
    await client.close();
  }
});

test('stdio stdout is only JSON-RPC and bad config exits first', async () => {
  const { config } = await fixture();
  const configPath = path.join(path.dirname(config.auditDir), 'mcp.json');
  await writeFile(configPath, JSON.stringify(config));
  const smoke = spawn(process.execPath, [binPath, '--config', configPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  smoke.stdout.setEncoding('utf8');
  smoke.stderr.setEncoding('utf8');
  smoke.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  smoke.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const send = (message) => {
    smoke.stdin.write(`${JSON.stringify(message)}\n`);
  };
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0.0.0' },
    },
  });
  const initialize = await waitFor(
    () => completeMessages(stdout),
    (message) => message.id === 1
  );
  assert.equal(initialize.result.serverInfo.name, 'knolo');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const listed = await waitFor(
    () => completeMessages(stdout),
    (message) => message.id === 2
  );
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name).sort(),
    [...toolNames].sort()
  );
  smoke.stdin.end();
  await stop(smoke);
  for (const line of completeMessages(stdout)) {
    assert.equal(line.jsonrpc, '2.0');
  }
  assert.match(stderr, /knolo-mcp: serving stdio/);
  assert.doesNotMatch(stdout, /knolo-mcp/);

  const broken = await fixture({ sha256: 'c'.repeat(64) });
  const brokenPath = path.join(
    path.dirname(broken.config.auditDir),
    'bad.json'
  );
  await writeFile(brokenPath, JSON.stringify(broken.config));
  const failed = await runUntilExit([binPath, '--config', brokenPath]);
  assert.equal(failed.stdout, '');
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /IMAGE_INVALID/);

  const missing = await runUntilExit([binPath]);
  assert.equal(missing.stdout, '');
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /QUERY_INVALID/);

  const karBroken = await fixture();
  const brokenGraph = path.join(karBroken.root, 'graph.json');
  await writeFile(brokenGraph, '{}\n');
  karBroken.config.mounts[0].kar = {
    graphPath: brokenGraph,
    graphSha256: 'd'.repeat(64),
  };
  const karConfigPath = path.join(karBroken.root, 'kar.json');
  await writeFile(karConfigPath, JSON.stringify(karBroken.config));
  const karFailed = await runUntilExit([binPath, '--config', karConfigPath]);
  assert.equal(karFailed.stdout, '');
  assert.notEqual(karFailed.code, 0);
  assert.match(karFailed.stderr, /IMAGE_INVALID/);
  assert.match(karFailed.stderr, /SHA-256/);
});

test('pinned graphs add read-only KAR and Cortex tools', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-mcp-kar-'));
  const workspace = await buildKarWorkspace(root);
  const expected = JSON.parse(await readFile(karExpectedPath, 'utf8'));
  const expectedById = new Map(
    expected.vectors.map((vector) => [vector.id, vector])
  );
  const { client, service } = await connected({
    agentId: 'mcp',
    auditDir: path.join(root, 'audit'),
    mounts: workspace.mounts,
  });
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [...toolNames, ...evidenceToolNames].sort()
    );
    for (const tool of listed.tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.inputSchema.properties?.agentId, undefined);
      assert.equal(tool.inputSchema.properties?.sessionId, undefined);
    }
    const evaluateTool = listed.tools.find(
      (tool) => tool.name === 'knolo_kar_evaluate'
    );
    assert.match(evaluateTool.description, /does not mean a claim is proven/);

    for (const item of workspace.cases) {
      const vector = expectedById.get(item.id);
      const evaluated = await call(client, 'knolo_kar_evaluate', {
        mountId: item.id,
        proposition: item.proposition,
        plan: item.plan,
      });
      assert.notEqual(evaluated.isError, true, textOf(evaluated));
      const body = evaluated.structuredContent;
      assert.equal(body.status, vector.status);
      assert.equal(body.code, vector.code);
      assert.equal(body.evidenceIds.length, vector.selected);
      assert.equal(body.roots.karRoot, vector.karRoot);
      assert.equal(body.roots.knowledgeRoot, vector.knowledgeRoot);
      assert.equal(body.roots.semanticRoot, vector.semanticRoot);
      assert.equal(
        body.statement,
        'SATISFIED means evidence requirements were met. It does not mean a claim is proven.'
      );
      const receipt = JSON.parse(
        await readFile(
          path.join(root, 'audit', `${body.receiptId}.json`),
          'utf8'
        )
      );
      assert.equal(receipt.version, 'knolo-mcp-evidence-receipt-v1');
      assert.equal(receipt.tool, 'knolo_kar_evaluate');
      assert.equal(receipt.caller.agentId, 'mcp');
      assert.equal(receipt.caller.sessionId, 'knolo-mcp-test');
      assert.equal(receipt.outcome.status, vector.status);
      assert.equal(receipt.outcome.roots.karRoot, vector.karRoot);
      assert.equal(
        receipt.recordDigest,
        hash(stableJson(withoutDigest(receipt)))
      );
      assert.equal('plan' in receipt, false);
      await assert.rejects(
        () => service.verifyReceipt(body.receiptId),
        (error) =>
          error instanceof KnoloPluginError && error.code === 'QUERY_INVALID'
      );
    }

    const support = workspace.cases.find((item) => item.id === 'support');
    const session = createKarSession({
      image: support.image,
      graph: support.graph,
    });
    const evaluation = evaluateKar(session, {
      proposition: support.proposition,
      plan: support.plan,
    });
    const verified = await call(client, 'knolo_kar_verify', {
      mountId: 'support',
      proposition: support.proposition,
      plan: support.plan,
      result: evaluation,
    });
    assert.equal(verified.structuredContent.ok, true);
    assert.equal(verified.structuredContent.code, 'VERIFIED');

    const tampered = JSON.parse(JSON.stringify(evaluation));
    tampered.certificate.roots.karRoot = flipDigest(
      tampered.certificate.roots.karRoot
    );
    const tamper = await call(client, 'knolo_kar_verify', {
      mountId: 'support',
      proposition: support.proposition,
      plan: support.plan,
      result: tampered,
    });
    assert.equal(tamper.structuredContent.ok, false);
    assert.equal(tamper.structuredContent.code, 'KAR_RESULT_MISMATCH');
    assert.equal(tamper.isError, undefined);

    const dossier = createKarDossier({
      image: support.image,
      graph: support.graph,
      plan: support.plan,
      proposition: support.proposition,
    });
    const markdown = renderKarDossier(dossier);
    assert.match(markdown, /Evidence requirements satisfied/);
    const dossierVerdict = await call(client, 'knolo_kar_verify', {
      mountId: 'support',
      proposition: support.proposition,
      plan: support.plan,
      dossier: {
        manifest: dossier.manifest,
        certificate: dossier.certificate,
        evaluation: dossier.evaluation,
        evidenceMarkdown: markdown,
      },
    });
    assert.equal(dossierVerdict.structuredContent.ok, true);
    const language = await call(client, 'knolo_kar_verify', {
      mountId: 'support',
      proposition: support.proposition,
      plan: support.plan,
      dossier: {
        manifest: dossier.manifest,
        certificate: dossier.certificate,
        evaluation: dossier.evaluation,
        evidenceMarkdown: markdown.replace(
          'Evidence requirements satisfied',
          'Claim proven'
        ),
      },
    });
    assert.equal(language.structuredContent.ok, false);
    assert.equal(language.structuredContent.code, 'KAR_RESULT_MISMATCH');

    const cortexSession = await createCortexSession({
      image: workspace.cortexImage.bytes,
    });
    const found = await askCortex(cortexSession, {
      question: 'valve',
      mode: 'find_relevant',
    });
    const cortex = await call(client, 'knolo_cortex_verify', {
      mountId: 'cortex-v5',
      answer: found,
    });
    assert.equal(cortex.structuredContent.ok, true);
    assert.equal(cortex.structuredContent.traceRoot, found.receipt.traceRoot);
    assert.match(
      cortex.structuredContent.statement,
      /does not mean the answer is true/
    );
    const tamperedTrace = structuredClone(found);
    tamperedTrace.answer.gaps.push({
      subquestion: found.question,
      reason: 'tampered',
    });
    const cortexTamper = await call(client, 'knolo_cortex_verify', {
      mountId: 'cortex-v5',
      question: 'valve',
      answer: tamperedTrace,
    });
    assert.equal(cortexTamper.structuredContent.ok, false);
    assert.ok(cortexTamper.structuredContent.receiptId);

    const before = (await readdir(path.join(root, 'audit'))).filter((name) =>
      name.startsWith('er_')
    ).length;
    const unpinned = await call(client, 'knolo_kar_evaluate', {
      mountId: 'notes',
      proposition: support.proposition,
      plan: support.plan,
    });
    assert.match(textOf(unpinned), /^IMAGE_UNAVAILABLE: /);
    assert.equal(unpinned.structuredContent, undefined);
    const after = (await readdir(path.join(root, 'audit'))).filter((name) =>
      name.startsWith('er_')
    ).length;
    assert.equal(after, before);

    const search = await call(client, 'knolo_search', {
      query: 'enterprise refunds',
    });
    assert.notEqual(search.isError, true);
    const queryReceipt = JSON.parse(
      await readFile(
        path.join(
          root,
          'audit',
          `${search.structuredContent.receipts[0].receiptId}.json`
        ),
        'utf8'
      )
    );
    assert.equal(queryReceipt.version, 'openclaw-knolo-query-v1');
    await service.verifyReceipt(search.structuredContent.receipts[0].receiptId);
  } finally {
    await client.close();
  }
});

test('KAR graph pins fail before the server connects', async () => {
  const hashed = await fixture();
  const graphPath = path.join(hashed.root, 'graph.json');
  await writeFile(graphPath, '{}\n');
  hashed.config.mounts[0].kar = {
    graphPath,
    graphSha256: 'ab'.repeat(32),
  };
  await assert.rejects(
    () => createKnoloMcp(hashed.config),
    (error) =>
      error instanceof KnoloPluginError &&
      error.code === 'IMAGE_INVALID' &&
      /SHA-256/.test(error.message)
  );

  const unbound = await fixture();
  const unboundPath = path.join(unbound.root, 'unbound.json');
  const unboundBytes = Buffer.from(
    `${JSON.stringify({
      version: 1,
      stateRoot: `sha256-${'ab'.repeat(32)}`,
      objectRoot: `sha256-${'cd'.repeat(32)}`,
      commitDigest: `sha256-${'ef'.repeat(32)}`,
      knowledgeRoot: `sha256-${'01'.repeat(32)}`,
      graph: { version: 1 },
    })}\n`
  );
  await writeFile(unboundPath, unboundBytes);
  unbound.config.mounts[0].kar = {
    graphPath: unboundPath,
    graphSha256: hash(unboundBytes),
  };
  await assert.rejects(
    () => createKnoloMcp(unbound.config),
    (error) =>
      error instanceof KnoloPluginError &&
      error.code === 'IMAGE_INVALID' &&
      /not bound to the pinned image/.test(error.message)
  );

  const denied = await fixture({
    policy: { version: 1, default: 'deny' },
  });
  const deniedGraph = path.join(denied.root, 'graph.json');
  await writeFile(deniedGraph, '{}\n');
  denied.config.mounts[0].kar = {
    graphPath: deniedGraph,
    graphSha256: hash(Buffer.from('{}\n')),
  };
  await assert.rejects(
    () => createKnoloMcp(denied.config),
    (error) =>
      error instanceof KnoloPluginError &&
      error.code === 'ACCESS_DENIED' &&
      /denies query access/.test(error.message)
  );

  const relative = await fixture();
  relative.config.mounts[0].kar = {
    graphPath: 'graph.json',
    graphSha256: 'ab'.repeat(32),
  };
  await assert.rejects(
    () => createKnoloMcp(relative.config),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );
});

test('oversized plans and a blocked audit directory return no result', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-mcp-kar-fail-'));
  const workspace = await buildKarWorkspace(root, ['support']);
  const support = workspace.cases[0];
  const { client } = await connected({
    agentId: 'mcp',
    auditDir: path.join(root, 'audit'),
    mounts: workspace.mounts.filter((mount) => mount.id === 'support'),
  });
  try {
    const huge = await call(client, 'knolo_kar_evaluate', {
      mountId: 'support',
      proposition: support.proposition,
      plan: { version: 1, note: 'x'.repeat(70_000) },
    });
    assert.match(textOf(huge), /^QUERY_INVALID: /);
    assert.equal(huge.structuredContent, undefined);
    const names = await readdir(path.join(root, 'audit')).catch(() => []);
    assert.equal(
      names.some((name) => name.startsWith('er_')),
      false
    );
    const bad = await call(client, 'knolo_kar_evaluate', {
      mountId: 'support',
      proposition: support.proposition,
      plan: { version: 1 },
    });
    assert.notEqual(bad.isError, true);
    assert.equal(bad.structuredContent.status, 'PLAN_INVALID');
    assert.equal(bad.structuredContent.code, 'KAR_PLAN_INVALID');
    assert.match(bad.structuredContent.receiptId, /^er_[a-f0-9]{24}$/);
  } finally {
    await client.close();
  }

  const blockedRoot = await mkdtemp(path.join(os.tmpdir(), 'knolo-mcp-audit-'));
  const blockedWorkspace = await buildKarWorkspace(blockedRoot, ['support']);
  const blocker = path.join(blockedRoot, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  const blocked = await connected({
    agentId: 'mcp',
    auditDir: path.join(blocker, 'audit'),
    mounts: blockedWorkspace.mounts.filter((mount) => mount.id === 'support'),
  });
  try {
    const failed = await call(blocked.client, 'knolo_kar_evaluate', {
      mountId: 'support',
      proposition: blockedWorkspace.cases[0].proposition,
      plan: blockedWorkspace.cases[0].plan,
    });
    assert.match(textOf(failed), /^AUDIT_UNAVAILABLE: /);
    assert.equal(failed.structuredContent, undefined);
  } finally {
    await blocked.client.close();
  }
});

test('runtime does not call fetch or node http', () => {
  assert.equal(networkCalls, 0);
});

function completeMessages(stdout) {
  const parts = stdout.split('\n');
  if (!stdout.endsWith('\n')) parts.pop();
  return parts
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function waitFor(read, predicate) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const found = read().find(predicate);
      if (found) return found;
    } catch {
      // A partial stdout chunk can land between reads. The next turn parses it.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for an MCP response');
}

function runUntilExit(args) {
  const child = spawn(process.execPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out\n${stderr}`));
    }, 8000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function stop(child) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
    }, 1000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
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

function karPlan(anchor, frontierMap, requirements, floors, patch = {}) {
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
    ...patch,
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

const oppositionSource = `format: ceg-source-1
concepts:
  customer:
    label: Customer
  cancellation:
    label: Cancellation
evidence:
  contract:
    source: contract.txt
relations:
  - from: customer
    type: prohibits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: contract
    requirements:
      - cancel-barred
requirements:
  - cancel-barred
`;

const qualificationSource = `format: ceg-source-1
concepts:
  office:
    label: Office
  record:
    label: Record
evidence:
  exception:
    source: exception.txt
relations:
  - from: office
    type: excepts
    to: record
bindings:
  - concept: record
    evidence: exception
    requirements:
      - litigation-hold
requirements:
  - litigation-hold
`;

const temporalSource = `format: ceg-source-1
concepts:
  office:
    label: Office
  window:
    label: Window
evidence:
  notice:
    source: notice.txt
relations:
  - from: office
    type: during
    to: window
bindings:
  - concept: window
    evidence: notice
    requirements:
      - in-force
    validFrom: 2026-01-01
requirements:
  - in-force
`;

const authoritySource = `format: ceg-source-1
concepts:
  office:
    label: Office
  ruling:
    label: Ruling
evidence:
  order:
    source: order.txt
relations:
  - from: office
    type: cites
    to: ruling
bindings:
  - concept: ruling
    evidence: order
    requirements:
      - cited-order
    authority: 90
requirements:
  - cited-order
`;

const supportDocs = [
  {
    source: 'policy.txt',
    text: 'The customer may cancel. This sentence is evidence for the plan.',
  },
];
const oppositionDocs = [
  {
    source: 'contract.txt',
    text: 'The customer may not cancel. This sentence is evidence for the plan.',
  },
];
const qualificationDocs = [
  {
    source: 'exception.txt',
    text: 'A litigation hold excepts destruction. This sentence is evidence for the plan.',
  },
];
const temporalDocs = [
  {
    source: 'notice.txt',
    text: 'The notice applies from 2026-01-01. This sentence is evidence for the plan.',
  },
];
const authorityDocs = [
  {
    source: 'order.txt',
    text: 'The signed order is authority 90. This sentence is evidence for the plan.',
  },
];

function karCases() {
  const searchPlan = karPlan(
    cegNodeId('customer'),
    { permits: 'F_S' },
    { F_S: ['cancel-allowed'] },
    { F_S: '1' }
  );
  searchPlan.bounds = { ...searchPlan.bounds, maxCoverVisits: 0 };
  const closurePlan = karPlan(
    cegNodeId('customer'),
    { permits: 'F_S' },
    { F_S: ['cancel-allowed'] },
    { F_S: '1' }
  );
  closurePlan.bounds = { ...closurePlan.bounds, maxClosureNodes: 0 };
  return [
    {
      id: 'support',
      actor: 'kar-v1-support',
      docs: supportDocs,
      source: supportSource,
      proposition: 'What evidence supports cancellation?',
      plan: karPlan(
        cegNodeId('customer'),
        { permits: 'F_S' },
        { F_S: ['cancel-allowed'] },
        { F_S: '1' }
      ),
    },
    {
      id: 'opposition',
      actor: 'kar-v1-opposition',
      docs: oppositionDocs,
      source: oppositionSource,
      proposition: 'What evidence opposes cancellation?',
      plan: karPlan(
        cegNodeId('customer'),
        { prohibits: 'F_O' },
        { F_O: ['cancel-barred'] },
        { F_O: '1' }
      ),
    },
    {
      id: 'qualification',
      actor: 'kar-v1-qualification',
      docs: qualificationDocs,
      source: qualificationSource,
      proposition: 'What evidence qualifies retention?',
      plan: karPlan(
        cegNodeId('office'),
        { excepts: 'F_Q' },
        { F_Q: ['litigation-hold'] },
        { F_Q: '1' }
      ),
    },
    {
      id: 'temporal',
      actor: 'kar-v1-temporal',
      docs: temporalDocs,
      source: temporalSource,
      proposition: 'What evidence is in force?',
      plan: karPlan(
        cegNodeId('office'),
        { during: 'F_T' },
        { F_T: ['in-force'] },
        { F_T: '1' }
      ),
    },
    {
      id: 'authority',
      actor: 'kar-v1-authority',
      docs: authorityDocs,
      source: authoritySource,
      proposition: 'What authority is cited?',
      plan: karPlan(
        cegNodeId('office'),
        { cites: 'F_A' },
        { F_A: ['cited-order'] },
        { F_A: '1' },
        { minAuthority: 50 }
      ),
    },
    {
      id: 'supplied-anchor',
      actor: 'kar-v1-supplied-anchor',
      docs: supportDocs,
      source: supportSource,
      proposition: 'Which supplied anchor admits the evidence?',
      plan: karPlan(
        cegNodeId('customer'),
        { permits: 'F_S' },
        { F_S: ['cancel-allowed'] },
        { F_S: '1' }
      ),
    },
    {
      id: 'abstention',
      actor: 'kar-v1-abstention',
      docs: supportDocs,
      source: supportSource,
      proposition: 'What evidence shows the missing permit?',
      plan: karPlan(
        cegNodeId('customer'),
        { permits: 'F_S' },
        { F_S: ['missing-permit'] },
        { F_S: '1' }
      ),
    },
    {
      id: 'search-bound',
      actor: 'kar-v1-search-bound',
      docs: supportDocs,
      source: supportSource,
      proposition: 'What evidence supports cancellation?',
      plan: searchPlan,
    },
    {
      id: 'closure-bound',
      actor: 'kar-v1-closure-bound',
      docs: supportDocs,
      source: supportSource,
      proposition: 'What evidence supports cancellation?',
      plan: closurePlan,
    },
    {
      id: 'anchor-rejected',
      actor: 'kar-v1-anchor-rejected',
      docs: supportDocs,
      source: supportSource,
      proposition: 'What evidence supports cancellation?',
      plan: karPlan(
        `sha256-${'ab'.repeat(32)}`,
        { permits: 'F_S' },
        { F_S: ['cancel-allowed'] },
        { F_S: '1' }
      ),
    },
  ];
}

function readerPolicy() {
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

async function writeImageMount(root, id, image, policy, graph) {
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

async function buildKarWorkspace(root, ids) {
  const policy = readerPolicy();
  const selected = karCases().filter(
    (item) => ids === undefined || ids.includes(item.id)
  );
  const cases = [];
  const mounts = [];
  for (const item of selected) {
    const image = createKnowledgeImageV5({
      actor: item.actor,
      sequence: 1,
      policy,
      objects: item.docs.map((document) => ({
        kind: 'chunk',
        bytes: encoder.encode(document.text),
        meta: { source: document.source },
      })),
    });
    const parsed = parseCegSource(item.source);
    if (!parsed.ok) {
      throw new Error(
        `${item.id} source ${JSON.stringify(parsed.diagnostics)}`
      );
    }
    const compiled = compileCegSource({
      source: parsed.source,
      image: image.bytes,
    });
    if (!compiled.ok) {
      throw new Error(
        `${item.id} compile ${JSON.stringify(compiled.diagnostics)}`
      );
    }
    mounts.push(
      await writeImageMount(root, item.id, image, policy, compiled.sidecar)
    );
    cases.push({ ...item, image, graph: compiled.sidecar });
  }
  if (ids === undefined) {
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
    mounts.push(await writeImageMount(root, 'cortex-v5', cortexImage, policy));
    const notes = createKnowledgeImageV5({
      policy,
      objects: defaultObjects(),
    });
    mounts.push(await writeImageMount(root, 'notes', notes, policy));
    return { mounts, cases, cortexImage };
  }
  return { mounts, cases, cortexImage: null };
}

function flipDigest(digest) {
  return `${digest.slice(0, -1)}${digest.endsWith('0') ? '1' : '0'}`;
}

function withoutDigest(receipt) {
  const body = { ...receipt };
  delete body.recordDigest;
  return body;
}

function stableJson(value) {
  return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) sorted[key] = canonicalizeValue(value[key]);
    }
    return sorted;
  }
  return value;
}
