/**
 * ClaimGraph bootstrap, then a developer edit.
 * The importer copies `related` and does not invent prohibits.
 * Run from the repository root: node examples/kar-ceg/claim-import/run.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileCegSource,
  emitCegSourceYaml,
  importClaimGraph,
  parseCegSource,
  readImageClaimGraph,
} from '../../../packages/core/dist/experimental/kar/authoring/index.js';
import { chunkImage, evaluateCompiled, writeKarOutputs } from '../support.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const claim = JSON.parse(readFileSync(path.join(here, 'claim.json'), 'utf8'));
const image = chunkImage('ceg-claim-example', [
  { source: 'policy.md', text: 'A guest may cancel a lodging reservation before the day of arrival.\n' },
  { source: 'contract.md', text: 'An enterprise customer may not cancel after the contract is signed.\n' },
], [{
  kind: 'claims',
  bytes: encoder.encode(JSON.stringify(claim)),
  meta: { encoding: 'json' },
}]);
const read = readImageClaimGraph(image.bytes);
if (!read.ok) {
  console.log(JSON.stringify(read.diagnostics, null, 2));
  process.exit(1);
}
const imported = importClaimGraph(read.claim);
if (!imported.ok) {
  console.log(JSON.stringify(imported.diagnostics, null, 2));
  process.exit(1);
}
writeFileSync(path.join(here, 'imported.ceg.yaml'), emitCegSourceYaml(imported.source));
const importedText = JSON.stringify(imported.source);
if (importedText.includes('prohibits') || importedText.includes('permits') || imported.source.bindings.length !== 0) {
  console.log('importer invented semantics');
  process.exit(1);
}
if (!imported.source.relations.some((relation) => relation.type === 'related')) {
  console.log('importer dropped the claim predicate');
  process.exit(1);
}
const edited = parseCegSource(readFileSync(path.join(here, 'knowledge.ceg.yaml'), 'utf8'));
if (!edited.ok) {
  console.log(JSON.stringify(edited.diagnostics, null, 2));
  process.exit(1);
}
const compiled = compileCegSource({ source: edited.source, image: image.bytes });
if (!compiled.ok) {
  console.log(JSON.stringify(compiled.diagnostics, null, 2));
  process.exit(1);
}
writeKarOutputs(here, image, compiled);
const { result, verdict } = evaluateCompiled(image, compiled);
writeFileSync(path.join(here, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log('IMPORTED related');
console.log(result.status);
console.log(verdict.ok ? 'VERIFIED' : verdict.code);
if (!verdict.ok || result.status !== 'SATISFIED') process.exit(1);
