import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createKnowledgeImageV5,
  describeKnowledgeExchangeArtifactV1,
} from '../../core/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '../bin/knolo.mjs');
const NOW = 1_700_000_000_000;

test('exchange help lists the peer commands', async () => {
  const help = await runCli(['exchange', '--help']);
  assert.match(help.stdout, /knolo exchange serve/);
  assert.match(help.stdout, /knolo exchange pull/);
  assert.match(help.stdout, /knolo.lock.json/);
  await assert.rejects(
    () => runCli(['exchange', 'serve', '--nope']),
    /Unknown flag/
  );
});

test('two processes exchange a verified image without Hub or a lockfile', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'knolo-exchange-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tls = writeCert(root);
  const keys = await writeKeys(root);
  const store = path.join(root, 'store');
  const senderHome = path.join(root, 'home-a');
  const recipientHome = path.join(root, 'home-b');
  const senderConfig = path.join(root, 'sender.json');
  const recipientConfig = path.join(root, 'recipient.json');
  const bytes = createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('cli-handoff'),
        meta: {},
      },
    ],
  }).bytes;
  const described = describeKnowledgeExchangeArtifactV1(bytes);
  const imagePath = path.join(root, 'knowledge.knolo');
  writeFileSync(imagePath, bytes);
  writeFileSync(
    senderConfig,
    JSON.stringify(
      exchangeConfig({
        principal: 'agent-a',
        privateKey: keys['agent-a'],
        keyring: keys.keyring,
        cert: tls.cert,
        key: tls.key,
        store,
        peerName: 'agent-b',
        peerUrl: 'https://127.0.0.1:9',
        senders: ['agent-b'],
      })
    )
  );

  const serve = startServe(
    [
      'exchange',
      'serve',
      '--config',
      senderConfig,
      '--home',
      senderHome,
      '--now',
      String(NOW),
    ],
    senderHome
  );
  try {
    const url = await serve.url;
    const offered = await runCli(
      [
        'exchange',
        'offer',
        imagePath,
        '--to',
        'agent-b',
        '--config',
        senderConfig,
        '--now',
        String(NOW),
      ],
      senderHome
    );
    const offerId = offered.stdout.trim();
    assert.match(offerId, /^sha256-[0-9a-f]{64}$/);
    writeFileSync(
      recipientConfig,
      JSON.stringify(
        exchangeConfig({
          principal: 'agent-b',
          privateKey: keys['agent-b'],
          keyring: keys.keyring,
          cert: tls.cert,
          key: tls.key,
          store: path.join(root, 'recipient-store'),
          peerName: 'agent-a',
          peerUrl: url,
          senders: ['agent-a'],
        })
      )
    );
    const pulled = await runCli(
      [
        'exchange',
        'pull',
        offerId,
        '--from',
        'agent-a',
        '--config',
        recipientConfig,
        '--home',
        recipientHome,
        '--now',
        String(NOW),
      ],
      recipientHome
    );
    const fields = Object.fromEntries(
      pulled.stdout
        .trim()
        .split('\n')
        .map((line) => {
          const index = line.indexOf(':');
          return [line.slice(0, index), line.slice(index + 1).trim()];
        })
    );
    assert.equal(fields.sha256, described.sha256);
    assert.equal(fields.stateRoot, described.stateRoot);
    assert.equal(
      fields.cache,
      path.join(recipientHome, 'cache', 'sha256', `${described.sha256}.knolo`)
    );
    assert.deepEqual(readFileSync(fields.cache), Buffer.from(bytes));
    const inspected = await runCli(
      [
        'exchange',
        'inspect',
        fields.receipt,
        '--home',
        recipientHome,
        '--config',
        senderConfig,
        '--now',
        String(NOW),
      ],
      recipientHome
    );
    assert.match(inspected.stdout, /role: recipient/);
    assert.match(inspected.stdout, new RegExp(`sha256: ${described.sha256}`));
    assert.match(inspected.stdout, /verification: verified/);
    assert.match(inspected.stdout, /policy: receive/);
    const verified = JSON.parse(
      (await runCli(['verify', fields.cache], recipientHome)).stdout
    );
    assert.equal(verified.verified, true);
    assert.equal(verified.stateRoot, described.stateRoot);
    assert.equal(verified.format, 'v5-knowledge-image');
    const senderReceipts = await waitForFiles(
      path.join(senderHome, 'exchange', 'receipts'),
      '.cbor',
      1
    );
    const senderInspect = await runCli(
      [
        'exchange',
        'inspect',
        senderReceipts[0].replace(/\.cbor$/, ''),
        '--home',
        senderHome,
        '--config',
        senderConfig,
        '--now',
        String(NOW),
      ],
      senderHome
    );
    assert.match(senderInspect.stdout, /role: sender/);
    assert.match(senderInspect.stdout, /verification: verified/);
    await assert.rejects(
      () =>
        runCli(
          [
            'exchange',
            'pull',
            offerId,
            '--from',
            'agent-a',
            '--config',
            recipientConfig,
            '--home',
            recipientHome,
            '--now',
            String(NOW),
          ],
          recipientHome
        ),
      /replay/
    );
    assert.equal(
      existsSync(path.join(recipientHome, 'knolo.lock.json')),
      false
    );
    assert.equal(existsSync(path.join(senderHome, 'knolo.lock.json')), false);
    assert.equal(
      filesUnder(root).some((file) => file.endsWith('knolo.lock.json')),
      false
    );
  } finally {
    await serve.stop();
  }
});

