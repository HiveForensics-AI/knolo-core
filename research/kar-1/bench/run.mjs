import { writeFileSync } from 'node:fs';
import { evaluate } from '../dist/index.js';
import { bind, makeGraph, makeImage, makePlan } from '../test/support.mjs';

const rows = [];

function run(name, image, graph, query, plan, expect) {
  const result = evaluate(image, graph, query, plan);
  const again = evaluate(image, graph, query, plan);
  if (JSON.stringify(result.roots) !== JSON.stringify(again.roots)) {
    throw new Error(`${name} did not replay`);
  }
  if (result.status !== expect.status || JSON.stringify(result.evidenceIds) !== JSON.stringify(expect.evidenceIds)) {
    throw new Error(`${name} produced ${result.status} ${result.evidenceIds.join(',')} expected ${expect.status} ${expect.evidenceIds.join(',')}`);
  }
  rows.push({
    name,
    status: result.status,
    size: result.evidenceIds.length,
    evidence: result.evidenceIds.join(', ') || '—',
    frontiers: ['F_S', 'F_O', 'F_Q', 'F_T', 'F_A']
      .filter((label) => result.frontiers[label].length > 0)
      .map((label) => `${label}:${result.frontiers[label].join('+')}`)
      .join(' ') || '—',
  });
  return result;
}

