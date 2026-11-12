import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  describeKnowledgeExchangeArtifactV1,
} from '@knolo/core';
import {
  adoptExchangeReceipt,
  evaluateReceivePolicy,
  exportExchangeDirectory,
  importExchangeDirectory,
  inspectExchangeReceipt,
  loadExchangeConfig,
  publishExchangeOffer,
  pullExchangeOffer,
  startExchangeServer,
} from '../dist/index.js';

const NOW = 1_700_000_000_000;
const KEYRING_ROOT = `sha256-${'ab'.repeat(32)}`;

let fixture;

test.before(async () => {
  fixture = await createFixture();
});

test.after(() => {
  if (fixture) rmSync(fixture.root, { recursive: true, force: true });
});

test('config stays on deny, https, and knowledge images', () => {
  const dir = path.join(fixture.root, 'config');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'exchange.json');
  writeFileSync(file, JSON.stringify(configDocument(dir, {})));
  const loaded = loadExchangeConfig(file);
  assert.equal(loaded.policy.adopt, 'deny');
  assert.equal(loaded.listen.port, 0);

  writeFileSync(
    file,
    JSON.stringify(
      configDocument(dir, {
        policy: { ...configDocument(dir, {}).policy, adopt: 'allow' },
      })
    )
  );
  assert.equal(loadExchangeConfig(file).policy.adopt, 'allow');

  writeFileSync(
    file,
    JSON.stringify(
      configDocument(dir, {
        policy: { ...configDocument(dir, {}).policy, adopt: 'later' },
      })
    )
  );
  assert.throws(() => loadExchangeConfig(file), /adopt must be allow or deny/);

  const skill = configDocument(dir, {});
  skill.policy.receive.kinds = ['knowledge-image', 'skill'];
  writeFileSync(file, JSON.stringify(skill));
  assert.throws(() => loadExchangeConfig(file), /knowledge-image/);

  const open = configDocument(dir, {});
  open.listen = '0.0.0.0:0';
  writeFileSync(file, JSON.stringify(open));
  assert.throws(() => loadExchangeConfig(file), /adminToken/);
  open.adminToken = 'local-admin';
  writeFileSync(file, JSON.stringify(open));
  assert.equal(loadExchangeConfig(file).adminToken, 'local-admin');

  const httpPeer = configDocument(dir, {});
  httpPeer.peers['agent-b'].url = 'http://127.0.0.1:9';
  writeFileSync(file, JSON.stringify(httpPeer));
  assert.throws(() => loadExchangeConfig(file), /https/);

  const renamed = configDocument(dir, {});
  renamed.peers['agent-b'].principal = 'agent-c';
  writeFileSync(file, JSON.stringify(renamed));
  assert.throws(() => loadExchangeConfig(file), /principal/);

  const nobody = configDocument(dir, {});
  nobody.policy.receive.senders = [];
  writeFileSync(file, JSON.stringify(nobody));
  assert.throws(() => loadExchangeConfig(file), /senders/);
});

