/**
 * Producer-quality benchmark. This is not a KAR algorithm experiment.
 * Reference labels are declared by the scenario generator.
 * The producer is scored after it runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { loadDomainDirectory } from '../../cli/bin/kar-produce.mjs';
import * as authoring from '../dist/experimental/kar/authoring/index.js';
import { createKarSession, evaluateKar } from '../dist/experimental/kar/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const encoder = new TextEncoder();
const SCENARIOS = 100;

const DOMAINS = {
  contracts: {
    producer: 'contracts-rules-v1',
    meta: { type: 'contract' },
    anchor: 'agreement',
    support: { text: 'The agreement may terminate after notice.\n', relation: ['agreement', 'permits', 'termination'], binding: ['termination', 'termination-right'] },
    opposition: { text: 'The agreement may not terminate during the annual term.\n', relation: ['agreement', 'prohibits', 'termination'], binding: ['termination', 'termination-barred'] },
    qualification: { text: 'The duty stands except when notice is late.\n', relation: ['agreement', 'qualifies', 'exception'], binding: ['exception', 'stated-exception'] },
    incomplete: 'The agreement is subject to the former limit.\n',
    dateLine: 'The agreement is effective 2026-01-01 until 2027-01-01.\n',
    plans: { both: 'showcase-review', opposition: 'balanced-review', qualification: 'qualification-review', support: 'support-only' },
    authorityRule: true,
  },
  policy: {
    producer: 'policy-rules-v1',
    meta: { type: 'policy' },
    support: { text: 'The control is required before launch.\n', relation: ['policy', 'requires', 'control'], binding: ['control', 'control-required'] },
    opposition: { text: 'The control is prohibited after review.\n', relation: ['policy', 'prohibits', 'control'], binding: ['control', 'control-prohibited'] },
    qualification: { text: 'An exception applies when the director approves.\n', relation: ['policy', 'qualifies', 'exception'], binding: ['exception', 'stated-exception'] },
    incomplete: 'The control is subject to the former limit.\n',
    dateLine: 'The policy is effective 2026-01-01 until 2027-01-01.\n',
    plans: { both: 'compliance-review', opposition: 'compliance-review', qualification: 'exception-review', support: 'current-policy' },
    authorityRule: true,
  },
  operations: {
    producer: 'operations-rules-v1',
    meta: { type: 'procedure' },
    support: { text: 'The operator must complete the step.\n', relation: ['procedure', 'requires', 'step'], binding: ['step', 'required-step'] },
    opposition: { text: 'The operator must not complete the step.\n', relation: ['procedure', 'prohibits', 'step'], binding: ['step', 'prohibited-state'] },
    qualification: { text: 'Continue unless authorized by the lead.\n', relation: ['procedure', 'qualifies', 'exception'], binding: ['exception', 'stated-exception'] },
    incomplete: 'The step is subject to the former limit.\n',
    dateLine: 'The procedure is effective 2026-01-01 until 2027-01-01.\n',
    plans: { both: 'procedure-review', opposition: 'procedure-review', qualification: 'exception-review', support: 'current-procedure' },
    authorityRule: true,
  },
  generic: {
    producer: 'generic-rules-v1',
    meta: { type: 'record' },
    support: { text: 'The record is related to the topic.\n', relation: ['record', 'related', 'topic'], binding: ['topic', 'related-link'] },
    opposition: null,
    qualification: null,
    incomplete: 'The room probably means lodging.\n',
    dateLine: '',
    plans: { both: 'related-review', opposition: 'related-review', qualification: 'related-review', support: 'related-review' },
    authorityRule: false,
  },
};

function scenario(spec, index) {
  const support = index % 13 !== 0;
  const opposition = Boolean(spec.opposition) && index % 5 === 0;
  const qualification = Boolean(spec.qualification) && index % 7 === 0;
  const incomplete = index % 11 === 0;
  const dates = spec.dateLine.length > 0 && index % 4 === 0;
  const authority = spec.authorityRule === true && index % 3 === 0;
  const documents = [];
  const relations = [];
  const bindings = [];
  const concepts = new Set();
  if (support) {
    documents.push({
      source: 'support.md',
      text: `${spec.support.text}${dates ? spec.dateLine : ''}The room probably means lodging.\n`,
      meta: { ...spec.meta, ...(authority ? { authority: '80' } : {}) },
    });
    relations.push(spec.support.relation);
    bindings.push({ concept: spec.support.binding[0], source: 'support.md', requirements: [spec.support.binding[1]], ...(dates ? { validFrom: '2026-01-01', validUntil: '2027-01-01' } : {}), ...(authority ? { authority: 80 } : {}) });
    concepts.add(spec.support.relation[0]);
    concepts.add(spec.support.relation[2]);
  } else {
    documents.push({ source: 'support.md', text: 'The room probably means lodging.\n', meta: { ...spec.meta } });
    concepts.add(spec.support.relation[0]);
  }
  if (opposition) {
    documents.push({ source: 'oppose.md', text: spec.opposition.text, meta: { ...spec.meta } });
    relations.push(spec.opposition.relation);
    bindings.push({ concept: spec.opposition.binding[0], source: 'oppose.md', requirements: [spec.opposition.binding[1]] });
    concepts.add(spec.opposition.relation[2]);
  }
  if (qualification) {
    documents.push({ source: 'qualify.md', text: spec.qualification.text, meta: { ...spec.meta } });
    relations.push(spec.qualification.relation);
    bindings.push({ concept: spec.qualification.binding[0], source: 'qualify.md', requirements: [spec.qualification.binding[1]] });
    concepts.add(spec.qualification.relation[2]);
  }
  if (incomplete) documents.push({ source: 'gap.md', text: spec.incomplete, meta: { ...spec.meta } });
  let template = spec.plans.support;
  if (opposition && qualification && spec.plans.both) template = spec.plans.both;
  else if (opposition) template = spec.plans.opposition;
  else if (qualification) template = spec.plans.qualification;
  if (!support) template = spec.plans.support;
  return { documents, relations, bindings, concepts: [...concepts], template, dates, authority, support };
}

function ratio(hit, proposed, reference) {
  return {
    precision: proposed === 0 ? 1 : hit / proposed,
    recall: reference === 0 ? 1 : hit / reference,
    proposed,
    reference,
    hit,
  };
}

function score(pairs) {
  let hit = 0;
  const proposed = new Set(pairs.proposed);
  const reference = new Set(pairs.reference);
  for (const item of proposed) if (reference.has(item)) hit += 1;
  return ratio(hit, proposed.size, reference.size);
}

function relationKey(relation) {
  return `${relation[0] ?? relation.from} ${relation[1] ?? relation.type} ${relation[2] ?? relation.to}`;
}

function bindingKey(binding) {
  return [binding.concept, binding.source, [...binding.requirements].sort().join(','), binding.authority ?? '', binding.validFrom ?? '', binding.validUntil ?? ''].join(' ');
}

function evaluate(pack, image, source, template) {
  const plan = authoring.instantiatePlanTemplate(pack, template);
  const compiled = authoring.compileCegSource({ source, image: image.bytes });
  if (!plan.ok || !compiled.ok) return null;
  const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
  return evaluateKar(session, { proposition: 'producer benchmark', plan: plan.plan });
}

function measure(id, spec) {
  const loaded = loadDomainDirectory(authoring, path.join(repo, 'domains', id));
  if (!loaded.ok) throw new Error(`domain ${id} failed to load`);
  const totals = {
    concepts: empty(),
    relations: empty(),
    bindings: empty(),
    groundingHits: 0,
    groundingProposed: 0,
    temporalHits: 0,
    temporalCases: 0,
    authorityHits: 0,
    authorityCases: 0,
    status: 0,
    frontiers: 0,
    selected: 0,
    abstention: 0,
    cases: 0,
    contradictionsKept: 0,
    contradictionCases: 0,
  };
  for (let index = 0; index < SCENARIOS; index += 1) {
    const expected = scenario(spec, index);
    const image = createKnowledgeImageV5({
      actor: `ceg-bench-${id}`,
      sequence: 1,
      objects: expected.documents.map((document) => ({
        kind: 'chunk',
        bytes: encoder.encode(document.text),
        meta: { source: document.source, ...document.meta },
      })),
    });
    const bySource = new Map(image.objects.map((object) => [object.meta.source, object.id]));
    const ran = authoring.runRuleProducer({ pack: loaded.pack, image: image.bytes });
    if (!ran.ok) throw new Error(`${id} scenario ${index} failed`);
    const proposedConcepts = Object.keys(ran.run.fragment.concepts);
    add(totals.concepts, score({ proposed: proposedConcepts, reference: expected.concepts }));
    add(totals.relations, score({
      proposed: ran.run.fragment.relations.map((relation) => relationKey(relation)),
      reference: expected.relations.map(relationKey),
    }));
    const proposedBindings = ran.run.fragment.bindings.map((binding) => bindingKey({
      ...binding,
      source: [...bySource.entries()].find(([, objectId]) => objectId === binding.evidence)?.[0] ?? binding.evidence,
    }));
    add(totals.bindings, score({ proposed: proposedBindings, reference: expected.bindings.map(bindingKey) }));
    for (const binding of ran.run.fragment.bindings) {
      totals.groundingProposed += 1;
      const object = image.objects.find((item) => item.id === binding.evidence);
      if (object) totals.groundingHits += 1;
    }
    totals.temporalCases += 1;
    const temporalOk = ran.run.fragment.bindings.every((binding) => {
      const source = [...bySource.entries()].find(([, objectId]) => objectId === binding.evidence)?.[0];
      const dated = expected.dates && source === 'support.md' && expected.support;
      if (!dated) return binding.validFrom === undefined && binding.validUntil === undefined;
      return binding.validFrom === '2026-01-01' && binding.validUntil === '2027-01-01';
    });
    if (temporalOk) totals.temporalHits += 1;
    totals.authorityCases += 1;
    const authorityOk = ran.run.fragment.bindings.every((binding) => {
      const source = [...bySource.entries()].find(([, objectId]) => objectId === binding.evidence)?.[0];
      if (expected.authority && source === 'support.md' && expected.support) return binding.authority === 80;
      return binding.authority === undefined;
    });
    if (authorityOk) totals.authorityHits += 1;
    if (expected.relations.some((relation) => relation[1] === 'permits' || relation[1] === 'requires') && expected.relations.some((relation) => relation[1] === 'prohibits')) {
      totals.contradictionCases += 1;
      const types = new Set(ran.run.fragment.relations.map((relation) => relation.type));
      if ((types.has('permits') || types.has('requires')) && types.has('prohibits')) totals.contradictionsKept += 1;
    }
    const referenceSource = referenceOf(expected, bySource);
    const referenceResult = evaluate(loaded.pack, image, referenceSource, expected.template);
    const producedResult = evaluate(loaded.pack, image, ran.run.fragment, expected.template);
    totals.cases += 1;
    if (referenceResult && producedResult) {
      if (referenceResult.status === producedResult.status) totals.status += 1;
      if (JSON.stringify(referenceResult.frontiers) === JSON.stringify(producedResult.frontiers)) totals.frontiers += 1;
      const referenceSelected = referenceResult.selectedEvidence.map((item) => item.id).sort().join(',');
      const producedSelected = producedResult.selectedEvidence.map((item) => item.id).sort().join(',');
      if (referenceSelected === producedSelected) totals.selected += 1;
      if (abstains(referenceResult.status) === abstains(producedResult.status)) totals.abstention += 1;
    }
  }
  return {
    producer: spec.producer,
    domain: id,
    scenarios: SCENARIOS,
    concept: finish(totals.concepts),
    relation: finish(totals.relations),
    binding: finish(totals.bindings),
    evidenceGroundingPrecision: totals.groundingProposed === 0 ? 1 : totals.groundingHits / totals.groundingProposed,
    temporalAccuracy: totals.temporalHits / totals.temporalCases,
    authorityAccuracy: totals.authorityHits / totals.authorityCases,
    contradictionsKept: totals.contradictionCases === 0 ? 1 : totals.contradictionsKept / totals.contradictionCases,
    kar: {
      statusAgreement: totals.status / totals.cases,
      frontierAgreement: totals.frontiers / totals.cases,
      selectedEvidenceAgreement: totals.selected / totals.cases,
      abstentionAgreement: totals.abstention / totals.cases,
    },
  };
}

function referenceOf(expected, bySource) {
  const concepts = {};
  for (const name of expected.concepts) concepts[name] = {};
  const evidence = {};
  for (const [source, objectId] of bySource) evidence[objectId] = { objectId };
  const relations = expected.relations.map(([from, type, to]) => ({ from, type, to }));
  const bindings = expected.bindings.map((binding) => ({
    concept: binding.concept,
    evidence: bySource.get(binding.source),
    requirements: binding.requirements,
    ...(binding.authority !== undefined ? { authority: binding.authority } : {}),
    ...(binding.validFrom ? { validFrom: binding.validFrom } : {}),
    ...(binding.validUntil ? { validUntil: binding.validUntil } : {}),
  }));
  const requirements = [...new Set(expected.bindings.flatMap((binding) => binding.requirements))];
  return { format: 'ceg-source-1', concepts, evidence, relations, bindings, requirements };
}

function abstains(status) {
  return status !== 'SATISFIED' && status !== 'UNSATISFIED_EVIDENCE_REQUIREMENTS';
}

function empty() {
  return { precision: 0, recall: 0, proposed: 0, reference: 0, hit: 0 };
}

function add(total, item) {
  total.precision += item.precision;
  total.recall += item.recall;
  total.proposed += item.proposed;
  total.reference += item.reference;
  total.hit += item.hit;
}

function finish(total) {
  return {
    precision: round(total.precision / SCENARIOS),
    recall: round(total.recall / SCENARIOS),
    microPrecision: round(total.proposed === 0 ? 1 : total.hit / total.proposed),
    microRecall: round(total.reference === 0 ? 1 : total.hit / total.reference),
    proposed: total.proposed,
    reference: total.reference,
  };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function ontologyBench() {
  let grounded = 0;
  let relations = 0;
  for (let index = 0; index < SCENARIOS; index += 1) {
    const objectId = `sha256-${index.toString(16).padStart(64, '0')}`;
    const ontology = {
      nodes: [{ id: 'policy', label: 'Policy' }, { id: 'control', label: 'Control' }],
      edges: [{ from: 'policy', type: 'requires', to: 'control' }],
      docs: [{ alias: 'policy', objectId }],
    };
    const mapping = {
      format: 'ceg-ontology-map-1',
      concepts: { path: 'nodes', name: 'id', label: 'label' },
      relations: { path: 'edges', from: 'from', type: 'type', to: 'to' },
      evidence: { path: 'docs', alias: 'alias', objectId: 'objectId' },
    };
    const ran = authoring.runOntologyProducer({ ontology, mapping, auto: true });
    if (!ran.ok) continue;
    relations += ran.run.fragment.relations.length === 1 ? 1 : 0;
    if (ran.run.fragment.evidence.policy?.objectId === objectId) grounded += 1;
  }
  return {
    producer: 'ontology-producer',
    scenarios: SCENARIOS,
    relationRecall: round(relations / SCENARIOS),
    evidenceGroundingPrecision: round(grounded / SCENARIOS),
  };
}

const rows = Object.entries(DOMAINS).map(([id, spec]) => measure(id, spec));
rows.push(ontologyBench());
rows.push({
  producer: 'model-producer',
  classification: 'MODEL_PRODUCER_EXPERIMENTAL_ONLY',
  measured: false,
  autoAcceptModelOutput: false,
  note: 'No live local model was scored. Malformed and ungrounded JSON is rejected by the core validator. Model output stays PROPOSED.',
});
const report = {
  benchmark: 'ceg-producer-quality',
  scenariosPerDomain: SCENARIOS,
  producers: rows,
};
const out = path.join(repo, 'docs/kar/producer-benchmarks.json');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
for (const row of rows) {
  if (row.kar) {
    console.log(`${row.producer} grounding ${row.evidenceGroundingPrecision} relationP ${row.relation.microPrecision} relationR ${row.relation.microRecall} status ${row.kar.statusAgreement}`);
  } else console.log(`${row.producer} ${row.classification ?? row.evidenceGroundingPrecision}`);
}
