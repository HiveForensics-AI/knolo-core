import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '@knolo/core';
import { KnoloOpenClawService, KnoloPluginError } from '../dist/index.js';
import {
  callerFromToolContext,
  executeWithCurrentToolContext,
} from '../dist/tool_context.js';

const encoder = new TextEncoder();

async function fixture({
  objects = [
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
  ...config
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knolo-openclaw-'));
  const policy = {
    version: 1,
    default: 'deny',
    rules: [
      {
        effect: 'allow',
        action: 'query',
        principal: 'openclaw:support-agent',
        kind: 'chunk',
      },
      {
        effect: 'allow',
        action: 'read',
        principal: 'openclaw:support-agent',
        kind: 'chunk',
      },
    ],
  };
  const image = createKnowledgeImageV5({
    policy,
    objects,
  });
  const imagePath = path.join(root, 'support.v5');
  const policyPath = path.join(root, 'policy.json');
  await writeFile(imagePath, image.bytes);
  await writeFile(policyPath, JSON.stringify(policy));
  const service = await KnoloOpenClawService.create({
    mounts: [
      {
        id: 'support-policy',
        path: imagePath,
        sha256: hash(image.bytes),
        stateRoot: image.stateRoot,
        policyPath,
        agents: ['support-agent'],
        principal: 'openclaw:support-agent',
      },
    ],
    auditDir: path.join(root, 'audit'),
    maxExcerptBytes: 32,
    ...config,
  });
  return { root, image, imagePath, service };
}

function caller(agentId = 'support-agent') {
  return { agentId, runId: 'run-1', sessionId: 'session-1' };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('search, get, status, verification, and receipt replay use one pinned V5 image', async () => {
  const { image, service, root } = await fixture();
  const status = service.status(caller());
  assert.deepEqual(status, [
    {
      imageId: 'support-policy',
      stateRoot: image.stateRoot,
      source: 'local',
      status: 'ready',
    },
  ]);

  const result = await service.search(
    { query: 'enterprise refunds' },
    caller()
  );
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].imageId, 'support-policy');
  assert.equal(result.hits[0].stateRoot, image.stateRoot);
  assert.match(result.hits[0].excerpt, /Annual enterprise refunds/);
  assert.equal(
    result.hits[0].excerpt.length <
      'Annual enterprise refunds are available within 30 days.'.length,
    true
  );
  assert.equal(result.receipts.length, 1);
  await service.verifyReceipt(result.receipts[0].receiptId);
  const receiptPath = path.join(
    root,
    'audit',
    `${result.receipts[0].receiptId}.json`
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.stateRoot, image.stateRoot);
  assert.equal(receipt.returned[0].objectId, result.hits[0].objectId);

  const got = await service.get(
    {
      imageId: 'support-policy',
      objectId: result.hits[0].objectId,
      stateRoot: image.stateRoot,
    },
    caller()
  );
  assert.equal(got.content, result.hits[0].excerpt);
  assert.equal(got.stateRoot, image.stateRoot);
  const verification = await service.verify('support-policy', caller());
  assert.equal(verification[0].stateRoot, image.stateRoot);
  assert.equal(verification[0].valid, true);
});

test('mount identity, agent visibility, state roots, and audit tampering fail closed', async () => {
  const { image, imagePath, service, root } = await fixture();
  await assert.rejects(
    service.search({ query: 'refunds' }, caller('untrusted-agent')),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'ACCESS_DENIED'
  );
  const result = await service.search({ query: 'enterprise' }, caller());
  await assert.rejects(
    service.get(
      {
        imageId: 'support-policy',
        objectId: result.hits[0].objectId,
        stateRoot:
          'sha256-0000000000000000000000000000000000000000000000000000000000000000',
      },
      caller()
    ),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'STATE_ROOT_MISMATCH'
  );
  const receiptPath = path.join(
    root,
    'audit',
    `${result.receipts[0].receiptId}.json`
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  receipt.returned[0].end -= 1;
  await writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    service.verifyReceipt(result.receipts[0].receiptId),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );
  await writeFile(
    imagePath,
    image.bytes.map((value, index) => (index === 0 ? value ^ 0xff : value))
  );
  await assert.rejects(
    service.verifyReceipt(result.receipts[0].receiptId),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );
  await assert.rejects(
    service.verify('support-policy', caller()),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );
});

test('audit receipt retention removes the oldest receipts before writing', async () => {
  const { root, service } = await fixture({ maxAuditRecords: 1 });
  const first = await service.search({ query: 'enterprise' }, caller());
  const second = await service.search({ query: 'enterprise' }, caller());
  const files = await readdir(path.join(root, 'audit'));
  assert.deepEqual(files.filter((file) => file.endsWith('.json')).length, 1);
  await assert.rejects(
    service.verifyReceipt(first.receipts[0].receiptId),
    (error) => error instanceof KnoloPluginError && error.code === 'NOT_FOUND'
  );
  await service.verifyReceipt(second.receipts[0].receiptId);
});

test('invalid UTF-8 evidence and a byte range starting inside a code point fail closed', async () => {
  const invalid = await fixture({
    objects: [
      {
        kind: 'chunk',
        bytes: new Uint8Array([0x61, 0xff]),
        meta: { namespace: 'support' },
      },
    ],
  });
  await assert.rejects(
    invalid.service.get(
      {
        imageId: 'support-policy',
        objectId: invalid.image.objects[0].id,
        stateRoot: invalid.image.stateRoot,
      },
      caller()
    ),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );

  const multibyte = await fixture({
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode('éé'),
        meta: { namespace: 'support' },
      },
    ],
  });
  await assert.rejects(
    multibyte.service.get(
      {
        imageId: 'support-policy',
        objectId: multibyte.image.objects[0].id,
        stateRoot: multibyte.image.stateRoot,
        start: 1,
        end: 4,
      },
      caller()
    ),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'IMAGE_INVALID'
  );
});

test('an excerpt limit trims only a final incomplete UTF-8 code point', async () => {
  const { image, service } = await fixture({
    maxExcerptBytes: 3,
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode('éé'),
        meta: { namespace: 'support' },
      },
    ],
  });
  const result = await service.get(
    {
      imageId: 'support-policy',
      objectId: image.objects[0].id,
      stateRoot: image.stateRoot,
    },
    caller()
  );
  assert.equal(result.content, 'é');
  assert.equal(result.start, 0);
  assert.equal(result.end, 2);
});

test('tool factories use the host memory audience and recheck its authority', async () => {
  const checks = [];
  const context = {
    memoryAudience: { agentId: 'support-agent', sessionId: 'session-1' },
    assertInvocationCurrent: () => checks.push('invocation'),
    assertMemoryAudienceCurrent: () => checks.push('audience'),
  };
  assert.deepEqual(callerFromToolContext(context), {
    agentId: 'support-agent',
    sessionId: 'session-1',
  });
  assert.equal(callerFromToolContext({}), undefined);
  assert.equal(
    await executeWithCurrentToolContext(
      context,
      async () => 'protected result'
    ),
    'protected result'
  );
  assert.deepEqual(checks, [
    'invocation',
    'audience',
    'invocation',
    'audience',
  ]);
  await assert.rejects(
    executeWithCurrentToolContext(
      { memoryAudience: { agentId: 'support-agent' } },
      async () => 'unreachable'
    ),
    (error) =>
      error instanceof KnoloPluginError && error.code === 'ACCESS_DENIED'
  );
});

test('manifest requires auditDir to match the runtime schema', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8')
  );
  assert.equal(manifest.configSchema.required.includes('auditDir'), true);
});