test('a directory handoff caches a verified image and refuses a bad copy', async () => {
  const dir = path.join(fixture.root, 'filesystem');
  mkdirSync(dir, { recursive: true });
  const senderFile = path.join(dir, 'sender.json');
  writeFileSync(
    senderFile,
    JSON.stringify(
      hostConfig({
        principal: 'agent-a',
        peerName: 'agent-b',
        peerUrl: 'https://127.0.0.1:9',
        store: path.join(dir, 'sender-store'),
        senders: ['agent-b'],
        maxBytes: 10_000_000,
      })
    )
  );
  const recipientFile = path.join(dir, 'recipient.json');
  writeFileSync(
    recipientFile,
    JSON.stringify(
      hostConfig({
        principal: 'agent-b',
        peerName: 'agent-a',
        peerUrl: 'https://127.0.0.1:9',
        store: path.join(dir, 'recipient-store'),
        senders: ['agent-a'],
        maxBytes: 10_000_000,
      })
    )
  );
  const image = imageBytes('offline-contract');
  const imagePath = path.join(dir, 'knowledge.knolo');
  writeFileSync(imagePath, image);
  const exported = await exportExchangeDirectory(
    loadExchangeConfig(senderFile),
    {
      imagePath,
      to: 'agent-b',
      outDir: path.join(dir, 'handoff'),
      now: NOW,
    }
  );
  assert.equal(existsSync(path.join(exported.directory, 'offer.cbor')), true);
  assert.deepEqual(
    readFileSync(path.join(exported.directory, `${exported.sha256}.knolo`)),
    Buffer.from(image)
  );
  assert.equal(existsSync(path.join(dir, 'sender-store')), false);

  const home = path.join(dir, 'home');
  const imported = await importExchangeDirectory(
    loadExchangeConfig(recipientFile),
    { directory: exported.directory, now: NOW, homeDir: home }
  );
  assert.deepEqual(readFileSync(imported.cachePath), Buffer.from(image));
  assert.equal(imported.sha256, exported.sha256);
  assert.equal(imported.stateRoot, exported.stateRoot);
  assert.equal(existsSync(path.join(home, 'knolo.lock.json')), false);
  const receipt = await inspectExchangeReceipt(home, imported.receiptId);
  assert.equal(receipt.role, 'recipient');
  assert.equal(receipt.decision, 'accept');
  assert.equal(receipt.verification, 'verified');

  const flipped = path.join(dir, 'flipped');
  cpSync(exported.directory, flipped, { recursive: true });
  const flippedFile = path.join(flipped, `${exported.sha256}.knolo`);
  const flippedBytes = readFileSync(flippedFile);
  flippedBytes[flippedBytes.length - 1] ^= 0xff;
  writeFileSync(flippedFile, flippedBytes);
  const flippedHome = path.join(dir, 'flipped-home');
  await assert.rejects(
    () =>
      importExchangeDirectory(loadExchangeConfig(recipientFile), {
        directory: flipped,
        now: NOW,
        homeDir: flippedHome,
      }),
    /artifact digest mismatch/
  );
  assert.equal(existsSync(path.join(flippedHome, 'cache')), false);
  assert.equal(existsSync(path.join(flippedHome, 'exchange')), false);

  const mismatchFile = path.join(dir, 'mismatch.json');
  writeFileSync(
    mismatchFile,
    JSON.stringify(
      hostConfig({
        principal: 'agent-c',
        peerName: 'agent-a',
        peerUrl: 'https://127.0.0.1:9',
        store: path.join(dir, 'mismatch-store'),
        senders: ['agent-a'],
        maxBytes: 10_000_000,
      })
    )
  );
  const mismatchHome = path.join(dir, 'mismatch-home');
  await assert.rejects(
    () =>
      importExchangeDirectory(loadExchangeConfig(mismatchFile), {
        directory: exported.directory,
        now: NOW,
        homeDir: mismatchHome,
      }),
    /recipient mismatch/
  );
  assert.equal(existsSync(path.join(mismatchHome, 'cache')), false);
  assert.equal(existsSync(path.join(mismatchHome, 'exchange')), false);
});

