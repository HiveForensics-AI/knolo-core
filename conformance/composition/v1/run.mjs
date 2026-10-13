/**
 * Public composition vectors.
 *
 * These cases are small and redistributable. They do not edit KAR v1,
 * coverage v1, or V5 conformance. Lock roots, codes, and statuses.
 *
 *   node conformance/composition/v1/run.mjs
 *   COMPOSITION_V1_ACCEPT=1 node conformance/composition/v1/run.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5, buildPack } from '@knolo/core';
import { createKarSession, evaluateKar } from '@knolo/core/kar';
import { cegNodeId, compileCegSource, parseCegSource } from '@knolo/core/kar/authoring';
import {
  attestationSignaturePayload,
  createBoundedExcerpt,
  createCompositionAttestation,
  createCompositionRecord,
  evaluateComposedKar,
  karCompositionBinder,
  openComposedSession,
  queryComposedSession,
  verifyBoundedExcerpt,
  verifyCompositionAttestation,
  verifyCompositionRecord,
  withCompositionSignature,
} from '@knolo/core/composition';
import { canonicalCbor, digestDomain } from '../../../packages/core/dist/knowledge_image_v5.js';
import { canonicalize } from '../../../packages/core/dist/experimental/kar/canonicalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const expectedPath = path.join(here, 'expected.json');

function image(actor, text, policy) {
  return createKnowledgeImageV5({
    actor,
    sequence: 1,
    ...(policy ? { policy } : {}),
    objects: [{ kind: 'chunk', bytes: encoder.encode(text), meta: { source: `${actor}.txt` } }],
  });
}

function flip(bytes) {
  const copy = Uint8Array.from(bytes);
  copy[copy.length - 1] ^= 0x01;
  return copy;
}

function digestMember(alias, source, sha = `sha256-${'ab'.repeat(32)}`) {
  return {
    alias,
    kind: 'v5-image',
    stateRoot: source.stateRoot,
    objectRoot: source.commit.objectRoot,
    commitDigest: source.commitDigest,
    sha256: sha,
  };
}

function chain(count, source) {
  let current = createCompositionRecord({
    availability: 'digest',
    members: [digestMember('doc', source)],
  }).record;
  const records = [current];
  for (let index = 1; index < count; index += 1) {
    current = createCompositionRecord({
      availability: 'digest',
      members: [{ alias: 'inner', kind: 'composition', compositionRoot: current.compositionRoot }],
    }).record;
    records.push(current);
  }
  return records;
}

function nestedMap(records) {
  return Object.fromEntries(records.map((record) => [record.compositionRoot, { record }]));
}

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code ?? 'THREW';
  }
}

const alpha = image('alpha', 'Alpha cites a portable demo sentence.');
const beta = image('beta', 'Beta cites a second portable demo sentence.');
const ordered = createCompositionRecord({
  availability: 'material',
  members: [
    { alias: 'beta', kind: 'v5-image', bytes: beta.bytes },
    { alias: 'alpha', kind: 'v5-image', bytes: alpha.bytes },
  ],
});
const reversed = createCompositionRecord({
  availability: 'material',
  members: [
    { alias: 'alpha', kind: 'v5-image', bytes: alpha.bytes },
    { alias: 'beta', kind: 'v5-image', bytes: beta.bytes },
  ],
});
const materialVerdict = verifyCompositionRecord(ordered.record, {
  members: {
    alpha: { bytes: alpha.bytes },
    beta: { bytes: beta.bytes },
  },
});
const tampered = verifyCompositionRecord(ordered.record, {
  members: {
    alpha: { bytes: flip(alpha.bytes) },
    beta: { bytes: beta.bytes },
  },
});
const digestRecord = createCompositionRecord({
  availability: 'digest',
  members: [digestMember('alpha', alpha, ordered.record.members.find((member) => member.alias === 'alpha').sha256)],
});
const digestVerdict = verifyCompositionRecord(digestRecord.record);
const missingMaterial = verifyCompositionRecord(digestRecord.record, { requireMaterial: true });
const placeholder = `sha256-${'11'.repeat(32)}`;
const cycleChild = createCompositionRecord({
  availability: 'digest',
  members: [{ alias: 'loop', kind: 'composition', compositionRoot: placeholder }],
}).record;
const cycleParent = createCompositionRecord({
  availability: 'digest',
  members: [{ alias: 'child', kind: 'composition', compositionRoot: cycleChild.compositionRoot }],
}).record;
const cycleVerdict = verifyCompositionRecord(cycleParent, {
  nested: {
    [cycleChild.compositionRoot]: { record: cycleChild },
    [placeholder]: { record: cycleParent },
  },
});
const depthOk = chain(8, alpha);
const depthFail = chain(9, alpha);
const depthOkVerdict = verifyCompositionRecord(depthOk.at(-1), { nested: nestedMap(depthOk) });
const depthFailVerdict = verifyCompositionRecord(depthFail.at(-1), { nested: nestedMap(depthFail) });
const duplicateCode = codeOf(() => createCompositionRecord({
  availability: 'digest',
  members: [digestMember('same', alpha), digestMember('same', beta, `sha256-${'cd'.repeat(32)}`)],
}));
const policyCode = codeOf(() => createCompositionRecord({
  availability: 'digest',
  members: [digestMember('alpha', alpha)],
  policy: { default: 'allow', deny: [{ alias: 'alpha', kind: 'v5-image' }] },
}));
const excerpt = createBoundedExcerpt({ image: alpha.bytes, objectIds: [alpha.objects[0].id] });
const excerptVerdict = verifyBoundedExcerpt(excerpt.excerpt, { imageBytes: alpha.bytes });
const excerptTamper = verifyBoundedExcerpt(excerpt.excerpt, { imageBytes: beta.bytes });
const foreignBody = {
  version: 1,
  format: 'composition-excerpt-1',
  parent: excerpt.excerpt.parent,
  inclusion: 'digest-bound',
  objects: excerpt.excerpt.objects,
};
const foreign = {
  ...excerpt.excerpt,
  inclusion: 'digest-bound',
  excerptRoot: digestDomain('composition-excerpt', canonicalCbor(foreignBody)),
};
const foreignLoose = verifyBoundedExcerpt(foreign);
const foreignUpgrade = verifyBoundedExcerpt(foreign, { imageBytes: alpha.bytes });
const cited = createCompositionAttestation({
  record: ordered.record,
  subject: { kind: 'composition', compositionRoot: ordered.compositionRoot },
  statement: 'cited',
});
const hostBefore = alpha.stateRoot;
const hostBytes = Uint8Array.from(alpha.bytes);
const hosted = createCompositionRecord({
  availability: 'material',
  host: { kind: 'v5-image', bytes: hostBytes },
  members: [{ alias: 'statute', kind: 'v5-image', bytes: beta.bytes }],
});
const hostAfter = createKnowledgeImageV5({
  actor: 'alpha',
  sequence: 1,
  objects: [{ kind: 'chunk', bytes: encoder.encode('Alpha cites a portable demo sentence.'), meta: { source: 'alpha.txt' } }],
});
const licensed = verifyCompositionRecord({ ...ordered.record, license: 'Apache-2.0' });

const sourceText = `format: ceg-source-1
concepts:
  procedure:
    label: Procedure
  valve:
    label: Valve
evidence:
  step:
    source: step.txt
relations:
  - from: procedure
    type: requires
    to: valve
bindings:
  - concept: valve
    evidence: step
    requirements:
      - close-valve
requirements:
  - close-valve
`;
const evidence = createKnowledgeImageV5({
  actor: 'statute',
  sequence: 1,
  objects: [{ kind: 'chunk', bytes: encoder.encode('The operator must close the valve. This sentence is evidence for the plan.'), meta: { source: 'step.txt' } }],
});
const parsedSource = parseCegSource(sourceText);
if (!parsedSource.ok) throw new Error(JSON.stringify(parsedSource.diagnostics));
const compiled = compileCegSource({ source: parsedSource.source, image: evidence.bytes });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
const graphBytes = encoder.encode(JSON.stringify(compiled.sidecar));
const graph = JSON.parse(new TextDecoder().decode(graphBytes));
const bound = karCompositionBinder(evidence.bytes, graphBytes);
const karPlan = {
  version: 1,
  anchor: { mode: 'supplied', witness: [{ nodeId: cegNodeId('procedure'), queryTerm: 'evidence' }] },
  frontierMap: { requires: 'F_S' },
  depth: 2,
  cardinalityBound: 4,
  coverageMode: 'requirements',
  requirements: { F_S: ['close-valve'], F_O: [], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
  profile: 'minimum-cover',
  asOf: '2026-06-01',
  minAuthority: null,
  bounds: {
    maxAnchorNodes: 8,
    maxClosureNodes: 32,
    maxClosureEdges: 32,
    maxFrontierEvidence: 8,
    maxRequirementsPerFrontier: 4,
    maxEvidenceBindings: 8,
    maxCoverVisits: 256,
  },
  lexical: null,
};
const proposition = 'What evidence shows the valve is closed?';
const direct = evaluateKar(createKarSession({ image: evidence.bytes, graph }), { proposition, plan: karPlan });
const karRecord = createCompositionRecord({
  availability: 'material',
  host: { kind: 'v5-image', bytes: evidence.bytes, knowledgeRoot: bound.knowledgeRoot },
  members: [{ alias: 'graph', kind: 'kar-sidecar', bytes: graphBytes, bindsTo: 'host' }],
  karBinder: karCompositionBinder,
});
const karSession = openComposedSession(karRecord.record, {
  hostBytes: evidence.bytes,
  members: { graph: { bytes: graphBytes } },
  karBinder: karCompositionBinder,
});
const composedKar = evaluateComposedKar(karSession, { alias: 'graph', proposition, plan: karPlan });
if (canonicalize(composedKar.evaluation.certificate) !== canonicalize(direct.certificate)) {
  throw new Error('composed KAR certificate bytes changed');
}
if (evidence.stateRoot === bound.knowledgeRoot) throw new Error('stateRoot matched knowledgeRoot');
const used = createCompositionAttestation({
  record: karRecord.record,
  statement: 'used',
  subject: {
    kind: 'kar-result',
    karRoot: direct.certificate.roots.karRoot,
    knowledgeRoot: direct.certificate.roots.knowledgeRoot,
    stateRoot: direct.image.stateRoot,
  },
});

const packBytes = await buildPack([{ id: 'pack-doc', text: 'A lexical pack sentence about valves.' }]);
const packed = createCompositionRecord({
  availability: 'material',
  members: [
    { alias: 'alpha', kind: 'v5-image', bytes: alpha.bytes },
    { alias: 'pack', kind: 'v4-pack', bytes: packBytes },
  ],
});
const queried = queryComposedSession(openComposedSession(packed.record, {
  members: {
    alpha: { bytes: alpha.bytes },
    pack: { bytes: packBytes },
  },
}), { eql: 'FROM chunk SEARCH "demo" LIMIT 5', question: 'valves' });

async function signatureVectors() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const issuedAt = 1_700_000_000_000;
  const expiresAt = 1_800_000_000_000;
  const envelope = {
    format: 'composition-signature-1',
    version: 1,
    attestationRoot: cited.attestation.attestationRoot,
    algorithm: 'Ed25519',
    principal: 'composition-conformance',
    keyId: 'key-1',
    issuedAt,
    expiresAt,
  };
  const payload = attestationSignaturePayload(envelope);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, payload));
  const signed = withCompositionSignature(cited.attestation, { ...envelope, signature });
  const bad = structuredClone(signed);
  const flipped = Uint8Array.from(Buffer.from(bad.signature.signature, 'base64'));
  flipped[0] ^= 0x01;
  bad.signature.signature = Buffer.from(flipped).toString('base64');
  bad.signature.signatureRoot = digestDomain('composition-attestation-signature', canonicalCbor({ payload, signature: flipped }));
  const badVerdict = await verifyCompositionAttestation(bad, { now: issuedAt, publicKey });
  const expired = await verifyCompositionAttestation(signed, { now: expiresAt, publicKey });
  const content = await verifyCompositionAttestation(bad, { checkSignature: false });
  if (!content.ok || content.signature !== 'content-only') throw new Error('content-only rejected a bad envelope');
  return { badVerdict, expired, content, attestationRoot: signed.attestationRoot };
}

const signatures = await signatureVectors();
const citedVerdict = await verifyCompositionAttestation(cited.attestation);
const usedVerdict = await verifyCompositionAttestation(used.attestation, {
  karMaterial: { image: evidence.bytes, graph, proposition, plan: karPlan },
});

const vectors = [
  { id: 'two-image', ok: materialVerdict.ok, code: materialVerdict.ok ? null : materialVerdict.code, compositionRoot: ordered.compositionRoot, status: materialVerdict.ok ? 'verified' : 'failed' },
  { id: 'reorder', ok: ordered.compositionRoot === reversed.compositionRoot, code: null, compositionRoot: ordered.compositionRoot, status: 'same-root' },
  { id: 'digest-mismatch', ok: tampered.ok, code: tampered.ok ? null : tampered.code, compositionRoot: ordered.compositionRoot, status: 'failed' },
  { id: 'digest-bound', ok: digestVerdict.ok, code: digestVerdict.ok ? null : digestVerdict.code, compositionRoot: digestRecord.compositionRoot, status: digestVerdict.availability ?? 'failed' },
  { id: 'missing-material', ok: missingMaterial.ok, code: missingMaterial.ok ? null : missingMaterial.code, compositionRoot: digestRecord.compositionRoot, status: 'failed' },
  { id: 'cycle', ok: cycleVerdict.ok, code: cycleVerdict.ok ? null : cycleVerdict.code, compositionRoot: cycleParent.compositionRoot, status: 'failed' },
  { id: 'depth', ok: depthOkVerdict.ok && !depthFailVerdict.ok, code: depthFailVerdict.ok ? null : depthFailVerdict.code, compositionRoot: depthOk.at(-1).compositionRoot, status: depthOkVerdict.ok ? 'depth-8' : 'failed' },
  { id: 'duplicate-alias', ok: false, code: duplicateCode, compositionRoot: null, status: 'no-root' },
  { id: 'policy-deny', ok: false, code: policyCode, compositionRoot: null, status: 'no-root' },
  { id: 'excerpt-included', ok: excerptVerdict.ok && !excerptTamper.ok, code: excerptTamper.ok ? null : excerptTamper.code, compositionRoot: excerpt.excerptRoot, status: excerptVerdict.inclusion ?? 'failed' },
  { id: 'excerpt-upgrade', ok: foreignLoose.ok && !foreignUpgrade.ok, code: foreignUpgrade.ok ? null : foreignUpgrade.code, compositionRoot: foreign.excerptRoot, status: 'not-upgraded' },
  { id: 'attestation-cited', ok: citedVerdict.ok, code: citedVerdict.ok ? null : citedVerdict.code, compositionRoot: cited.attestationRoot, status: citedVerdict.signature ?? 'failed' },
  { id: 'signature-bad', ok: false, code: signatures.badVerdict.code, compositionRoot: signatures.attestationRoot, status: signatures.expired.code },
  { id: 'kar-byte-equal', ok: usedVerdict.ok === true && usedVerdict.usage === 'rerun', code: null, compositionRoot: direct.certificate.roots.karRoot, status: evidence.stateRoot === bound.knowledgeRoot ? 'same-root' : 'distinct-roots' },
  { id: 'commerce-ignored', ok: !licensed.ok && !JSON.stringify(ordered.record).includes('Apache-2.0'), code: licensed.ok ? null : licensed.code, compositionRoot: ordered.compositionRoot, status: 'ignored' },
  { id: 'host-untouched', ok: hostAfter.stateRoot === hostBefore && hosted.compositionRoot !== hostBefore, code: null, compositionRoot: hosted.compositionRoot, status: hostBefore },
];

if (queried.results.map((row) => row.status).join(',') !== 'queried,queried') {
  throw new Error(`query fan-out ${JSON.stringify(queried.results.map((row) => ({ alias: row.alias, status: row.status })))}`);
}
if (queried.results[0].planRoot === undefined || queried.results[1].planRoot !== undefined) {
  throw new Error('query fan-out invented or dropped a plan root');
}

const document = { format: 'composition-conformance-v1', vectors };
if (process.env.COMPOSITION_V1_ACCEPT === '1') {
  writeFileSync(expectedPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`accepted ${expectedPath}`);
} else {
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(document)) {
    console.error('composition conformance drift');
    console.error(JSON.stringify(document, null, 2));
    process.exit(1);
  }
}
for (const vector of vectors) {
  if (vector.id === 'two-image' && !vector.ok) process.exitCode = 1;
  if (vector.id === 'reorder' && !vector.ok) process.exitCode = 1;
  if (vector.id === 'digest-mismatch' && vector.code !== 'COMPOSITION_DIGEST_MISMATCH') process.exitCode = 1;
  if (vector.id === 'digest-bound' && vector.status !== 'digest') process.exitCode = 1;
  if (vector.id === 'missing-material' && vector.code !== 'COMPOSITION_MEMBER_MISSING') process.exitCode = 1;
  if (vector.id === 'cycle' && vector.code !== 'COMPOSITION_CYCLE') process.exitCode = 1;
  if (vector.id === 'depth' && vector.code !== 'COMPOSITION_DEPTH_EXCEEDED') process.exitCode = 1;
  if (vector.id === 'duplicate-alias' && vector.code !== 'COMPOSITION_DUPLICATE') process.exitCode = 1;
  if (vector.id === 'policy-deny' && vector.code !== 'COMPOSITION_POLICY_DENIED') process.exitCode = 1;
  if (vector.id === 'excerpt-included' && vector.code !== 'EXCERPT_INCLUSION_MISMATCH') process.exitCode = 1;
  if (vector.id === 'excerpt-upgrade' && vector.code !== 'EXCERPT_INCLUSION_MISMATCH') process.exitCode = 1;
  if (vector.id === 'attestation-cited' && vector.status !== 'absent') process.exitCode = 1;
  if (vector.id === 'signature-bad' && (vector.code !== 'ATTESTATION_SIGNATURE_INVALID' || vector.status !== 'ATTESTATION_EXPIRED')) process.exitCode = 1;
  if (vector.id === 'kar-byte-equal' && (!vector.ok || vector.status !== 'distinct-roots')) process.exitCode = 1;
  if (vector.id === 'commerce-ignored' && vector.code !== 'COMPOSITION_INVALID') process.exitCode = 1;
  if (vector.id === 'host-untouched' && !vector.ok) process.exitCode = 1;
}
if (process.exitCode) {
  console.error(JSON.stringify(vectors, null, 2));
  process.exit(process.exitCode);
}
console.log(`composition-conformance-v1 ${vectors.length}`);
