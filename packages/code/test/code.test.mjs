import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const sampleDir = path.join(rootDir, 'examples/sample');
const cliPath = path.join(rootDir, 'bin/knolo-code.mjs');
const toolNames = [
  'code_image_build',
  'code_image_expand',
  'code_image_query',
  'code_image_status',
  'code_image_structure',
];

const code = await import('../dist/index.js');

function bytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

async function tempSample() {
  const dir = await mkdirTemp();
  await cp(sampleDir, dir, { recursive: true });
  return dir;
}

async function mkdirTemp() {
  const dir = path.join(
    os.tmpdir(),
    `knolo-code-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

test('sample structure is under 30 percent of the route file', async () => {
  const dir = await tempSample();
  await mkdir(dir, { recursive: true });
  await cp(sampleDir, dir, { recursive: true });
  await code.buildCodeImage(dir);
  const structure = await code.codeImageStructure('routes.ts', dir);
  assert.equal(structure.ok, true);
  const file = await readFile(path.join(dir, 'routes.ts'));
  const ratio =
    code.estimateTokens(structure.chunks[0].text) /
    code.estimateTokens(file.toString('utf8'));
  assert.ok(ratio < 0.3, `structure ratio ${ratio}`);
  assert.equal(structure.chunks[0].text.includes('return notes'), false);
});

test('builds are byte-identical and queries replay', async () => {
  const dir = await tempSample();
  await mkdir(dir, { recursive: true });
  await cp(sampleDir, dir, { recursive: true });
  const first = await code.buildCodeImage(dir);
  const packPath = path.join(dir, '.knolo/workspace.knolo');
  const firstBytes = await readFile(packPath);
  const second = await code.buildCodeImage(dir);
  const secondBytes = await readFile(packPath);
  assert.equal(Buffer.compare(firstBytes, secondBytes), 0);
  assert.equal(first.packDigest, second.packDigest);
  assert.equal(first.fileSha256, second.fileSha256);
  const left = await code.codeImageQuery({
    root: dir,
    query: 'addRouteHandler',
    topK: 5,
  });
  const right = await code.codeImageQuery({
    root: dir,
    query: 'addRouteHandler',
    topK: 5,
  });
  assert.equal(left.ok, true);
  assert.equal(JSON.stringify(left), JSON.stringify(right));
  assert.equal(left.receipt.version, 'receipt-v1');
  assert.equal(left.receipt.verified, true);
  assert.equal(typeof left.receipt.replayHash, 'string');
  const hit = left.chunks.find((chunk) => chunk.name === 'addRouteHandler');
  assert.ok(hit);
  const digest = createHash('sha256')
    .update(`${hit.path}\n${hit.text}`, 'utf8')
    .digest('hex');
  const receiptHit = left.receipt.hits.find(
    (entry) => entry.sourceDigest === `sha256-${digest}`
  );
  assert.ok(receiptHit);
  assert.equal(networkCalls, 0);
});

test('a route-handler lookup stays at least 60 percent smaller than the sources', async () => {
  const dir = await tempSample();
  await mkdir(dir, { recursive: true });
  await cp(sampleDir, dir, { recursive: true });
  await code.buildCodeImage(dir);
  const structure = await code.codeImageStructure('routes.ts', dir);
  const queried = await code.codeImageQuery({
    root: dir,
    query: 'addRouteHandler',
    topK: 5,
  });
  assert.equal(structure.ok, true);
  assert.equal(queried.ok, true);
  const names = new Set(['types.ts', 'store.ts', 'routes.ts', 'handler.ts']);
  let sourceBytes = 0;
  for (const name of names) {
    sourceBytes += (await readFile(path.join(dir, name))).byteLength;
  }
  const returned = [...structure.chunks, ...queried.chunks]
    .map((chunk) => chunk.text)
    .join('');
  const savings = 1 - bytes(returned) / sourceBytes;
  assert.ok(savings >= 0.6, `savings ${savings}`);
  console.log(`code-image fixture savings ${(savings * 100).toFixed(1)}%`);
});

test('a flipped pack byte returns no chunk text', async () => {
  const dir = await tempSample();
  await mkdir(dir, { recursive: true });
  await cp(sampleDir, dir, { recursive: true });
  await code.buildCodeImage(dir);
  const packPath = path.join(dir, '.knolo/workspace.knolo');
  const packed = await readFile(packPath);
  packed[20] ^= 0xff;
  await writeFile(packPath, packed);
  const result = await code.codeImageQuery({
    root: dir,
    query: 'addRouteHandler',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'CODE_PIN_MISMATCH');
  assert.equal(JSON.stringify(result).includes('addRouteHandler'), false);
  assert.equal(JSON.stringify(result).includes('kept local note'), false);
});

test('a symlink outside the root is refused', async () => {
  const dir = await mkdirTemp();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'local.ts'),
    'export function localOnly() { return 1; }\n'
  );
  const outside = path.join(os.tmpdir(), `knolo-code-outside-${Date.now()}.ts`);
  await writeFile(outside, 'export const leaked = 1;\n');
  await symlink(outside, path.join(dir, 'leak.ts'));
  await assert.rejects(code.buildCodeImage(dir), (error) => {
    assert.equal(error.code, 'CODE_PATH_ESCAPE');
    return true;
  });
});

test('oversized files and chunk caps fail closed', async () => {
  const dir = await mkdirTemp();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'big.ts'), Buffer.alloc(256 * 1024 + 1, 10));
  await assert.rejects(code.buildCodeImage(dir), (error) => {
    assert.equal(error.code, 'CODE_FILE_TOO_LARGE');
    return true;
  });
  await writeFile(path.join(dir, 'big.ts'), 'export const small = 1;\n');
  const functions = Array.from(
    { length: 201 },
    (_, index) => `export function f${index}() { return ${index}; }`
  ).join('\n');
  await writeFile(path.join(dir, 'many.ts'), `${functions}\n`);
  await assert.rejects(code.buildCodeImage(dir), (error) => {
    assert.equal(error.code, 'CODE_TOO_MANY_CHUNKS');
    return true;
  });
});

test('python signatures omit function bodies', async () => {
  const dir = await mkdirTemp();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'box.py'),
    [
      'def outer():',
      '    return 1',
      '',
      'class Box:',
      '    @staticmethod',
      '    def open(self):',
      '        return 1',
      '',
    ].join('\n')
  );
  const chunks = await code.scanWorkspace(dir);
  const kinds = chunks
    .filter((chunk) => chunk.kind !== 'structure')
    .map((chunk) => `${chunk.kind}:${chunk.name}`)
    .sort();
  assert.deepEqual(kinds, ['class:Box', 'function:outer', 'method:open']);
  const structure = chunks.find((chunk) => chunk.kind === 'structure');
  assert.equal(structure.text.includes('return'), false);
  assert.equal(structure.text.includes('@staticmethod'), true);
  assert.equal(structure.text.includes('def open'), true);
});

test('python class scope survives blank lines', async () => {
  const dir = await mkdirTemp();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'box.py'),
    [
      'class Box:',
      '',
      '    def open(self):',
      '        return 1',
      '',
      '    def close(self):',
      '        return 2',
      '',
      'def outer():',
      '    return 3',
      '',
    ].join('\n')
  );
  const chunks = await code.scanWorkspace(dir);
  const kinds = chunks
    .filter((chunk) => chunk.kind !== 'structure')
    .map((chunk) => `${chunk.kind}:${chunk.name}`)
    .sort();
  assert.deepEqual(kinds, [
    'class:Box',
    'function:outer',
    'method:close',
    'method:open',
  ]);
});

test('structure signatures omit class and arrow bodies', async () => {
  const dir = await mkdirTemp();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'widget.ts'),
    [
      'export class Widget {',
      '  run() {',
      '    return "class-body-marker";',
      '  }',
      '  handler = () => {',
      '    return "field-arrow-marker";',
      '  };',
      '  static {',
      '    const hidden = "static-block-marker";',
      '    void hidden;',
      '  }',
      '}',
      'export const add = (value: number) => {',
      '  return "statement-arrow-marker";',
      '};',
      '',
    ].join('\n')
  );
  const chunks = await code.scanWorkspace(dir);
  const structure = chunks.find((chunk) => chunk.kind === 'structure');
  assert.equal(structure.text.includes('class-body-marker'), false);
  assert.equal(structure.text.includes('field-arrow-marker'), false);
  assert.equal(structure.text.includes('static-block-marker'), false);
  assert.equal(structure.text.includes('statement-arrow-marker'), false);
  assert.equal(structure.text.includes('class Widget'), true);
  assert.equal(structure.text.includes('run()'), true);
  assert.equal(structure.text.includes('export const add'), true);
  const classChunk = chunks.find((chunk) => chunk.kind === 'class');
  assert.equal(classChunk.text.includes('class-body-marker'), true);
});

test('jsx files are scanned', async () => {
  const dir = await mkdirTemp();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'view.jsx'),
    ['export function View() {', '  return "jsx-body-marker";', '}', ''].join(
      '\n'
    )
  );
  const chunks = await code.scanWorkspace(dir);
  const kinds = chunks
    .filter((chunk) => chunk.kind !== 'structure')
    .map((chunk) => `${chunk.kind}:${chunk.name}`);
  assert.deepEqual(kinds, ['function:View']);
  const structure = chunks.find((chunk) => chunk.kind === 'structure');
  assert.equal(structure.text.includes('jsx-body-marker'), false);
  assert.equal(structure.text.includes('function View'), true);
});

test('expand returns one verified range', async () => {
  const dir = await tempSample();
  await mkdir(dir, { recursive: true });
  await cp(sampleDir, dir, { recursive: true });
  await code.buildCodeImage(dir);
  const queried = await code.codeImageQuery({
    root: dir,
    query: 'addRouteHandler',
    topK: 5,
  });
  const hit = queried.chunks.find((chunk) => chunk.name === 'addRouteHandler');
  const expanded = await code.codeImageExpand({
    root: dir,
    chunkId: hit.id,
    start: 0,
    end: 6,
  });
  assert.equal(expanded.ok, true);
  assert.equal(expanded.chunks.length, 1);
  assert.equal(expanded.chunks[0].text, 'export');
  assert.equal(expanded.receipt.version, 'code-image-block-v1');
  assert.equal(expanded.receipt.packDigest, queried.packDigest);
});

test('mcp lists the code tools and answers one query', async () => {
  const [{ Client }, { InMemoryTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/server'),
  ]);
  const dir = await tempSample();
  await mkdir(dir, { recursive: true });
  await cp(sampleDir, dir, { recursive: true });
  const server = code.createCodeMcpServer();
  const client = new Client({ name: 'knolo-code-test', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [...toolNames].sort()
  );
  const built = await client.callTool({
    name: 'code_image_build',
    arguments: { root: dir },
  });
  assert.equal(built.isError, undefined);
  const queried = await client.callTool({
    name: 'code_image_query',
    arguments: { root: dir, query: 'addRouteHandler', topK: 5 },
  });
  const body = JSON.parse(queried.content[0].text);
  assert.equal(body.ok, true);
  assert.equal(body.receipt.version, 'receipt-v1');
  assert.ok(body.chunks.some((chunk) => chunk.name === 'addRouteHandler'));
  await client.close();
});

test('cli build and query print the same receipt version', async () => {
  const dir = await tempSample();
  await mkdir(dir, { recursive: true });
  await cp(sampleDir, dir, { recursive: true });
  const built = spawnSync(process.execPath, [cliPath, 'build', '--root', dir], {
    encoding: 'utf8',
  });
  assert.equal(built.status, 0, built.stderr);
  const queried = spawnSync(
    process.execPath,
    [cliPath, 'query', '--root', dir, 'addRouteHandler'],
    { encoding: 'utf8' }
  );
  assert.equal(queried.status, 0, queried.stderr);
  const body = JSON.parse(queried.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.receipt.version, 'receipt-v1');
});

test('plugin validate runs when grok is installed', () => {
  const grok = spawnSync('grok', ['plugin', 'validate', 'plugins/knolo-code'], {
    cwd: path.resolve(rootDir, '../..'),
    encoding: 'utf8',
  });
  if (grok.error && grok.error.code === 'ENOENT') {
    console.log('grok plugin validate skipped');
    return;
  }
  assert.equal(grok.status, 0, grok.stderr || grok.stdout);
});