test('adopt creates a store, fast-forwards, and refuses deny or divergence', async () => {
  const dir = path.join(fixture.root, 'adopt');
  mkdirSync(dir, { recursive: true });
  const sender = loadExchangeConfig(
    writeJson(
      path.join(dir, 'sender.json'),
      hostConfig({
        principal: 'agent-a',
        peerName: 'agent-b',
        peerUrl: 'https://127.0.0.1:9',
        store: path.join(dir, 'sender-store'),
        senders: ['agent-b'],
        maxBytes: 10_000_000,
      })
    )
  );
  const allowFile = writeJson(
    path.join(dir, 'allow.json'),
    hostConfig({
      principal: 'agent-b',
      peerName: 'agent-a',
      peerUrl: 'https://127.0.0.1:9',
      store: path.join(dir, 'allow-store'),
      senders: ['agent-a'],
      maxBytes: 10_000_000,
      adopt: 'allow',
    })
  );
  const denyFile = writeJson(
    path.join(dir, 'deny.json'),
    hostConfig({
      principal: 'agent-b',
      peerName: 'agent-a',
      peerUrl: 'https://127.0.0.1:9',
      store: path.join(dir, 'deny-store'),
      senders: ['agent-a'],
      maxBytes: 10_000_000,
    })
  );
  const allow = loadExchangeConfig(allowFile);
  const deny = loadExchangeConfig(denyFile);
  const base = createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('adopt-base'),
        meta: {},
      },
    ],
  });
  const child = createKnowledgeImageV5({
    baseImage: base,
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('adopt-child'),
        meta: {},
      },
    ],
  });
  const other = createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('adopt-other'),
        meta: {},
      },
    ],
  });

  async function handoff(image, label) {
    const imagePath = path.join(dir, `${label}.knolo`);
    writeFileSync(imagePath, image.bytes);
    const exported = await exportExchangeDirectory(sender, {
      imagePath,
      to: 'agent-b',
      outDir: path.join(dir, `${label}-out`),
      now: NOW,
    });
    const homeDir = path.join(dir, `${label}-home`);
    const imported = await importExchangeDirectory(allow, {
      directory: exported.directory,
      now: NOW,
      homeDir,
    });
    return {
      homeDir,
      receiptId: imported.receiptId,
      cachePath: imported.cachePath,
    };
  }

  const stores = path.join(dir, 'stores');
  const denied = await handoff(base, 'denied');
  const denyStore = path.join(stores, 'missing-parent', 'store.knolo');
  await assert.rejects(
    () =>
      adoptExchangeReceipt(deny, {
        receiptId: denied.receiptId,
        storePath: denyStore,
        homeDir: denied.homeDir,
        now: NOW,
      }),
    /adopt is deny/
  );
  assert.equal(existsSync(path.join(stores, 'missing-parent')), false);

  const skill = await handoff(base, 'skill');
  writeFileSync(skill.cachePath, Buffer.from('skill-archive'));
  const skillStore = path.join(stores, 'skill.knolo');
  await assert.rejects(
    () =>
      adoptExchangeReceipt(allow, {
        receiptId: skill.receiptId,
        storePath: skillStore,
        homeDir: skill.homeDir,
        now: NOW,
      }),
    /size mismatch|digest mismatch|failed to mount/
  );
  assert.equal(existsSync(skillStore), false);

  const created = await handoff(base, 'created');
  const createdStore = path.join(stores, 'created.knolo');
  const made = await adoptExchangeReceipt(allow, {
    receiptId: created.receiptId,
    storePath: createdStore,
    homeDir: created.homeDir,
    now: NOW,
  });
  assert.equal(made.relation, 'created');
  assert.equal(made.stateRoot, base.stateRoot);
  assert.deepEqual(readFileSync(createdStore), Buffer.from(base.bytes));
  const again = await adoptExchangeReceipt(allow, {
    receiptId: created.receiptId,
    storePath: createdStore,
    homeDir: created.homeDir,
    now: NOW,
  });
  assert.equal(again.relation, 'equal');
  assert.deepEqual(readFileSync(createdStore), Buffer.from(base.bytes));

  const ahead = await handoff(child, 'ahead');
  const aheadStore = path.join(stores, 'ahead.knolo');
  writeFileSync(aheadStore, base.bytes);
  const forwarded = await adoptExchangeReceipt(allow, {
    receiptId: ahead.receiptId,
    storePath: aheadStore,
    homeDir: ahead.homeDir,
    now: NOW,
  });
  assert.equal(forwarded.relation, 'remote-ahead');
  assert.equal(forwarded.stateRoot, child.stateRoot);
  assert.deepEqual(readFileSync(aheadStore), Buffer.from(child.bytes));

  const diverged = await handoff(other, 'diverged');
  const divergedStore = path.join(stores, 'diverged.knolo');
  writeFileSync(divergedStore, base.bytes);
  const before = readFileSync(divergedStore);
  await assert.rejects(
    () =>
      adoptExchangeReceipt(allow, {
        receiptId: diverged.receiptId,
        storePath: divergedStore,
        homeDir: diverged.homeDir,
        now: NOW,
      }),
    /diverged/
  );
  assert.deepEqual(readFileSync(divergedStore), before);
  assert.equal(
    describeKnowledgeExchangeArtifactV1(new Uint8Array(before)).stateRoot,
    base.stateRoot
  );

  const behind = await handoff(base, 'behind');
  const localStore = path.join(stores, 'local.knolo');
  writeFileSync(localStore, child.bytes);
  const beforeLocal = readFileSync(localStore);
  await assert.rejects(
    () =>
      adoptExchangeReceipt(allow, {
        receiptId: behind.receiptId,
        storePath: localStore,
        homeDir: behind.homeDir,
        now: NOW,
      }),
    /local-ahead/
  );
  assert.deepEqual(readFileSync(localStore), beforeLocal);
});

