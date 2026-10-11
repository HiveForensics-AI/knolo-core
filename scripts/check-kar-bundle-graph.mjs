/**
 * Walk the built ESM graph for the root entry and the public KAR entry.
 * Fail if a reachable file imports a Node builtin.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'packages/core/dist');
const nodeImport = /from\s+['"](node:[^'"]+|fs|path|crypto|os|child_process)['"]/g;

function walk(entry, seen = new Set()) {
  const absolute = path.resolve(entry);
  if (seen.has(absolute)) return [];
  seen.add(absolute);
  const text = readFileSync(absolute, 'utf8');
  const hits = [];
  for (const match of text.matchAll(nodeImport)) hits.push(`${path.relative(dist, absolute)} -> ${match[1]}`);
  const specifier = /from\s+['"](\.[^'"]+)['"]/g;
  for (const match of text.matchAll(specifier)) {
    let next = path.resolve(path.dirname(absolute), match[1]);
    if (!next.endsWith('.js')) next += '.js';
    hits.push(...walk(next, seen));
  }
  return hits;
}

const roots = ['index.js', 'kar/index.js', 'kar/authoring/index.js'].map((name) => path.join(dist, name));
const hits = roots.flatMap((entry) => walk(entry));
if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}
const rootText = readFileSync(path.join(dist, 'index.js'), 'utf8');
if (rootText.includes('experimental/kar') || rootText.includes('/kar/index')) {
  console.error('Root bundle references KAR.');
  process.exit(1);
}
console.log('KAR bundle graph has no Node builtin imports.');
