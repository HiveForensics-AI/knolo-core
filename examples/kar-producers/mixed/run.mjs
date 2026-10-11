import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../../../packages/core/dist/index.js';
import { loadDomainDirectory } from '../../../packages/cli/bin/kar-produce.mjs';
import {
  compileCegSource,
  emitCegSourceYaml,
  instantiatePlanTemplate,
  mergeProducerFragments,
  runOntologyProducer,
  runRuleProducer,
} from '../../../packages/core/dist/experimental/kar/authoring/index.js';
import { createKarSession, evaluateKar, verifyKar } from '../../../packages/core/dist/experimental/kar/index.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../..');
const authoring = await import('../../../packages/core/dist/experimental/kar/authoring/index.js');
const encoder = new TextEncoder();
const documents = [
  { source: 'terms.md', text: 'The agreement may terminate after notice.\n' },
  { source: 'schedule.md', text: 'Opposition record T-14.\n' },
  { source: 'note.md', text: 'Qualification record Q-3.\n' },
];
const image = createKnowledgeImageV5({
  actor: 'kar-producers-mixed',
  sequence: 1,
  objects: documents.map((document) => ({
    kind: 'chunk',
    bytes: encoder.encode(document.text),
    meta: { source: document.source, type: 'contract' },
  })),
});
const bySource = new Map(image.objects.map((object) => [object.meta.source, object.id]));
const loaded = loadDomainDirectory(authoring, path.join(repo, 'domains/contracts'));
if (!loaded.ok) throw new Error(loaded.diagnostics.map((item) => item.code).join(','));
const rules = runRuleProducer({ pack: loaded.pack, image: image.bytes });
if (!rules.ok) throw new Error(rules.diagnostics.map((item) => item.code).join(','));
const schedule = bySource.get('schedule.md');
const note = bySource.get('note.md');
const ontology = runOntologyProducer({
  ontology: {
    nodes: [{ id: 'agreement', label: 'Agreement' }, { id: 'termination', label: 'Termination' }],
    edges: [{ from: 'agreement', type: 'prohibits', to: 'termination' }],
    docs: [{ alias: schedule, objectId: schedule }],
    links: [{ concept: 'termination', evidence: schedule, requirements: ['termination-barred'] }],
  },
  mapping: {
    format: 'ceg-ontology-map-1',
    concepts: { path: 'nodes', name: 'id', label: 'label' },
    relations: { path: 'edges', from: 'from', type: 'type', to: 'to' },
    evidence: { path: 'docs', alias: 'alias', objectId: 'objectId' },
    bindings: { path: 'links', concept: 'concept', evidence: 'evidence', requirements: 'requirements' },
  },
  image: image.bytes,
  auto: true,
});
if (!ontology.ok) throw new Error(ontology.diagnostics.map((item) => item.code).join(','));
const manual = {
  concepts: { agreement: { label: 'Agreement' }, exception: { label: 'Exception' } },
  evidence: { [note]: { objectId: note } },
  relations: [{ from: 'agreement', type: 'qualifies', to: 'exception' }],
  bindings: [{ concept: 'exception', evidence: note, requirements: ['stated-exception'] }],
  requirements: ['stated-exception'],
};
const merged = mergeProducerFragments([rules.run.fragment, ontology.run.fragment, manual]);
const plan = instantiatePlanTemplate(loaded.pack, 'showcase-review');
if (!plan.ok) throw new Error('showcase plan');
const compiled = compileCegSource({ source: merged.source, image: image.bytes });
if (!compiled.ok) throw new Error(compiled.diagnostics.map((item) => item.code).join(','));
const proposition = 'May the agreement terminate?';
const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
const result = evaluateKar(session, { proposition, plan: plan.plan });
const verdict = verifyKar({ image: image.bytes, graph: compiled.sidecar, proposition, plan: plan.plan, result });
writeFileSync(path.join(directory, 'knowledge.knolo'), image.bytes);
writeFileSync(path.join(directory, 'generated.ceg.yaml'), emitCegSourceYaml(merged.source));
writeFileSync(path.join(directory, 'knowledge.kar.json'), compiled.bytes);
writeFileSync(path.join(directory, 'plan.json'), `${JSON.stringify(plan.plan, null, 2)}\n`);
writeFileSync(path.join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.status);
console.log(['F_S', 'F_O', 'F_Q'].filter((frontier) => result.frontiers[frontier].length > 0).join(' '));
console.log(verdict.ok ? 'VERIFIED' : verdict.code);
console.log('rules ontology manual');
if (result.status !== 'SATISFIED' || !verdict.ok) process.exit(1);
