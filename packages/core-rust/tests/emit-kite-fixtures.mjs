/**
 * KITE world fixtures for the Rust replay.
 *
 *   node packages/core-rust/tests/emit-kite-fixtures.mjs
 *   node packages/core-rust/tests/emit-kite-fixtures.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKiteWorld } from '../../core/dist/kite/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, 'fixtures/kite-v1/cases.json');
const digest = `sha256-${'ab'.repeat(32)}`;

function obligation(id, kind, met) {
  return {
    id,
    kind,
    met,
    hitIds: met ? [`hit-${id}`] : [],
    sources: met ? [`${id}.md`] : [],
  };
}

function world(met, extra = {}) {
  return {
    format: 'knolo-kite-world-1',
    question: 'Can contractor A access production?',
    asOf: extra.asOf ?? null,
    stateRoot: digest,
    semanticRoot: extra.semanticRoot ?? null,
    obligations: [
      obligation('approval', 'evidence', met.includes('approval')),
      obligation('exception', 'qualification', met.includes('exception')),
      obligation('policy', 'authority', met.includes('policy')),
    ],
    rules: {
      format: 'knolo-kite-rules-1',
      proposition: 'contractor access',
      support: ['exception'],
      oppose: ['policy'],
      require: ['approval'],
      conflicts: [{ left: 'exception', right: 'policy' }],
      completeness: [
        { id: 'register', collection: 'approvals', obligationId: 'approval' },
      ],
    },
    completeness: extra.completeness ?? {
      format: 'knolo-kite-completeness-1',
      declarations: [],
    },
    changes: extra.changes ?? [],
    bounds: {
      maxGraphNodes: 5000,
      maxVariants: extra.maxVariants ?? 2048,
      maxCounterfactualChanges: extra.maxChanges ?? 2,
      maxRetrievals: 64,
    },
  };
}

const signed = {
  format: 'knolo-kite-completeness-1',
  declarations: [{ id: 'register', collection: 'approvals', signed: true }],
};

const cases = [
  ['undetermined', world(['policy', 'exception'])],
  ['explicit-refute', world(['policy'])],
  ['signed-absence', world([], { completeness: signed })],
  ['unsigned-gap', world([])],
  ['warranted', world(['exception', 'approval'], { completeness: signed })],
  [
    'flip',
    world(['exception', 'approval'], {
      completeness: signed,
      changes: [
        { id: 'retract-exception', kind: 'retract', obligationId: 'exception' },
      ],
    }),
  ],
  [
    'conflict',
    world(['policy', 'exception', 'approval'], { completeness: signed }),
  ],
  ['open-completeness', world(['exception', 'approval'])],
  [
    'bound',
    world(['policy'], {
      maxVariants: 1,
      changes: [
        { id: 'add-approval', kind: 'amend', obligationId: 'approval' },
        { id: 'drop-policy', kind: 'retract', obligationId: 'policy' },
      ],
    }),
  ],
  [
    'dated',
    world(['policy', 'exception'], {
      asOf: '2026-11-10',
      semanticRoot: digest,
    }),
  ],
].map(([id, input]) => {
  const derived = deriveKiteWorld(input);
  return {
    id,
    world: input,
    expected: {
      verdict: derived.verdict,
      baseWorld: derived.baseWorld,
      agrees: derived.agrees,
      witness: derived.witness,
      worldsChecked: derived.worldsChecked,
      variantsChecked: derived.variantsChecked,
      counterfactualChanges: derived.counterfactualChanges,
      invarianceRoot: derived.invarianceRoot,
      negativeCollections: derived.negativeCollections,
      obligationIds: derived.obligationIds,
      sourcePartitions: derived.sourcePartitions,
      met: input.obligations.filter((item) => item.met).map((item) => item.id),
      unmet: input.obligations
        .filter((item) => !item.met)
        .map((item) => item.id),
    },
  };
});

const body = `${JSON.stringify({ format: 'kite-replay-v1', cases }, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = readFileSync(outPath, 'utf8');
  if (current !== body) {
    throw new Error(
      'KITE Rust fixtures are stale. Regenerate emit-kite-fixtures.mjs.'
    );
  }
  console.log('KITE Rust fixtures match.');
} else {
  writeFileSync(outPath, body);
  console.log(`Wrote ${outPath}`);
}