test('receive policy separates sender, size, and namespace', () => {
  const policy = {
    senders: ['agent-a'],
    kinds: ['knowledge-image'],
    maxBytes: 100,
    namespaces: ['contracts'],
  };
  const offer = {
    sender: 'agent-a',
    artifactKind: 'knowledge-image',
    sizeBytes: 40,
    namespace: 'contracts',
  };
  assert.equal(evaluateReceivePolicy(policy, offer).ok, true);
  assert.equal(
    evaluateReceivePolicy(policy, { ...offer, sender: 'agent-z' }).ok,
    false
  );
  assert.equal(
    evaluateReceivePolicy(policy, { ...offer, sizeBytes: 101 }).ok,
    false
  );
  assert.equal(
    evaluateReceivePolicy(policy, { ...offer, namespace: undefined }).ok,
    false
  );
  assert.equal(
    evaluateReceivePolicy(
      { ...policy, namespaces: [] },
      { ...offer, namespace: undefined }
    ).ok,
    true
  );
});

test('a warm cache skips a bad blob and a corrupt cache waits for a verified download', async () => {
  const started = await boot('cache-reuse');
  try {
    const image = imageBytes('cache-reuse');
    const first = await publish(started, image, 'first');
    const home = path.join(started.dir, 'recipient');
    const pulled = await pull(started, first, { home: 'recipient' });
    const second = await publish(started, image, 'second');
    assert.notEqual(second.offerId, first.offerId);
    writeFileSync(
      path.join(started.store, 'blobs', `${first.described.sha256}.knolo`),
      Buffer.from('garbage-blob')
    );
    const again = await pull(started, second, { home: 'recipient' });
    assert.equal(again.sha256, first.described.sha256);
    assert.notEqual(again.receiptId, pulled.receiptId);
    assert.deepEqual(
      readFileSync(
        path.join(home, 'cache', 'sha256', `${first.described.sha256}.knolo`)
      ),
      Buffer.from(image)
    );
    assert.equal(existsSync(path.join(home, 'knolo.lock.json')), false);
  } finally {
    await started.close();
  }

  const broken = await boot('cache-broken', { truncateAfter: 16 });
  try {
    const image = imageBytes('cache-broken');
    const offered = await publish(broken, image, 'broken');
    const cache = path.join(
      broken.dir,
      'broken-home',
      'cache',
      'sha256',
      `${offered.described.sha256}.knolo`
    );
    mkdirSync(path.dirname(cache), { recursive: true });
    const garbage = Buffer.from('corrupt-cache');
    writeFileSync(cache, garbage);
    await assert.rejects(
      () => pull(broken, offered, { home: 'broken-home' }),
      /interrupted/
    );
    assert.deepEqual(readFileSync(cache), garbage);
    assert.equal(
      existsSync(
        path.join(broken.dir, 'broken-home', 'exchange', 'offers.json')
      ),
      false
    );
  } finally {
    await broken.close();
  }

  const healed = await boot('cache-healed');
  try {
    const image = imageBytes('cache-healed');
    const offered = await publish(healed, image, 'healed');
    const cache = path.join(
      healed.dir,
      'healed-home',
      'cache',
      'sha256',
      `${offered.described.sha256}.knolo`
    );
    mkdirSync(path.dirname(cache), { recursive: true });
    writeFileSync(cache, Buffer.from('corrupt-cache'));
    const pulled = await pull(healed, offered, { home: 'healed-home' });
    assert.deepEqual(readFileSync(pulled.cachePath), Buffer.from(image));
    assert.equal(pulled.sha256, offered.described.sha256);
  } finally {
    await healed.close();
  }
});

