#!/usr/bin/env bash
# Install the packed RC tarballs in an empty project and exercise retrieval.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /tmp/knolo-v6-smoke-XXXX)
cd "$work"
core_tgz=$(npm pack "$root/packages/core" --pack-destination "$work" | tail -1)
cli_tgz=$(npm pack "$root/packages/cli" --pack-destination "$work" | tail -1)
npm init -y >/dev/null
npm install --no-fund --no-audit "$work/$core_tgz" "$work/$cli_tgz"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createKnowledgeImageV5, buildPack, mountPack, query, migrateV4ToV5, mountKnowledgeImageV5, queryKnowledgeImageV5 } from '@knolo/core';
import { createKarDossier, verifyKarDossier, renderKarDossier } from '@knolo/core/kar';
import { cegNodeId, compileCegSource, parseCegSource } from '@knolo/core/kar/authoring';

const legacy = await buildPack([{ id: 'smoke', text: 'The customer may cancel. This sentence is evidence for the plan.' }]);
const pack = await mountPack({ src: legacy });
assert.ok(query(pack, 'customer cancel').length > 0, 'lexical query returned no hits');
const migrated = await migrateV4ToV5(legacy);
const image = mountKnowledgeImageV5(migrated.image);
const hits = queryKnowledgeImageV5(image, 'FROM chunk SEARCH "customer" LIMIT 5');
assert.ok(hits.hits.length > 0, 'V5 lexical query returned no hits');

const fresh = createKnowledgeImageV5({
  actor: 'v6-rc-smoke',
  sequence: 1,
  objects: [{
    kind: 'chunk',
    bytes: new TextEncoder().encode('The customer may cancel. This sentence is evidence for the plan.'),
    meta: { source: 'policy.txt' },
  }],
});
const source = `format: ceg-source-1
concepts:
  customer:
    label: Customer
  cancellation:
    label: Cancellation
evidence:
  policy:
    source: policy.txt
relations:
  - from: customer
    type: permits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: policy
    requirements:
      - cancel-allowed
requirements:
  - cancel-allowed
`;
const parsed = parseCegSource(source);
assert.equal(parsed.ok, true);
const compiled = compileCegSource({ source: parsed.source, image: fresh.bytes });
assert.equal(compiled.ok, true);
const plan = {
  version: 1,
  anchor: { mode: 'supplied', witness: [{ nodeId: cegNodeId('customer'), queryTerm: 'evidence' }] },
  frontierMap: { permits: 'F_S' },
  depth: 2,
  cardinalityBound: 4,
  coverageMode: 'requirements',
  requirements: { F_S: ['cancel-allowed'], F_O: [], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
  profile: 'minimum-cover',
  asOf: '2026-06-01',
  minAuthority: null,
  bounds: {
    maxAnchorNodes: 4, maxClosureNodes: 8, maxClosureEdges: 8, maxFrontierEvidence: 4,
    maxRequirementsPerFrontier: 4, maxEvidenceBindings: 4, maxCoverVisits: 100,
  },
  lexical: null,
};
const proposition = 'What evidence supports cancellation?';
const dossier = createKarDossier({ image: fresh.bytes, graph: compiled.sidecar, plan, proposition });
assert.equal(dossier.status, 'SATISFIED');
assert.equal(dossier.statusStatement, 'Evidence requirements satisfied');
const verdict = verifyKarDossier({
  image: fresh.bytes,
  graph: compiled.sidecar,
  plan,
  proposition,
  manifest: dossier.manifest,
  certificate: dossier.certificate,
  evaluation: dossier.evaluation,
  evidenceMarkdown: renderKarDossier(dossier),
});
assert.equal(verdict.ok, true, verdict.code);
console.log('V6 RC install smoke passed');
JS
node node_modules/@knolo/cli/bin/knolo.mjs --version
echo "SMOKE_DIR $work"