function exchangeConfig({
  principal,
  privateKey,
  keyring,
  cert,
  key,
  store,
  peerName,
  peerUrl,
  senders,
}) {
  return {
    identity: {
      principal,
      keyId: `${principal}-1`,
      privateKeyPath: privateKey,
      keyringPath: keyring,
    },
    listen: '127.0.0.1:0',
    tls: { cert, key, ca: cert },
    store,
    peers: {
      [peerName]: { principal: peerName, keyId: `${peerName}-1`, url: peerUrl },
    },
    policy: {
      receive: {
        senders,
        kinds: ['knowledge-image'],
        maxBytes: 10_000_000,
        namespaces: [],
      },
      adopt: 'deny',
    },
  };
}

function writeCert(root) {
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
  return { cert: path.join(root, 'tls.crt'), key: path.join(root, 'tls.key') };
}

async function writeKeys(root) {
  const keys = {};
  const publicKeys = [];
  for (const principal of ['agent-a', 'agent-b']) {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ]);
    const pem = path.join(root, `${principal}.pem`);
    const pkcs8 = Buffer.from(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    );
    writeFileSync(
      pem,
      `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64')}\n-----END PRIVATE KEY-----\n`
    );
    keys[principal] = pem;
    publicKeys.push({
      principal,
      keyId: `${principal}-1`,
      publicKey: Buffer.from(
        await crypto.subtle.exportKey('raw', pair.publicKey)
      ).toString('base64'),
    });
  }
  const keyring = path.join(root, 'keyring.json');
  writeFileSync(
    keyring,
    JSON.stringify({
      keyringRoot: `sha256-${'ab'.repeat(32)}`,
      keys: publicKeys,
    })
  );
  keys.keyring = keyring;
  return keys;
}

function runCli(args, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        KNOLO_HOME: home ?? path.join(tmpdir(), 'knolo-exchange-unused'),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout));
    });
  });
}

function startServe(args, home) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: { ...process.env, KNOLO_HOME: home },
  });
  let stdout = '';
  let stderr = '';
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`serve timed out\n${stdout}\n${stderr}`)),
      15000
    );
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find((item) => item.startsWith('https://'));
      if (line) {
        clearTimeout(timer);
        resolve(line);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`serve exited ${code}\n${stdout}\n${stderr}`));
    });
  });
  return {
    url,
    async stop() {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 5000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
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
