import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(root, 'packages/core');
const cliDir = path.join(root, 'packages/cli');
const corePackage = JSON.parse(readFileSync(path.join(coreDir, 'package.json'), 'utf8'));
const cliPackage = JSON.parse(readFileSync(path.join(cliDir, 'package.json'), 'utf8'));
const runtimeText = readFileSync(path.join(coreDir, 'dist/index.js'), 'utf8');
const runtime = await import(pathToFileURL(path.join(coreDir, 'dist/index.js')).href);
const nodeRuntime = await import(pathToFileURL(path.join(coreDir, 'dist/node.js')).href);

for (const token of ['node:fs', 'node:path', 'node:crypto', 'fs/promises']) assert.equal(runtimeText.includes(token), false, `V5 runtime bundle contains Node-only specifier: ${token}`);
for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/node.js', 'dist/node.d.ts']) assert.equal(existsSync(path.join(coreDir, file)), true, `Missing public core artifact: ${file}`);
assert.equal(corePackage.exports['.'].import, './dist/index.js');
assert.equal(corePackage.exports['./node'].import, './dist/node.js');
assert.equal(cliPackage.bin.knolo, 'bin/knolo.mjs');
const cliPath = path.join(cliDir, 'bin/knolo.mjs');
assert.equal(existsSync(cliPath), true);
const cliText = readFileSync(cliPath, 'utf8');
assert.match(cliText, /'v5'/, 'CLI does not register the V5 command.');
assert.match(cliText, /cmdV5/, 'CLI does not expose the V5 command handler.');

const runtimeExports = [
  'createKnowledgeImageV5', 'mountKnowledgeImageV5', 'verifyKnowledgeImageV5',
  'queryKnowledgeImageV5', 'createKnowledgeQueryIndexV5', 'createKnowledgeQueryHistoryV5',
  'executeKnowledgeAgentRunV1', 'verifyKnowledgeRunAuthorityV5',
  'exchangeKnowledgeSyncImageOverTransportV5', 'inspectKnowledgeRuntimeV5',
  'verifyKnowledgeRuntimeDiagnosticsV5', 'inspectKnowledgeStudioManagementV5',
  'verifyKnowledgeStudioManagementV5',
];
for (const name of runtimeExports) assert.equal(typeof runtime[name] !== 'undefined', true, `Missing V5 runtime export: ${name}`);
for (const name of ['DurableKnowledgeImageStoreV5', 'DurableKnowledgeRunStoreV5', 'DurableKnowledgeQueryIndexStoreV5', 'DurableKnowledgeQueryHistoryStoreV5', 'DurableKnowledgeSyncReplayStoreV5']) assert.equal(typeof nodeRuntime[name], 'function', `Missing V5 Node export: ${name}`);

const specReadme = readFileSync(path.join(root, 'spec/README.md'), 'utf8');
const specDir = path.join(root, 'spec');
const indexedKips = [...specReadme.matchAll(/\| (KIP-\d{4}) \|/g)].map((match) => match[1]);
const specFiles = readdirSync(specDir);
assert.ok(indexedKips.length > 0, 'Specification index contains no KIPs.');
for (const kip of indexedKips) {
  assert.ok(specFiles.some((file) => file === `${kip}.md` || (file.startsWith(`${kip}-`) && file.endsWith('.md'))), `Missing contract file for ${kip}.`);
}

console.log('V5 release preflight passed: public exports, package artifacts, runtime separation, CLI entry point, and KIP coverage are valid.');

export const releasePreflightPassed = true;
