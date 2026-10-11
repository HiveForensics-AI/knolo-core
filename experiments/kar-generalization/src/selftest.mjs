/**
 * Canned checks for the generalization compiler. This does not call a model
 * and it does not score the benchmark.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { activate } from './activate.mjs';
import { semanticArtifactRoot } from './canonicalize.mjs';
import { artifactFromClaims, claimsFromModel, cleanAlias, sentenceGated } from './compile.mjs';

const BANNED = ['cancel', 'terminate', 'revoke', 'rescind', 'berth', 'reservation', 'irrevocable', 'occupied', 'lexicon.mjs', 'grandfathered'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function selfTestGeneralization(tokenize) {
  const source = readFileSync(path.join(import.meta.dirname, 'compile.mjs'), 'utf8')
    + readFileSync(path.join(import.meta.dirname, 'activate.mjs'), 'utf8');
  for (const banned of BANNED) {
    assert(!source.toLowerCase().includes(banned), `Compiler contains banned text ${banned}`);
  }
  assert(!source.includes('instance.query'), 'Compiler source names a query');
  assert(sentenceGated('The lantern stays lit for the whole vigil.'), 'Persistence sentence was not gated');
  assert(sentenceGated('Holders of the lantern from the north intake retain the former limit.'), 'Qualifier sentence was not gated');
  assert(!sentenceGated('Pallet row 0-1 lists barcode crates for outbound lane markers.'), 'Warehouse filler was gated');
  assert(cleanAlias('the thing', tokenize) === null, 'Generic alias survived cleaning');
  const parsed = claimsFromModel(JSON.stringify({
    claims: [{
      index: 0,
      entity: 'lantern',
      entityAliases: ['watch', 'a very long invented alias phrase here'],
      action: 'end',
      actionAliases: ['finish', 'thing'],
      relation: 'prohibits',
      polarity: 'negative',
    }],
  }), tokenize);
  assert(parsed?.length === 1, 'Parser missed a claim');
  assert(parsed[0].entityAliases.includes('watch'), 'Entity paraphrase was dropped');
  assert(!parsed[0].entityAliases.some((alias) => alias.split(' ').length > 3), 'Long alias survived');
  assert(!parsed[0].actionAliases.includes('thing'), 'Generic action alias survived');

  const artifact = artifactFromClaims([
    {
      id: 'c:d1:0:0',
      docId: 'd1',
      entity: 'lantern',
      action: 'end',
      relation: 'prohibits',
      entityAliases: ['lantern', 'watch'],
      actionAliases: ['end', 'finish'],
      surfaceEntity: ['lantern'],
      surfaceAction: ['end'],
    },
    {
      id: 'c:d2:0:0',
      docId: 'd2',
      entity: 'kiln',
      action: 'end',
      relation: 'prohibits',
      entityAliases: ['kiln'],
      actionAliases: ['end', 'finish'],
      surfaceEntity: ['kiln'],
      surfaceAction: ['end'],
    },
    {
      id: 'c:d3:0:0',
      docId: 'd3',
      entity: 'lamp',
      action: 'end',
      relation: 'qualifies',
      entityAliases: ['lamp', 'watch'],
      actionAliases: ['end'],
      surfaceEntity: ['lamp'],
      surfaceAction: ['end'],
    },
    {
      id: 'c:d4:0:0',
      docId: 'd4',
      entity: 'lantern',
      action: 'sleep',
      relation: 'qualifies',
      entityAliases: ['lantern'],
      actionAliases: ['sleep'],
      surfaceEntity: ['lantern'],
      surfaceAction: ['sleep'],
    },
  ]);
  const dual = activate('holder end watch', artifact, tokenize, {});
  assert(dual.frontiers.opposition.includes('d1'), 'Dual anchor missed the paraphrased prohibition');
  assert(!dual.frontiers.opposition.includes('d2'), 'Dual anchor included an unrelated prohibition');
  assert(dual.frontiers.qualifier.includes('d3'), 'Dual anchor missed the paraphrased qualifier');
  assert(!dual.frontiers.qualifier.includes('d4'), 'Dual anchor included a claim that missed the query');
  const stemmed = activate('holder ended watch', artifact, tokenize, {});
  assert(!stemmed.frontiers.opposition.includes('d1'), 'Unstemmed query matched a different inflection');
  const unrelated = activate('record the quarterly brine density log', artifact, tokenize, {});
  assert(unrelated.frontiers.opposition.length === 0 && unrelated.frontiers.qualifier.length === 0, 'Unrelated query activated a frontier');
  const actionOnly = activate('holder end watch', artifact, tokenize, { mode: 'action-only' });
  assert(actionOnly.frontiers.opposition.includes('d2'), 'Action-only mode failed to show the over-broad path');
  const surface = activate('holder end watch', artifact, tokenize, { paraphrases: false });
  assert(!surface.frontiers.opposition.includes('d1'), 'Surface-only mode used a paraphrase');
  const siblings = activate('holder end watch', artifact, tokenize, { mode: 'siblings' });
  assert(siblings.frontiers.opposition.includes('d1') && siblings.frontiers.qualifier.includes('d4'), 'Sibling mode missed a shared-concept claim');
  const first = semanticArtifactRoot(artifact);
  const second = semanticArtifactRoot(JSON.parse(first.canonical));
  assert(first.root === second.root, 'Canonical root changed across a reload');
}

const invoked = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (invoked) {
  const { pathToFileURL } = await import('node:url');
  const dist = process.env.KNOLO_DIST ?? '/tmp/knolo-kar-dist';
  const tokenize = (await import(pathToFileURL(`${dist}/tokenize.js`).href)).tokenize;
  selfTestGeneralization(tokenize);
  process.stdout.write('self-test ok\n');
}
