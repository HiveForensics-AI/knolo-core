import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const published = '@knolo/mcp@0.2.3';

test('goose extension is a stdio npx draft', () => {
  const text = readFileSync(
    path.join(packageRoot, 'listings/goose/extension.yaml'),
    'utf8'
  );
  assert.match(text, /^ {4}type: stdio$/m);
  assert.match(text, /^ {4}cmd: npx$/m);
  assert.match(
    text,
    new RegExp(published.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  assert.match(text, /--config/);
  assert.doesNotMatch(text, /\bsse\b/i);
  assert.doesNotMatch(text, /:\/\//);
});

test('cline logo is a 400 by 400 png', () => {
  const bytes = readFileSync(path.join(packageRoot, 'listings/cline/logo.png'));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(bytes.readUInt32BE(16), 400);
  assert.equal(bytes.readUInt32BE(20), 400);
});

test('awesome-mcp-servers entry matches the directory line', () => {
  const text = readFileSync(
    path.join(packageRoot, 'listings/awesome-mcp-servers.md'),
    'utf8'
  );
  const line =
    '- [HiveForensics-AI/knolo-core](https://github.com/HiveForensics-AI/knolo-core/tree/main/packages/mcp) 📇 🏠 🍎 🪟 🐧 - Read-only stdio search over a pinned local Knolo Knowledge Image (@knolo/mcp@0.2.3), with receipt ids from an integrity check.';
  assert.ok(text.includes(line));
  assert.equal(text.includes('glama.ai'), false);
  assert.match(text, /Knowledge & Memory/);
  assert.match(text, /separate pull request/);
});

const installDoc = readFileSync(
  path.join(packageRoot, 'llms-install.md'),
  'utf8'
);
const readme = readFileSync(path.join(packageRoot, 'README.md'), 'utf8');
const bannedInstallPhrases = [
  /skip (the )?pins?/i,
  /skip verification/i,
  /disable audit/i,
  /without (a )?pin/i,
];

test('cline install docs keep the published pins', () => {
  for (const text of [installDoc, readme]) {
    assert.match(text, /@knolo\/mcp@0\.2\.3/);
    assert.match(text, /@knolo\/cli@6\.2\.3/);
    for (const phrase of bannedInstallPhrases) {
      assert.doesNotMatch(text, phrase);
    }
  }
  assert.match(installDoc, /npx -y @knolo\/cli@6\.2\.3 verify /);
  assert.match(installDoc, /"command": "npx"/);
  const serverBlocks = installDoc.match(/```json[\s\S]*?```/g) ?? [];
  assert.equal(serverBlocks.length > 0, true);
  for (const block of serverBlocks) {
    assert.doesNotMatch(block, /https?:\/\//);
    assert.doesNotMatch(block, /"url"/);
  }
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  );
  assert.equal(manifest.files.includes('llms-install.md'), true);
  const installText = installDoc.replace(/\s+/g, ' ');
  assert.match(
    installText,
    /A receipt is an integrity check\. It does not mean a claim is proven\./
  );
  assert.match(
    installText,
    /`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met\. It does not mean a claim is proven\./
  );
  assert.match(installDoc, /Each kept search term is a whole word\./);
  assert.match(readme, /llms-install\.md/);
  assert.match(
    readme,
    /https:\/\/github\.com\/cline\/mcp-marketplace\/issues\/3696/
  );
});

test('documented pin commands search the fixture', async () => {
  const repoRoot = path.resolve(packageRoot, '../..');
  const destination = await mkdtemp(path.join(os.tmpdir(), 'knolo-cline-'));
  try {
    const prepared = await run(
      process.execPath,
      [
        path.join(repoRoot, 'examples/google_adk_python/prepare-fixture.mjs'),
        destination,
      ],
      repoRoot
    );
    assert.equal(prepared.code, 0, prepared.stderr);
    const configPath = prepared.stdout.trim().split('\n').at(-1);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const imagePath = config.mounts[0].path;
    const imageBytes = await readFile(imagePath);
    assert.equal(
      createHash('sha256').update(imageBytes).digest('hex'),
      config.mounts[0].sha256
    );

    const verified = await run(
      process.execPath,
      [path.join(repoRoot, 'packages/cli/bin/knolo.mjs'), 'verify', imagePath],
      repoRoot
    );
    assert.equal(verified.code, 0, verified.stderr);
    const verification = JSON.parse(verified.stdout);
    assert.equal(verification.verified, true);
    assert.equal(verification.stateRoot, config.mounts[0].stateRoot);

    const server = spawn(
      process.execPath,
      [path.join(packageRoot, 'bin/knolo-mcp.mjs'), '--config', configPath],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    const send = (message) => {
      server.stdin.write(`${JSON.stringify(message)}\n`);
    };
    try {
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'cline-install', version: '0.0.0' },
        },
      });
      const initialized = await waitFor(
        () => jsonLines(stdout),
        (message) => message.id === 1
      );
      assert.equal(initialized.result.serverInfo.name, 'knolo');
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'knolo_search',
          arguments: { query: 'enterprise refunds' },
        },
      });
      const searched = await waitFor(
        () => jsonLines(stdout),
        (message) => message.id === 2
      );
      assert.notEqual(searched.result.isError, true);
      const body = searched.result.structuredContent;
      assert.match(body.hits[0].excerpt, /Annual enterprise refunds/);
      assert.match(body.receipts[0].receiptId, /^qr_/);
      assert.equal(body.hits[0].stateRoot, verification.stateRoot);
    } finally {
      server.stdin.end();
      await stop(server);
    }
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
    }, 20000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function jsonLines(stdout) {
  const parts = stdout.split('\n');
  if (!stdout.endsWith('\n')) parts.pop();
  return parts
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function waitFor(read, predicate) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const found = read().find(predicate);
      if (found) return found;
    } catch {
      // A partial stdout chunk can land between reads.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for an MCP response');
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
