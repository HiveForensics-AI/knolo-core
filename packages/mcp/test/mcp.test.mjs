import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
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
