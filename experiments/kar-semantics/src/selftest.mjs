/**
 * Synthetic checks for the frozen compiler. These sentences are not the benchmark.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileDocuments } from './compile.mjs';
import { activate } from './activate.mjs';
import { semanticArtifactRoot } from './canonicalize.mjs';

const BANS = ['non-terminable', 'irrevocable', 'grandfathered', 'cutoff', 'minimum annual', 'counterQuery', 'qualifierQuery', 'master subscription', 'twelve-month', 'kar-theory/fixtures'];
const COMPILER_FILES = ['lexicon.mjs', 'compile.mjs', 'activate.mjs', 'canonicalize.mjs', 's2.mjs'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function selfTestSemantics(tokenize) {
  for (const file of COMPILER_FILES) {
    const source = readFileSync(path.join(import.meta.dirname, file), 'utf8');
    const hits = BANS.filter((term) => source.includes(term));
    assert(hits.length === 0, `${file} contains withheld material: ${hits.join(', ')}`);
  }
  const docs = [
    { id: 'd1', heading: 'License note', text: 'The holder may cancel the license after the cooling period.', source: {} },
    { id: 'd2', heading: 'Season note', text: 'The patronage is non-revocable for the prepaid season.', source: {} },
    { id: 'd3', heading: 'Seal note', text: 'Cancellation is allowed except when the seal is present.', source: {} },
    { id: 'd4', heading: 'Inspection note', text: 'Closure is effective after the inspection and supersedes the prior note.', source: { validFrom: '2024-01-01' } },
    { id: 'd5', heading: 'Storm note', text: 'The gantry must not travel during a storm warning.', source: {} },
  ];
  const first = compileDocuments(docs, tokenize);
  const second = compileDocuments(docs, tokenize);
  const rootA = semanticArtifactRoot(first);
  const rootB = semanticArtifactRoot(second);
  assert(rootA.root === rootB.root, 'Canonical root changed between identical compiles');
  assert(rootA.canonical === rootB.canonical, 'Canonical bytes changed between identical compiles');
  const full = activate('can the holder cancel the license', first, tokenize, {});
  assert(full.frontiers.opposition.includes('d2'), `Alias path missed the prohibition: ${full.frontiers.opposition.join(',')}`);
  assert(full.frontiers.qualifier.includes('d3'), `Exception path missed the qualifier: ${full.frontiers.qualifier.join(',')}`);
  assert(full.frontiers.temporal.includes('d4'), `Temporal path missed the effective-date note: ${full.frontiers.temporal.join(',')}`);
  assert(!full.semanticIds.includes('d5'), 'Unrelated prohibition entered the cancel frontiers');
  const noAlias = activate('can the holder cancel the license', first, tokenize, { aliases: false });
  assert(noAlias.frontiers.opposition.includes('d2'), 'Reverse closure missed the prohibition after aliases were removed');
  const directOnly = activate('can the holder cancel the license', first, tokenize, { aliases: false, reverse: false });
  assert(!directOnly.frontiers.opposition.includes('d2'), 'Prohibition remained without aliases and without reverse traversal');
  const unrelated = activate('record the quarterly brine density log', first, tokenize, {});
  assert(unrelated.semanticIds.length === 0, `Unrelated query activated ${unrelated.semanticIds.join(',')}`);
  const noException = activate('can the holder cancel the license', first, tokenize, { exceptions: false });
  assert(!noException.frontiers.qualifier.includes('d3'), 'Exception ablation still returned the qualifier');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = process.env.KNOLO_DIST ?? '/tmp/knolo-kar-dist';
  const tokenizeModule = await import(pathToFileURL(path.join(dist, 'tokenize.js')).href);
  await selfTestSemantics(tokenizeModule.tokenize);
  console.log('self-test ok');
}
