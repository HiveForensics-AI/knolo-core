import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../../dist/index.js';
import { bind, makeGraph, makeImage, makePlan } from '../../test/support.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTIERS = ['F_S', 'F_O', 'F_Q', 'F_T', 'F_A'];
const RELATION = { F_S: 'supports', F_O: 'prohibits', F_Q: 'qualifies', F_T: 'constrains', F_A: 'authorizes' };
const VISIT_LIMIT = 10000;

function combinationSum(candidates, cardinality) {
  const limit = Math.min(candidates, cardinality);
  let total = 0;
  let term = 1;
  for (let size = 0; size <= limit; size += 1) {
    if (size > 0) term = (term * (candidates - size + 1)) / size;
    total += term;
  }
  return total;
}

function evaluateCell({ name, candidates, requirementIds, frontiers, cardinality, assignment }) {
  const frontierNames = FRONTIERS.slice(0, frontiers);
  const planRequirements = { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] };
  requirementIds.forEach((id, index) => {
    planRequirements[frontierNames[index % frontierNames.length]].push(id);
  });
  const nodes = ['anchor'];
  const relations = [];
  const bindings = [];
  const rows = [];
  for (let index = 0; index < candidates; index += 1) {
    const id = `e${String(index).padStart(2, '0')}`;
    const node = `n${String(index).padStart(2, '0')}`;
    const owned = assignment(index, requirementIds, candidates);
    const frontier = frontierNames[requirementIds.indexOf(owned[0]) % frontierNames.length];
    nodes.push(node);
    relations.push({ id: `r${id}`, from: 'anchor', relation: RELATION[frontier], to: node });
    bindings.push(bind(`b${id}`, node, id, owned));
    rows.push({ id, text: `cover ${id}` });
  }
  const image = makeImage(rows);
  const graph = makeGraph(image.knowledgeRoot, { nodes, relations, bindings, note: name });
  const plan = makePlan({
    anchor: { mode: 'supplied', witness: [{ nodeId: 'anchor', queryTerm: 'cover' }] },
    frontierMap: { supports: 'F_S', prohibits: 'F_O', qualifies: 'F_Q', constrains: 'F_T', authorizes: 'F_A' },
    cardinalityBound: cardinality,
    requirements: planRequirements,
    floors: { F_S: '1', F_O: '1', F_Q: '1', F_T: '1', F_A: '1' },
    bounds: {
      ...makePlan({}).bounds,
      maxCoverVisits: VISIT_LIMIT,
      maxClosureNodes: candidates + 2,
      maxClosureEdges: candidates + 2,
      maxFrontierEvidence: candidates + 2,
      maxEvidenceBindings: candidates + 2,
      maxRequirementsPerFrontier: Math.max(8, requirementIds.length),
    },
  });
  const start = performance.now();
  const result = evaluate(image.image, graph, 'cover', plan);
  return {
    series: name,
    candidates,
    requirements: requirementIds.length,
    frontiers,
    cardinality,
    status: result.status,
    evidenceCount: result.evidenceIds.length,
    ms: performance.now() - start,
    combinationsThroughCardinality: combinationSum(candidates, cardinality),
  };
}

const shared = (index, requirementIds) => [requirementIds[index % requirementIds.length]];
const privateRequirements = (index, requirementIds) => [requirementIds[index]];

const rows = [];
const candidateCounts = [8, 12, 15, 18, 20];
const requirementCounts = [1, 2, 3, 5, 8];
const frontierCounts = [1, 2, 3, 5];
const cardinalities = [1, 2, 3, 4, 5];

for (const candidates of candidateCounts) {
  for (const requirements of requirementCounts) {
    for (const frontiers of frontierCounts) {
      if (frontiers > requirements) continue;
      for (const cardinality of cardinalities) {
        const requirementIds = Array.from({ length: requirements }, (_, index) => `r${index}`);
        rows.push(evaluateCell({
          name: 'shared-mask',
          candidates,
          requirementIds,
          frontiers,
          cardinality,
          assignment: shared,
        }));
      }
    }
  }
}

for (const candidates of candidateCounts) {
  for (const frontiers of frontierCounts) {
    if (frontiers > candidates) continue;
    for (const cardinality of [...cardinalities, candidates]) {
      const requirementIds = Array.from({ length: candidates }, (_, index) => `p${index}`);
      rows.push(evaluateCell({
        name: 'private-requirement',
        candidates,
        requirementIds,
        frontiers,
        cardinality,
        assignment: privateRequirements,
      }));
    }
  }
}

const boundRows = rows.filter((row) => row.status === 'SEARCH_BOUND_EXCEEDED');
const summary = {
  visitLimit: VISIT_LIMIT,
  profile: 'minimum-cover',
  cells: rows.length,
  searchBoundExceeded: boundRows.length,
  firstBound: boundRows[0] ?? null,
  bySeries: ['shared-mask', 'private-requirement'].map((series) => {
    const matching = rows.filter((row) => row.series === series);
    return {
      series,
      cells: matching.length,
      searchBoundExceeded: matching.filter((row) => row.status === 'SEARCH_BOUND_EXCEEDED').length,
      satisfied: matching.filter((row) => row.status === 'SATISFIED').length,
      unsatisfied: matching.filter((row) => row.status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS').length,
      other: matching.filter((row) => !['SEARCH_BOUND_EXCEEDED', 'SATISFIED', 'UNSATISFIED_EVIDENCE_REQUIREMENTS'].includes(row.status)).length,
    };
  }),
  privateBoundByCandidates: candidateCounts.map((candidates) => ({
    candidates,
    bound: rows.filter((row) => row.series === 'private-requirement' && row.candidates === candidates && row.status === 'SEARCH_BOUND_EXCEEDED').length,
    cells: rows.filter((row) => row.series === 'private-requirement' && row.candidates === candidates).length,
  })),
  rows,
};
fs.writeFileSync(path.join(here, 'cover-results.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ cells: summary.cells, searchBoundExceeded: summary.searchBoundExceeded, bySeries: summary.bySeries, privateBoundByCandidates: summary.privateBoundByCandidates, firstBound: summary.firstBound }, null, 2));
