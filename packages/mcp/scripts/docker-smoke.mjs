import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, chmod, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const image = process.env.KNOLO_MCP_IMAGE ?? 'knolo-mcp:smoke';
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

function capture(command, args, stdioIn = 'ignore') {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: [stdioIn, 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function preparedFixture() {
  const core = path.join(rootDir, 'packages/core/dist/index.js');
  await access(core).catch(() => {
    throw new Error('Build @knolo/core before the Docker smoke.');
  });
  const prepared = await capture(process.execPath, [
    path.join(rootDir, 'examples/google_adk_python/prepare-fixture.mjs'),
  ]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const configPath = prepared.stdout.trim();
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const root = path.dirname(configPath);
  await chmod(root, 0o755);
  await chmod(configPath, 0o644);
  for (const mount of config.mounts) {
    await chmod(mount.path, 0o644);
    await chmod(mount.policyPath, 0o644);
  }
  await chmod(config.auditDir, 0o777);
  return { configPath, config, root, auditDir: config.auditDir };
}

function mountArgs(configPath, root, auditDir, auditMode) {
  return [
    'run',
    '-i',
    '--rm',
    '-e',
    `KNOLO_MCP_CONFIG=${configPath}`,
    '-v',
    `${root}:${root}:ro`,
    '-v',
    `${auditDir}:${auditDir}${auditMode === 'ro' ? ':ro' : ''}`,
    image,
  ];
}

async function connect(configPath, root, auditDir, auditMode) {
  const transport = new StdioClientTransport({
    command: 'docker',
    args: mountArgs(configPath, root, auditDir, auditMode),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'knolo-docker-smoke', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

function textOf(result) {
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

async function expectPinExit(fixture, name, mutate) {
  const config = structuredClone(fixture.config);
  mutate(config);
  const configPath = path.join(fixture.root, `${name}.json`);
  await writeFile(configPath, `${JSON.stringify(config)}\n`);
  const result = await capture(
    'docker',
    mountArgs(configPath, fixture.root, fixture.auditDir, 'rw'),
    'ignore'
  );
  assert.notEqual(result.code, 0, result.stderr);
  assert.equal(result.stderr.includes('serving stdio'), false, result.stderr);
  assert.match(result.stderr, /IMAGE_INVALID/);
}

const fixture = await preparedFixture();
const inspected = JSON.parse(
  (await capture('docker', ['image', 'inspect', image])).stdout
);
assert.equal(inspected[0].Config.ExposedPorts ?? null, null);
assert.equal(inspected[0].Config.User, 'knolo');
assert.deepEqual(inspected[0].Config.Entrypoint, [
  'node',
  'packages/mcp/bin/knolo-mcp.mjs',
]);

const uid = await capture('docker', [
  'run',
  '--rm',
  '--entrypoint',
  'id',
  image,
  '-u',
]);
assert.equal(uid.code, 0, uid.stderr);
assert.notEqual(uid.stdout.trim(), '0');

const client = await connect(
  fixture.configPath,
  fixture.root,
  fixture.auditDir,
  'rw'
);
try {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  for (const name of [
    'knolo_get',
    'knolo_search',
    'knolo_status',
    'knolo_verify',
  ]) {
    assert.equal(names.includes(name), true, names.join(','));
  }
  const search = await client.callTool({
    name: 'knolo_search',
    arguments: { query: 'enterprise refunds', limit: 4 },
  });
  assert.notEqual(search.isError, true, textOf(search));
  const body = search.structuredContent;
  assert.match(body.hits[0].excerpt, /Annual enterprise refunds/);
  assert.match(body.hits[0].receiptId, /^qr_/);
} finally {
  await client.close();
}

await expectPinExit(fixture, 'bad-hash', (config) => {
  config.mounts[0].sha256 = 'ab'.repeat(32);
});
await expectPinExit(fixture, 'bad-state-root', (config) => {
  config.mounts[0].stateRoot = `sha256-${'0'.repeat(64)}`;
});

const before = (await readdir(fixture.auditDir)).filter((name) =>
  name.startsWith('qr_')
).length;
const denied = await connect(
  fixture.configPath,
  fixture.root,
  fixture.auditDir,
  'ro'
);
try {
  const failed = await denied.callTool({
    name: 'knolo_search',
    arguments: { query: 'enterprise refunds' },
  });
  assert.equal(failed.isError, true);
  assert.match(textOf(failed), /^AUDIT_UNAVAILABLE: /);
  assert.equal(failed.structuredContent, undefined);
} finally {
  await denied.close();
}
const after = (await readdir(fixture.auditDir)).filter((name) =>
  name.startsWith('qr_')
).length;
assert.equal(after, before);
console.log(
  JSON.stringify({
    image,
    user: uid.stdout.trim(),
    exposedPorts: null,
    modelCalled: false,
  })
);
