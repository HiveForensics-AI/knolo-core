import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const demoDir = path.join(repoRoot, 'examples/glama');
const binPath = fileURLToPath(new URL('../bin/knolo-mcp.mjs', import.meta.url));
const toolNames = ['knolo_search', 'knolo_get', 'knolo_verify', 'knolo_status'];

function jsonLines(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

function run(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
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
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr, child });
    });
    if (options.send) options.send(child);
  });
}

function waitFor(read, ready, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const found = read().find(ready);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for the server'));
      }
    }, 25);
  });
}

test('the Glama demo image matches its pins', async () => {
  const bytes = await readFile(path.join(demoDir, 'demo.v5'));
  const pins = JSON.parse(
    await readFile(path.join(demoDir, 'pins.json'), 'utf8')
  );
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pins.sha256);
  assert.match(pins.stateRoot, /^sha256-[a-f0-9]{64}$/);
});

test('the Glama start command lists the four read-only tools', async () => {
  const child = spawn(process.execPath, [path.join(demoDir, 'start.mjs')], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
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
  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'glama-demo', version: '0.0.0' },
      },
    });
    const initialized = await waitFor(
      () => jsonLines(stdout),
      (message) => message.id === 1,
      90000
    );
    assert.equal(initialized.result.serverInfo.name, 'knolo');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listed = await waitFor(
      () => jsonLines(stdout),
      (message) => message.id === 2,
      20000
    );
    const names = listed.result.tools.map((tool) => tool.name);
    for (const name of toolNames) {
      assert.equal(names.includes(name), true, name);
    }
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'knolo_search', arguments: { query: 'refunds' } },
    });
    const searched = await waitFor(
      () => jsonLines(stdout),
      (message) => message.id === 3,
      20000
    );
    assert.notEqual(searched.result.isError, true);
    assert.match(
      searched.result.structuredContent.hits[0].excerpt,
      /Annual enterprise refunds/
    );
    assert.match(
      searched.result.structuredContent.receipts[0].receiptId,
      /^qr_/
    );
  } catch (error) {
    process.stderr.write(stderr);
    throw error;
  } finally {
    child.stdin.end();
    child.kill();
  }
});

test('a start with no config still fails closed', async () => {
  const missing = await run([binPath]);
  assert.equal(missing.stdout, '');
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /QUERY_INVALID/);
});
