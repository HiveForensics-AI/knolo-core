import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePack, loadQueries } from './evaluator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packPath = path.join(root, 'conformance/packs/verified-v4.knolo');
const queries = await loadQueries(path.join(root, 'conformance/queries/retrieval.jsonl'));
const output = await evaluatePack(await readFile(packPath), queries);
output.runtime = { name: 'typescript', version: process.version };
await mkdir(path.join(root, 'conformance/expected'), { recursive: true });
await writeFile(path.join(root, 'conformance/expected/retrieval-v4.0.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
