/**
 * CEG compiler scaling. Full rebuild only.
 * Does not write docs/kar/benchmarks.json.
 *
 *   node --expose-gc scripts/bench-ceg.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { openEvidenceCatalog } from '../dist/experimental/kar/authoring/catalog.js';
import { resolveEvidenceSelector } from '../dist/experimental/kar/authoring/catalog.js';
import {
  compileCegSource,
  lintCegSource,
  parseCegSource,
} from '../dist/experimental/kar/authoring/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '../../../docs/kar/ceg-benchmarks.json');
const sizes = [100, 1000, 10000, 50000, 100000];
const encoder = new TextEncoder();

function heap() {
  if (typeof global.gc === 'function') global.gc();
  return process.memoryUsage().heapUsed;
}

function sourceFor(count, evidenceId) {
  const concepts = {};
  const relations = [];
  const bindings = [];
  for (let index = 0; index < count; index += 1) {
    const name = `n${String(index).padStart(6, '0')}`;
    concepts[name] = { label: `Node ${index}` };
    if (index > 0) {
      const previous = `n${String(index - 1).padStart(6, '0')}`;
      relations.push({ from: previous, type: 'permits', to: name });
    }
    bindings.push({ concept: name, evidence: 'doc', requirements: ['req'], authority: index % 97 });
  }
  return {
    format: 'ceg-source-1',
    concepts,
    evidence: { doc: { objectId: evidenceId } },
    relations,
    bindings,
    requirements: ['req'],
  };
}

const image = createKnowledgeImageV5({
  actor: 'ceg-bench',
  sequence: 1,
  objects: [{ kind: 'chunk', bytes: encoder.encode('bench evidence'), meta: { source: 'bench.md' } }],
});
const opened = openEvidenceCatalog(image.bytes);
if (!opened.ok) throw new Error(JSON.stringify(opened.diagnostics));
const evidenceId = opened.catalog.objects[0].id;
const rows = [];

for (const count of sizes) {
  const source = sourceFor(count, evidenceId);
  const text = JSON.stringify(source);
  const parseStart = performance.now();
  const parsed = parseCegSource(text);
  const parseMs = performance.now() - parseStart;
  if (!parsed.ok) throw new Error(`parse ${count} ${JSON.stringify(parsed.diagnostics.slice(0, 3))}`);
  const beforeLint = heap();
  const lintStart = performance.now();
  lintCegSource(parsed.source, { catalog: opened.catalog });
  const lintMs = performance.now() - lintStart;
  const resolveStart = performance.now();
  const resolved = resolveEvidenceSelector(parsed.source.evidence.doc, opened.catalog, 'evidence.doc');
  const resolveMs = performance.now() - resolveStart;
  if (!resolved.ok) throw new Error(`resolve ${count}`);
  const beforeCompile = heap();
  const compileStart = performance.now();
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes, catalog: opened.catalog });
  const compileMs = performance.now() - compileStart;
  const afterCompile = heap();
  if (!compiled.ok) throw new Error(`compile ${count} ${JSON.stringify(compiled.diagnostics.slice(0, 3))}`);
  rows.push({
    nodes: count,
    relations: count - 1,
    bindings: count,
    sourceBytes: text.length,
    sidecarBytes: compiled.bytes.length,
    parseMs: Number(parseMs.toFixed(3)),
    lintMs: Number(lintMs.toFixed(3)),
    resolveMs: Number(resolveMs.toFixed(3)),
    compileMs: Number(compileMs.toFixed(3)),
    heapBeforeLint: beforeLint,
    heapBeforeCompile: beforeCompile,
    heapAfterCompile: afterCompile,
    semanticRoot: compiled.semanticRoot,
  });
  console.log(JSON.stringify(rows[rows.length - 1]));
}

const changed = sourceFor(50000, evidenceId);
const fullStart = performance.now();
const full = compileCegSource({ source: changed, image: image.bytes, catalog: opened.catalog });
const fullMs = performance.now() - fullStart;
changed.relations[0].type = 'prohibits';
const againStart = performance.now();
const again = compileCegSource({ source: changed, image: image.bytes, catalog: opened.catalog });
const againMs = performance.now() - againStart;
if (!full.ok || !again.ok) throw new Error('50k rebuild failed');
if (full.bytes === again.bytes) throw new Error('relation edit did not change the sidecar');

const report = {
  generated: '2026-10-10',
  compiler: 'ceg-source-1',
  note: 'compileMs includes lint, evidence resolution, id derivation, and canonical sidecar serialization. Rebuild is a full compile. Incremental compilation is not implemented.',
  rows,
  rebuild50k: {
    fullCompileMs: Number(fullMs.toFixed(3)),
    oneRelationFullRebuildMs: Number(againMs.toFixed(3)),
    semanticRootChanged: full.semanticRoot !== again.semanticRoot,
  },
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(outPath);