test('two hosts exchange images, refuse bad offers, and keep digests apart', async () => {
  const started = await boot('exchange');
  try {
    const imageA = imageBytes('alpha-contract');
    const imageB = imageBytes('beta-contract');
    const imageC = imageBytes('gamma-contract');
    const offeredA = await publish(started, imageA, 'a');
    const offeredB = await publish(started, imageB, 'b');
    const offeredC = await publish(started, imageC, 'c');
    assert.equal(decisionCount(started), 0);

    await assert.rejects(
      () =>
        pull(started, offeredA, { home: 'deny-sender', senders: ['agent-z'] }),
      /policy denied/
    );
    await assert.rejects(
      () => pull(started, offeredA, { home: 'deny-size', maxBytes: 1 }),
      /policy denied/
    );
    await assert.rejects(
      () =>
        pull(started, offeredA, {
          home: 'deny-recipient',
          principal: 'agent-c',
          keyId: 'agent-c-1',
        }),
      /recipient mismatch/
    );
    await assert.rejects(
      () => pull(started, offeredA, { home: 'expired', now: NOW + 300_000 }),
      /validity window/
    );
    await assert.rejects(
      () => pull(started, offeredA, { home: 'revoked', revokeSender: true }),
      /revoked/
    );
    assert.equal(decisionCount(started), 0);
    assert.equal(
      existsSync(path.join(started.dir, 'deny-sender', 'cache')),
      false
    );
    assert.equal(
      existsSync(path.join(started.dir, 'deny-size', 'exchange', 'partial')),
      false
    );

    const pulledA = await pull(started, offeredA, { home: 'recipient' });
    const pulledB = await pull(started, offeredB, { home: 'recipient' });
    assert.deepEqual(readFileSync(pulledA.cachePath), Buffer.from(imageA));
    assert.deepEqual(readFileSync(pulledB.cachePath), Buffer.from(imageB));
    assert.equal(pulledA.sha256, offeredA.described.sha256);
    assert.equal(pulledA.stateRoot, offeredA.described.stateRoot);
    assert.notEqual(pulledA.sha256, pulledB.sha256);
    assert.equal(
      existsSync(path.join(started.dir, 'recipient', 'knolo.lock.json')),
      false
    );
    assert.equal(
      filesUnder(started.dir).some(
        (file) => path.basename(file) === 'knolo.lock.json'
      ),
      false
    );

    const receipt = await inspectExchangeReceipt(
      path.join(started.dir, 'recipient'),
      pulledA.receiptId,
      started.senderConfig,
      NOW
    );
    assert.equal(receipt.role, 'recipient');
    assert.equal(receipt.verification, 'verified');
    assert.equal(receipt.policy, 'receive');
    assert.equal(receipt.sha256, offeredA.described.sha256);
    assert.equal(receipt.stateRoot, offeredA.described.stateRoot);

    const senderReceipts = await waitForFiles(
      path.join(started.senderHome, 'exchange', 'receipts'),
      '.cbor',
      2
    );
    const senderReceipt = await inspectExchangeReceipt(
      started.senderHome,
      senderReceipts[0].replace(/\.cbor$/, ''),
      started.senderConfig,
      NOW
    );
    assert.equal(senderReceipt.role, 'sender');
    assert.equal(senderReceipt.verification, 'verified');
    assert.equal(senderReceipt.policy, 'serve');

    await assert.rejects(
      () => pull(started, offeredA, { home: 'recipient' }),
      /replay/
    );
    assert.deepEqual(readFileSync(pulledA.cachePath), Buffer.from(imageA));

    const blobPath = path.join(
      started.store,
      'blobs',
      `${offeredC.described.sha256}.knolo`
    );
    const tampered = readFileSync(blobPath);
    tampered[tampered.length - 1] ^= 0xff;
    writeFileSync(blobPath, tampered);
    const servedBefore = fileCount(path.join(started.store, 'served'));
    await assert.rejects(
      () => pull(started, offeredC, { home: 'tamper' }),
      /artifact digest mismatch/
    );
    assert.equal(existsSync(path.join(started.dir, 'tamper', 'cache')), false);
    assert.equal(
      existsSync(
        path.join(
          started.dir,
          'tamper',
          'exchange',
          'partial',
          `${offeredC.offerId}.part`
        )
      ),
      false
    );
    assert.equal(fileCount(path.join(started.store, 'served')), servedBefore);
  } finally {
    await started.close();
  }
});