const paired = makeImage([
  { id: 'opp', text: 'The lodging stays committed through the prepaid season.' },
  { id: 'support', text: 'A guest may end the lodging when asked.' },
]);
const pairedGraph = makeGraph(paired.knowledgeRoot, {
  nodes: ['lodging', 'end', 'permission'],
  relations: [
    { id: 'r-end', from: 'lodging', relation: 'prohibits', to: 'end' },
    { id: 'r-allow', from: 'lodging', relation: 'permits', to: 'permission' },
  ],
  bindings: [
    bind('b-end', 'end', 'opp', ['cancel-right']),
    bind('b-allow', 'permission', 'support', ['cancel-right']),
  ],
});
const pairedPlan = makePlan({
  anchor: { mode: 'supplied', witness: [{ nodeId: 'lodging', queryTerm: 'room' }] },
  frontierMap: { prohibits: 'F_O', permits: 'F_S', qualifies: 'F_Q' },
  requirements: { F_S: ['cancel-right'], F_O: ['cancel-right'], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '1', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
});
const grounded = run(
  'Supplied grounding room to lodging',
  paired.image,
  pairedGraph,
  'guest cancel room whenever asked',
  pairedPlan,
  { status: 'SATISFIED', evidenceIds: ['opp', 'support'] },
);

const duplicate = makeImage([
  { id: 'a-pass', text: 'first permission' },
  { id: 'b-pass', text: 'second permission' },
]);
run(
  'Same mask keeps the smaller evidence id',
  duplicate.image,
  makeGraph(duplicate.knowledgeRoot, {
    nodes: ['lodging', 'a', 'b'],
    relations: [
      { id: 'ra', from: 'lodging', relation: 'permits', to: 'a' },
      { id: 'rb', from: 'lodging', relation: 'permits', to: 'b' },
    ],
    bindings: [bind('ba', 'a', 'a-pass', ['cancel-right']), bind('bb', 'b', 'b-pass', ['cancel-right'])],
  }),
  'guest cancel room whenever asked',
  makePlan({
    anchor: { mode: 'supplied', witness: [{ nodeId: 'lodging', queryTerm: 'room' }] },
    frontierMap: { permits: 'F_S' },
    requirements: { F_S: ['cancel-right'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
  }),
  { status: 'SATISFIED', evidenceIds: ['a-pass'] },
);

run(
  'Missing opposition abstains',
  paired.image,
  makeGraph(paired.knowledgeRoot, {
    nodes: ['lodging', 'permission'],
    relations: [{ id: 'r-allow', from: 'lodging', relation: 'permits', to: 'permission' }],
    bindings: [bind('b-allow', 'permission', 'support', ['cancel-right'])],
  }),
  'guest cancel room whenever asked',
  pairedPlan,
  { status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS', evidenceIds: [] },
);

const expired = makeImage([{ id: 'old-opp', text: 'old prohibition' }, { id: 'support', text: 'current permission' }]);
run(
  'Expired opposition abstains',
  expired.image,
  makeGraph(expired.knowledgeRoot, {
    nodes: ['lodging', 'end', 'permission'],
    relations: [
      { id: 'r-end', from: 'lodging', relation: 'prohibits', to: 'end' },
      { id: 'r-allow', from: 'lodging', relation: 'permits', to: 'permission' },
    ],
    bindings: [
      bind('b-end', 'end', 'old-opp', ['cancel-right'], { validUntil: '2026-01-01' }),
      bind('b-allow', 'permission', 'support', ['cancel-right']),
    ],
  }),
  'guest cancel room whenever asked',
  pairedPlan,
  { status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS', evidenceIds: [] },
);

const weak = makeImage([{ id: 'weak-opp', text: 'low authority prohibition' }, { id: 'support', text: 'permission' }]);
run(
  'Authority below the plan minimum abstains',
  weak.image,
  makeGraph(weak.knowledgeRoot, {
    nodes: ['lodging', 'end', 'permission'],
    relations: [
      { id: 'r-end', from: 'lodging', relation: 'prohibits', to: 'end' },
      { id: 'r-allow', from: 'lodging', relation: 'permits', to: 'permission' },
    ],
    bindings: [
      bind('b-end', 'end', 'weak-opp', ['cancel-right'], { authority: 1 }),
      bind('b-allow', 'permission', 'support', ['cancel-right'], { authority: 5 }),
    ],
  }),
  'guest cancel room whenever asked',
  makePlan({ ...pairedPlan, minAuthority: 3 }),
  { status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS', evidenceIds: [] },
);

const qualified = makeImage([
  { id: 'opp', text: 'prohibition' },
  { id: 'qual', text: 'earlier cohort keeps a different limit' },
  { id: 'support', text: 'permission' },
]);
run(
  'Support, opposition, and qualification',
  qualified.image,
  makeGraph(qualified.knowledgeRoot, {
    nodes: ['lodging', 'end', 'limit', 'permission'],
    relations: [
      { id: 'r-end', from: 'lodging', relation: 'prohibits', to: 'end' },
      { id: 'r-q', from: 'lodging', relation: 'qualifies', to: 'limit' },
      { id: 'r-allow', from: 'lodging', relation: 'permits', to: 'permission' },
    ],
    bindings: [
      bind('b-end', 'end', 'opp', ['cancel-right']),
      bind('b-q', 'limit', 'qual', ['cohort']),
      bind('b-allow', 'permission', 'support', ['cancel-right']),
    ],
  }),
  'guest cancel room whenever asked',
  makePlan({
    ...pairedPlan,
    requirements: { F_S: ['cancel-right'], F_O: ['cancel-right'], F_Q: ['cohort'], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '1', F_Q: '1', F_T: '0', F_A: '0' },
  }),
  { status: 'SATISFIED', evidenceIds: ['opp', 'qual', 'support'] },
);

const hop = makeImage([
  { id: 'clause', text: 'the clause forbids cancellation' },
  { id: 'who', text: 'the customer the lodging applies to' },
]);
const hopGraph = makeGraph(hop.knowledgeRoot, {
  nodes: ['lodging', 'customer', 'clause'],
  relations: [
    { id: 'r-who', from: 'lodging', relation: 'applies_to', to: 'customer' },
    { id: 'r-no', from: 'customer', relation: 'contradicts', to: 'clause' },
  ],
  bindings: [
    bind('b-who', 'customer', 'who', ['applicability']),
    bind('b-clause', 'clause', 'clause', ['cancel-right']),
  ],
});
const hopPlan = {
  anchor: { mode: 'supplied', witness: [{ nodeId: 'lodging', queryTerm: 'room' }] },
  frontierMap: { applies_to: 'F_T', contradicts: 'F_O' },
  requirements: { F_S: [], F_O: ['cancel-right'], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '0', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
};
run('Depth 1 does not take the second hop', hop.image, hopGraph, 'guest cancel room whenever asked', makePlan({ ...hopPlan, depth: 1 }), {
  status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS',
  evidenceIds: [],
});
run('Depth 2 takes the contradicting hop', hop.image, hopGraph, 'guest cancel room whenever asked', makePlan({ ...hopPlan, depth: 2 }), {
  status: 'SATISFIED',
  evidenceIds: ['clause'],
});

const decoy = makeImage([
  { id: 'decoy', text: 'an unrelated kiln stays fired' },
  { id: 'opp', text: 'lodging prohibition' },
  { id: 'support', text: 'lodging permission' },
]);
run(
  'Unmapped decoy stays outside the frontiers',
  decoy.image,
  makeGraph(decoy.knowledgeRoot, {
    nodes: ['kiln', 'kiln-end', 'lodging', 'end', 'permission'],
    relations: [
      { id: 'r-decoy', from: 'kiln', relation: 'persists', to: 'kiln-end' },
      { id: 'r-end', from: 'lodging', relation: 'prohibits', to: 'end' },
      { id: 'r-allow', from: 'lodging', relation: 'permits', to: 'permission' },
    ],
    bindings: [
      bind('b-decoy', 'kiln-end', 'decoy', ['cancel-right']),
      bind('b-end', 'end', 'opp', ['cancel-right']),
      bind('b-allow', 'permission', 'support', ['cancel-right']),
    ],
  }),
  'guest cancel room whenever asked',
  pairedPlan,
  { status: 'SATISFIED', evidenceIds: ['opp', 'support'] },
);

run(
  'Zero floors are satisfied by the empty set',
  paired.image,
  pairedGraph,
  'guest cancel room whenever asked',
  makePlan({
    ...pairedPlan,
    floors: { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
  }),
  { status: 'SATISFIED', evidenceIds: [] },
);

let mismatches = 0;
for (let i = 0; i < 100; i += 1) {
  const repeated = evaluate(paired.image, pairedGraph, 'guest cancel room whenever asked', pairedPlan);
  if (repeated.roots.karRoot !== grounded.roots.karRoot) mismatches += 1;
}

const satisfied = rows.filter((row) => row.status === 'SATISFIED').length;
const abstained = rows.filter((row) => row.status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS').length;
const lines = [
  '# KAR-1 hand-authored evidence graphs',
  '',
  'This run uses committed graphs only. No compiler, model, or lexical ranker produced the edges. The reference implementation is `research/kar-1`.',
  '',
  `Cases: ${rows.length}. Satisfied: ${satisfied}. Unsatisfied requirements: ${abstained}. Replay mismatches on the grounding case, 100 repeats: ${mismatches}.`,
  '',
  '| Case | Status | \\|S*\\| | Evidence | Non-empty frontiers |',
  '| --- | --- | ---: | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.status} | ${row.size} | ${row.evidence} | ${row.frontiers} |`),
  '',
  'The query `guest cancel room whenever asked` does not contain the node id `lodging`. The plan supplies that grounding. KAR then closes `prohibits` and `permits` from the committed lodging node.',
  '',
  `Grounding certificate: \`${grounded.roots.karRoot}\`.`,
  '',
];
const report = `${lines.join('\n')}\n`;
writeFileSync(new URL('./REPORT.md', import.meta.url), report);
process.stdout.write(report);
