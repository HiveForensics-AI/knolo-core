import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '@knolo/core';
import { KNOLO_SEARCH_DESCRIPTION } from '@knolo/tools';

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
    mountId: 'image',
    imagePath,
    sha256: overrides.sha256 ?? hash(image.bytes),
    stateRoot: image.stateRoot,
    policyPath,
    auditDir: overrides.auditDir ?? path.join(root, 'audit'),
    principal: overrides.principal ?? 'n8n:reader',
    query: overrides.query ?? 'refunds',
    limit: overrides.limit ?? 0,
    objectId: overrides.objectId ?? refunds.id,
    imageId: overrides.imageId ?? '',
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

async function receiptNames(auditDir) {
  try {
    return (await readdir(auditDir)).filter((name) =>
      /^qr_[a-f0-9]{24}\.json$/u.test(name)
    );
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
  ]) {
    const property = description.properties.find((item) => item.name === name);
    assert.equal(property.noDataExpression, true, name);
  }
  for (const name of ['query', 'limit', 'objectId', 'imageId']) {
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
