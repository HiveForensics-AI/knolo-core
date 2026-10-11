import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { createKarDossier, createKarSession, evaluateKar, verifyKarDossier } from '../dist/kar/index.js';
import { compileCegSource, interpretDomainPack, validateCegSource } from '../dist/kar/authoring/index.js';
import { buildDistributionFiles, loadKarBundle } from '../dist/experimental/kar/authoring/index.js';
import { validateKarPlan, validateKarResult, validateKarSidecar } from '../dist/experimental/kar/index.js';

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schemas/experimental/kar');
const packedSchemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/schemas/kar');

function loadSchema(name) {
  return JSON.parse(readFileSync(path.join(schemaDir, name), 'utf8'));
}

function validate(schema, value) {
  return check(schema, value, schema, '');
}

function check(schema, value, root, at) {
  if (schema.$ref) return check(resolveRef(root, schema.$ref), value, root, at);
  if (schema.oneOf) {
    const hits = schema.oneOf.filter((branch) => check(branch, value, root, at).ok);
    if (hits.length !== 1) return fail(at, 'oneOf');
  }
  if (schema.const !== undefined && value !== schema.const) return fail(at, 'const');
  if (schema.enum && !schema.enum.includes(value)) return fail(at, 'enum');
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeOf(value, type))) return fail(at, 'type');
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return fail(at, 'minLength');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return fail(at, 'maxLength');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return fail(at, 'pattern');
  }
  if (typeof value === 'number') {
    if (schema.type === 'integer' && !Number.isInteger(value)) return fail(at, 'integer');
    if (schema.minimum !== undefined && value < schema.minimum) return fail(at, 'minimum');
    if (schema.maximum !== undefined && value > schema.maximum) return fail(at, 'maximum');
  }
  if (schema.type === 'object' || (value && typeof value === 'object' && !Array.isArray(value) && schema.properties)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(at, 'object');
    for (const key of schema.required ?? []) {
      if (!(key in value)) return fail(at, `required ${key}`);
    }
    const known = new Set(Object.keys(schema.properties ?? {}));
    for (const key of Object.keys(value)) {
      if (known.has(key)) {
        const child = check(schema.properties[key], value[key], root, `${at}.${key}`);
        if (!child.ok) return child;
      } else if (schema.additionalProperties === false) return fail(at, `additional ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const child = check(schema.additionalProperties, value[key], root, `${at}.${key}`);
        if (!child.ok) return child;
      }
    }
  }
  if (schema.type === 'array' || schema.items) {
    if (!Array.isArray(value)) return fail(at, 'array');
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const child = check(schema.items, value[index], root, `${at}[${index}]`);
        if (!child.ok) return child;
      }
    }
  }
  return { ok: true };
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported ref ${ref}`);
  let cursor = root;
  for (const part of ref.slice(2).split('/')) cursor = cursor[part];
  if (!cursor) throw new Error(`Missing ref ${ref}`);
  return cursor;
}

function typeOf(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

function fail(pathName, reason) {
  return { ok: false, reason: `${pathName} ${reason}`.trim() };
}

const sourceText = `format: ceg-source-1
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

test('packed schemas match the repository schemas', () => {
  for (const name of [
    'kar-sidecar-v1.schema.json',
    'kar-plan-v1.schema.json',
    'kar-result-v1.schema.json',
    'ceg-source-v1.schema.json',
    'ceg-domain-v1.schema.json',
    'kar-distribution-v1.schema.json',
    'kar-dossier-v1.schema.json',
  ]) {
    assert.equal(readFileSync(path.join(packedSchemaDir, name), 'utf8'), readFileSync(path.join(schemaDir, name), 'utf8'));
  }
});

test('published schemas accept runtime objects and reject the paired invalid objects', () => {
  const image = createKnowledgeImageV5({
    actor: 'kar-schema-test',
    sequence: 1,
    objects: [{
      kind: 'chunk',
      bytes: new TextEncoder().encode('The customer may cancel. This sentence is evidence for the plan.'),
      meta: { source: 'policy.txt' },
    }],
  });
  const parsed = validateCegSource(sourceText);
  assert.equal(parsed.ok, true);
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
  assert.equal(compiled.ok, true);
  const plan = {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: compiled.sidecar.graph.relations[0].from, queryTerm: 'evidence' }] },
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
      maxAnchorNodes: 4,
      maxClosureNodes: 8,
      maxClosureEdges: 8,
      maxFrontierEvidence: 4,
      maxRequirementsPerFrontier: 4,
      maxEvidenceBindings: 4,
      maxCoverVisits: 100,
    },
    lexical: null,
  };
  const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
  const result = evaluateKar(session, { proposition: 'What evidence supports cancellation?', plan });
  const dossier = createKarDossier({ image: image.bytes, graph: compiled.sidecar, plan, proposition: result.proposition });
  const distribution = buildDistributionFiles({ image: image.bytes, graphBytes: compiled.bytes, graph: compiled.sidecar });
  assert.equal(distribution.ok, true);
  const domain = {
    format: 'ceg-domain-1',
    id: 'schema-sample',
    version: '1',
    description: 'Schema round trip. Not a released pack.',
    conceptKinds: [{ id: 'party' }],
    concepts: [],
    relations: ['permits'],
    rules: [],
    planTemplates: {},
  };
  const interpreted = interpretDomainPack(domain);
  assert.equal(interpreted.ok, true, JSON.stringify(interpreted.diagnostics));

  const badDossier = verifyKarDossier({
    image: image.bytes,
    graph: compiled.sidecar,
    plan,
    proposition: result.proposition,
    manifest: { ...dossier.manifest, extra: true },
    certificate: dossier.certificate,
    evaluation: dossier.evaluation,
  }).ok;
  const badDistribution = loadKarBundle({
    image: image.bytes,
    graph: compiled.sidecar,
    manifest: { ...distribution.manifest, maturity: 'review-required' },
    graphBytes: compiled.bytes,
  }).ok;
  const pairs = [
    ['ceg-source-v1.schema.json', parsed.source, validateCegSource(parsed.source).ok, { format: 'nope' }, validateCegSource({ format: 'nope' }).ok],
    ['kar-sidecar-v1.schema.json', compiled.sidecar, validateKarSidecar(compiled.sidecar).ok, { version: 1 }, validateKarSidecar({ version: 1 }).ok],
    ['kar-plan-v1.schema.json', plan, validateKarPlan(plan).ok, { version: 1 }, validateKarPlan({ version: 1 }).ok],
    ['kar-result-v1.schema.json', result.certificate, validateKarResult(result.certificate).ok, { version: 'kar-1-research-1' }, validateKarResult({ version: 'kar-1-research-1' }).ok],
    ['kar-dossier-v1.schema.json', dossier.manifest, true, { ...dossier.manifest, extra: true }, badDossier],
    ['kar-distribution-v1.schema.json', distribution.manifest, true, { ...distribution.manifest, maturity: 'review-required' }, badDistribution],
    ['ceg-domain-v1.schema.json', domain, interpreted.ok, { ...domain, maturity: 'validated' }, interpretDomainPack({ ...domain, maturity: 'validated' }).ok],
  ];

  for (const [name, validValue, runtimeValid, invalidValue, runtimeInvalid] of pairs) {
    const schema = loadSchema(name);
    const accepted = validate(schema, validValue);
    assert.equal(accepted.ok, true, `${name} ${accepted.reason ?? ''}`);
    assert.equal(runtimeValid, true, name);
    const rejected = validate(schema, invalidValue);
    assert.equal(rejected.ok, false, `${name} accepted an invalid example`);
    assert.equal(runtimeInvalid, false, `${name} runtime accepted an invalid example`);
    assert.equal(JSON.parse(JSON.stringify(validValue)).format ?? JSON.parse(JSON.stringify(validValue)).version, validValue.format ?? validValue.version);
  }
});
