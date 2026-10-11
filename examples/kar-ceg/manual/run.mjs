/**
 * Manual CEG authoring.
 * docs -> Knowledge Image -> knowledge.ceg.yaml -> knowledge.kar.json -> KAR.
 * Run from the repository root: node examples/kar-ceg/manual/run.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCegSource, parseCegSource } from '../../../packages/core/dist/experimental/kar/authoring/index.js';
import { chunkImage, evaluateCompiled, writeKarOutputs } from '../support.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const image = chunkImage('ceg-manual-example', [
  { source: 'policy.md', text: readFileSync(path.join(here, 'docs/policy.md'), 'utf8') },
  { source: 'contract.md', text: readFileSync(path.join(here, 'docs/contract.md'), 'utf8') },
]);
const parsed = parseCegSource(readFileSync(path.join(here, 'knowledge.ceg.yaml'), 'utf8'));
if (!parsed.ok) {
  console.log(JSON.stringify(parsed.diagnostics, null, 2));
  process.exit(1);
}
const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
if (!compiled.ok) {
  console.log(JSON.stringify(compiled.diagnostics, null, 2));
  process.exit(1);
}
writeKarOutputs(here, image, compiled);
const { result, verdict } = evaluateCompiled(image, compiled);
writeFileSync(path.join(here, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.status);
console.log(result.certificate.roots.semanticRoot);
console.log(verdict.ok ? 'VERIFIED' : verdict.code);
if (!verdict.ok || result.status !== 'SATISFIED') process.exit(1);