test('a truncated download resumes from the partial and a range does not count as served', async () => {
  const started = await boot('resume', { truncateAfter: 48 });
  try {
    const bytes = imageBytes('r'.repeat(400));
    assert.ok(bytes.length > 48);
    const offered = await publish(started, bytes, 'resume');
    await assert.rejects(
      () => pull(started, offered, { home: 'recipient' }),
      /interrupted/
    );
    const partial = path.join(
      started.dir,
      'recipient',
      'exchange',
      'partial',
      `${offered.offerId}.part`
    );
    assert.deepEqual(readFileSync(partial), Buffer.from(bytes.subarray(0, 48)));
    assert.equal(
      existsSync(path.join(started.dir, 'recipient', 'cache')),
      false
    );
    assert.equal(fileCount(path.join(started.store, 'served')), 0);

    const decision = readFileSync(
      path.join(
        started.store,
        'decisions',
        readdirSync(path.join(started.store, 'decisions'))[0]
      )
    );
    const ca = readFileSync(fixture.cert);
    const slice = await httpsGet(
      `${started.server.url}/v1/blobs/${offered.described.sha256}`,
      {
        ca,
        headers: {
          range: 'bytes=10-20',
          'knolo-decision': decision.toString('base64url'),
        },
      }
    );
    assert.equal(slice.status, 206);
    assert.deepEqual(slice.body, Buffer.from(bytes.subarray(10, 21)));
    const cut = await httpsGet(
      `${started.server.url}/v1/blobs/${offered.described.sha256}`,
      {
        ca,
        headers: {
          range: 'bytes=0-',
          'knolo-decision': decision.toString('base64url'),
        },
      }
    );
    assert.equal(cut.status, 206);
    assert.equal(cut.body.length, 48);
    assert.equal(cut.headers['content-range'], `bytes 0-47/${bytes.length}`);
    assert.deepEqual(cut.body, Buffer.from(bytes.subarray(0, 48)));
    assert.equal(fileCount(path.join(started.store, 'served')), 0);

    await started.close();
    const resumed = await startExchangeServer(started.senderConfig, {
      homeDir: started.senderHome,
      now: () => NOW,
    });
    started.server = resumed;
    started.recipientConfig.peers['agent-a'].url = resumed.url;
    const pulled = await pull(started, offered, { home: 'recipient' });
    assert.deepEqual(readFileSync(pulled.cachePath), Buffer.from(bytes));
    assert.equal(pulled.stateRoot, offered.described.stateRoot);
    assert.equal(existsSync(partial), false);
    assert.equal(fileCount(path.join(started.store, 'served')), 0);
    assert.equal(
      existsSync(path.join(started.dir, 'recipient', 'knolo.lock.json')),
      false
    );
    await assert.rejects(
      () => pull(started, offered, { home: 'recipient' }),
      /replay/
    );
  } finally {
    await started.close();
  }
});

