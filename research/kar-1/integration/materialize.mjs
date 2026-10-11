import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../dist/index.js';
import { createPilotImage, projectKnowledgeImage, runKar } from './adapter.mjs';
import { SCENARIOS, buildPlan } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixtureRoot = path.join(here, 'fixtures');

export function materializeScenario(spec) {
  const image = createPilotImage(spec.documents);
  const projection = projectKnowledgeImage(image);
  const byLabel = new Map(image.objects.map((object) => [object.meta.label, object]));
  for (const document of spec.documents) {
    if (!byLabel.has(document.label)) throw new Error(`missing object for ${document.label}`);
  }
  const graph = {
    version: 1,
    knowledgeRoot: projection.knowledgeRoot,
    provenance: { producer: 'hand', note: `kar-sidecar:${spec.id}` },
    nodes: spec.nodes.map((id) => ({ id })),
    relations: spec.relations.map((relation) => ({ ...relation })),
    bindings: spec.bindings.map((binding) => {
      const row = {
        id: binding.id,
        nodeId: binding.nodeId,
        evidenceId: byLabel.get(binding.evidence).id,
        requirements: [...binding.requirements],
      };
      if (binding.authority !== undefined) row.authority = binding.authority;
      if (binding.unauthorized === true) row.unauthorized = true;
      if (binding.validFrom !== undefined) row.validFrom = binding.validFrom;
      if (binding.validUntil !== undefined) row.validUntil = binding.validUntil;
      if (binding.provenance !== undefined) row.provenance = binding.provenance;
      return row;
    }),
  };
  const sidecar = {
    version: 1,
    kind: 'kar-committed-evidence-graph',
    semantics: 'kar-1-research-1',
    stateRoot: image.stateRoot,
    objectRoot: projection.objectRoot,
    commitDigest: projection.commitDigest,
    knowledgeRoot: projection.knowledgeRoot,
    graph,
  };
  return { spec, image, projection, byLabel, graph, sidecar };
}

export function selectedIds(built, selection) {
  const ids = selection.labels.map((label) => built.byLabel.get(label).id);
  if (selection.kind === 'lex-min') return ids.sort()[0] ? [ids.sort()[0]] : [];
  return [...ids].sort();
}

export function frontierIds(built, frontiers) {
  return {
    F_S: frontiers.F_S.map((label) => built.byLabel.get(label).id).sort(),
    F_O: frontiers.F_O.map((label) => built.byLabel.get(label).id).sort(),
    F_Q: frontiers.F_Q.map((label) => built.byLabel.get(label).id).sort(),
    F_T: frontiers.F_T.map((label) => built.byLabel.get(label).id).sort(),
    F_A: frontiers.F_A.map((label) => built.byLabel.get(label).id).sort(),
  };
}

export function runScenarioCase(built, caseSpec) {
  const plan = buildPlan(built.spec, caseSpec.patch);
  const envelope = runKar(built.image.bytes, built.sidecar, built.spec.query, plan);
  return { plan, envelope };
}

export function normalizedCase(built, caseSpec, plan, envelope) {
  return {
    name: caseSpec.name,
    scenario: built.spec.id,
    image: built.projection.image,
    graph: built.graph,
    query: built.spec.query,
    plan,
    stateRoot: built.image.stateRoot,
    status: envelope.kar.status,
    evidenceIds: envelope.kar.evidenceIds,
    choices: envelope.kar.choices,
    frontiers: envelope.kar.frontiers,
    witnesses: envelope.kar.witnesses,
    decision: envelope.kar.decision,
    roots: envelope.kar.roots,
  };
}

export function writeFixtures(scenarios = SCENARIOS) {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const normalizedDir = path.join(fixtureRoot, 'normalized');
  fs.mkdirSync(normalizedDir, { recursive: true });
  const written = [];
  for (const spec of scenarios) {
    const built = materializeScenario(spec);
    const dir = path.join(fixtureRoot, spec.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'knowledge.knolo'), built.image.bytes);
    fs.writeFileSync(path.join(dir, 'knowledge.kar.json'), `${JSON.stringify(built.sidecar, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'query.txt'), `${spec.query}\n`);
    for (const caseSpec of spec.cases) {
      const { plan, envelope } = runScenarioCase(built, caseSpec);
      const record = normalizedCase(built, caseSpec, plan, envelope);
      fs.writeFileSync(path.join(normalizedDir, `${caseSpec.name}.json`), `${JSON.stringify(record, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, `${caseSpec.name}.plan.json`), `${JSON.stringify(plan, null, 2)}\n`);
      written.push({ built, caseSpec, plan, envelope, record, canonical: canonicalize(envelope.kar) });
    }
  }
  return written;
}
