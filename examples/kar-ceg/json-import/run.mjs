/**
 * Explicit JSON mapping. The mapping copies fields. It does not infer a schema.
 * Run from the repository root: node examples/kar-ceg/json-import/run.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileCegSource,
  emitCegSourceYaml,
  importJsonGraph,
} from '../../../packages/core/dist/experimental/kar/authoring/index.js';
import { chunkImage, evaluateCompiled, writeKarOutputs } from '../support.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const imported = importJsonGraph(
  JSON.parse(readFileSync(path.join(here, 'ontology.json'), 'utf8')),
  JSON.parse(readFileSync(path.join(here, 'mapping.json'), 'utf8')),
);
if (!imported.ok) {
  console.log(JSON.stringify(imported.diagnostics, null, 2));
  process.exit(1);
}
writeFileSync(path.join(here, 'knowledge.ceg.yaml'), emitCegSourceYaml(imported.source));
const image = chunkImage('ceg-json-example', [
  { source: 'policy.md', text: 'A guest may cancel a lodging reservation before the day of arrival.\n' },
  { source: 'contract.md', text: 'An enterprise customer may not cancel after the contract is signed.\n' },
]);
const compiled = compileCegSource({ source: imported.source, image: image.bytes });
if (!compiled.ok) {
  console.log(JSON.stringify(compiled.diagnostics, null, 2));
  process.exit(1);
}
writeKarOutputs(here, image, compiled);
const { result, verdict } = evaluateCompiled(image, compiled);
writeFileSync(path.join(here, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.status);
console.log(verdict.ok ? 'VERIFIED' : verdict.code);
if (!verdict.ok || result.status !== 'SATISFIED') process.exit(1);