async function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'knolo-exchange-'));
  const cert = path.join(root, 'tls.crt');
  const key = path.join(root, 'tls.key');
  writeFileSync(
    path.join(root, 'san.cnf'),
    [
      '[req]',
      'distinguished_name = req_distinguished_name',
      'x509_extensions = v3_req',
      'prompt = no',
      '[req_distinguished_name]',
      'CN = localhost',
      '[v3_req]',
      'subjectAltName = DNS:localhost,IP:127.0.0.1',
      'basicConstraints = CA:FALSE',
      'keyUsage = digitalSignature,keyEncipherment',
      'extendedKeyUsage = serverAuth',
      '',
    ].join('\n')
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-days',
      '2',
      '-nodes',
      '-keyout',
      'tls.key',
      '-out',
      'tls.crt',
      '-config',
      'san.cnf',
      '-extensions',
      'v3_req',
    ],
    { cwd: root, stdio: 'pipe' }
  );
  const agents = ['agent-a', 'agent-b', 'agent-c'];
  const keys = {};
  const pems = {};
  for (const principal of agents) {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ]);
    const raw = Buffer.from(
      await crypto.subtle.exportKey('raw', pair.publicKey)
    );
    const pkcs8 = Buffer.from(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    );
    const pem = path.join(root, `${principal}.pem`);
    writeFileSync(
      pem,
      `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64')}\n-----END PRIVATE KEY-----\n`
    );
    keys[principal] = raw.toString('base64');
    pems[principal] = pem;
  }
  const keyring = path.join(root, 'keyring.json');
  writeFileSync(
    keyring,
    JSON.stringify({
      keyringRoot: KEYRING_ROOT,
      keys: agents.map((principal) => ({
        principal,
        keyId: `${principal}-1`,
        publicKey: keys[principal],
      })),
    })
  );
  return { root, cert, key, pems, keyring };
}

function configDocument(dir, overrides) {
  return {
    identity: {
      principal: 'agent-a',
      keyId: 'agent-a-1',
      privateKeyPath: path.join(dir, 'missing.pem'),
      keyringPath: path.join(dir, 'missing-keyring.json'),
    },
    listen: '127.0.0.1:0',
    tls: {
      cert: path.join(dir, 'tls.crt'),
      key: path.join(dir, 'tls.key'),
      ca: path.join(dir, 'tls.crt'),
    },
    store: path.join(dir, 'store'),
    peers: {
      'agent-b': {
        principal: 'agent-b',
        keyId: 'agent-b-1',
        url: 'https://127.0.0.1:9',
      },
    },
    policy: {
      receive: {
        senders: ['agent-b'],
        kinds: ['knowledge-image'],
        maxBytes: 1_000_000,
        namespaces: [],
      },
      adopt: 'deny',
    },
    ...overrides,
  };
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value));
  return file;
}

function hostConfig({
  principal,
  peerName,
  peerUrl,
  store,
  senders,
  maxBytes,
  adopt = 'deny',
}) {
  return {
    identity: {
      principal,
      keyId: `${principal}-1`,
      privateKeyPath: fixture.pems[principal],
      keyringPath: fixture.keyring,
    },
    listen: '127.0.0.1:0',
    tls: { cert: fixture.cert, key: fixture.key, ca: fixture.cert },
    store,
    peers: {
      [peerName]: { principal: peerName, keyId: `${peerName}-1`, url: peerUrl },
    },
    policy: {
      receive: {
        senders,
        kinds: ['knowledge-image'],
        maxBytes,
        namespaces: [],
      },
      adopt,
    },
  };
}

async function boot(name, options = {}) {
  const dir = path.join(fixture.root, name);
  mkdirSync(dir, { recursive: true });
  const store = path.join(dir, 'store');
  const senderHome = path.join(dir, 'home-sender');
  const senderFile = path.join(dir, 'sender.json');
  const senderBody = hostConfig({
    principal: 'agent-a',
    peerName: 'agent-b',
    peerUrl: 'https://127.0.0.1:9',
    store,
    senders: ['agent-b'],
    maxBytes: 10_000_000,
  });
  writeFileSync(senderFile, JSON.stringify(senderBody));
  const senderConfig = loadExchangeConfig(senderFile);
  let server = await startExchangeServer(senderConfig, {
    homeDir: senderHome,
    now: () => NOW,
    ...(options.truncateAfter === undefined
      ? {}
      : { truncateAfter: options.truncateAfter }),
  });
  const recipientFile = path.join(dir, 'recipient.json');
  const recipientBody = hostConfig({
    principal: 'agent-b',
    peerName: 'agent-a',
    peerUrl: server.url,
    store: path.join(dir, 'recipient-store'),
    senders: ['agent-a'],
    maxBytes: 10_000_000,
  });
  writeFileSync(recipientFile, JSON.stringify(recipientBody));
  const recipientConfig = loadExchangeConfig(recipientFile);
  return {
    dir,
    store,
    senderHome,
    senderConfig,
    recipientConfig,
    server,
    async close() {
      if (this.server) {
        const current = this.server;
        this.server = undefined;
        await current.close();
      }
    },
  };
}

function imageBytes(text) {
  return createKnowledgeImageV5({
    objects: [
      { kind: 'metadata', bytes: new TextEncoder().encode(text), meta: {} },
    ],
  }).bytes;
}

async function publish(started, bytes, label) {
  const imagePath = path.join(started.dir, `${label}.knolo`);
  writeFileSync(imagePath, bytes);
  const published = await publishExchangeOffer(started.senderConfig, {
    imagePath,
    to: 'agent-b',
    now: NOW,
  });
  return {
    ...published,
    described: describeKnowledgeExchangeArtifactV1(bytes),
    bytes,
  };
}

async function pull(started, offered, options) {
  const home = path.join(started.dir, options.home);
  mkdirSync(home, { recursive: true });
  const config = options.config ?? (await recipientFor(started, options));
  return pullExchangeOffer(config, {
    offerId: offered.offerId,
    from: 'agent-a',
    now: options.now ?? NOW,
    homeDir: home,
  });
}

async function recipientFor(started, options) {
  if (
    !options.senders &&
    !options.maxBytes &&
    !options.principal &&
    !options.revokeSender
  )
    return started.recipientConfig;
  const principal = options.principal ?? 'agent-b';
  const file = path.join(started.dir, `${options.home}.json`);
  let keyringPath = fixture.keyring;
  if (options.revokeSender) {
    keyringPath = path.join(started.dir, 'keyring-revoked.json');
    const keyring = JSON.parse(readFileSync(fixture.keyring, 'utf8'));
    for (const key of keyring.keys) {
      if (key.principal === 'agent-a') key.revokedAt = NOW;
    }
    writeFileSync(keyringPath, JSON.stringify(keyring));
  }
  const body = hostConfig({
    principal,
    peerName: 'agent-a',
    peerUrl: started.server.url,
    store: path.join(started.dir, `${options.home}-store`),
    senders: options.senders ?? ['agent-a'],
    maxBytes: options.maxBytes ?? 10_000_000,
  });
  body.identity.keyringPath = keyringPath;
  writeFileSync(file, JSON.stringify(body));
  return loadExchangeConfig(file);
}

function decisionCount(started) {
  return fileCount(path.join(started.store, 'decisions'));
}

function fileCount(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).length;
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

function httpsGet(url, { ca, headers }) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'GET',
        headers,
        ca,
        ...(isIP(target.hostname) ? {} : { servername: target.hostname }),
        agent: false,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitForFiles(dir, suffix, count) {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (existsSync(dir)) {
      const found = readdirSync(dir).filter((name) => name.endsWith(suffix));
      if (found.length >= count) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${suffix} files in ${dir}.`);
}
