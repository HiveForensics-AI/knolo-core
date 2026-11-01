/**
 * Flight-ops phase 1 demo.
 *
 * Run from the repository root after building @knolo/core:
 *   node examples/flight-ops/run.mjs
 *
 * SATISFIED means the declared evidence requirements were met.
 * It does not mean a flight was safe, legal, or compliant.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
import { createKarDossier, karDossierStatusStatement, renderKarDossier, verifyKarDossier } from '@knolo/core/kar';
import { cegNodeId, compileCegSource, parseCegSource } from '@knolo/core/kar/authoring';
import { askCortex, createCortexSession, verifyCortexAnswer } from '@knolo/core/cortex';
import { flightImageFromDocument, parseFlightEvents, renderEventText } from '../../packages/cli/bin/flight.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const cli = path.join(repo, 'packages/cli/bin/knolo.mjs');
const encoder = new TextEncoder();

const bounds = {
  maxAnchorNodes: 8,
  maxClosureNodes: 32,
  maxClosureEdges: 32,
  maxFrontierEvidence: 8,
  maxRequirementsPerFrontier: 4,
  maxEvidenceBindings: 8,
  maxCoverVisits: 1000,
};

function plan(anchor, frontierMap, requirements, floors) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: anchor, queryTerm: 'evidence' }] },
    frontierMap,
    depth: 2,
    cardinalityBound: 8,
    coverageMode: 'requirements',
    requirements: { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [], ...requirements },
    floors: { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0', ...floors },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds,
    lexical: null,
  };
}

function compile(image, sourceText) {
  const parsed = parseCegSource(sourceText);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const compiled = compileCegSource({ source: parsed.source, image });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled;
}

function evaluate(name, image, sourceText, casePlan, proposition, expectStatus) {
  const compiled = compile(image, sourceText);
  const dossier = createKarDossier({
    image,
    graph: compiled.sidecar,
    plan: casePlan,
    proposition,
  });
  if (dossier.status !== expectStatus) throw new Error(`${name} status ${dossier.status}, expected ${expectStatus}`);
  if (dossier.statusStatement !== karDossierStatusStatement(expectStatus)) {
    throw new Error(`${name} status statement changed`);
  }
  const markdown = renderKarDossier(dossier);
  if (!markdown.includes(dossier.statusStatement)) throw new Error(`${name} dossier omitted the status statement`);
  if (/\b(safe|compliant|approved|proven)\b/i.test(markdown)) {
    throw new Error(`${name} dossier uses a truth or compliance word`);
  }
  const verdict = verifyKarDossier({
    image,
    graph: compiled.sidecar,
    plan: casePlan,
    proposition,
    manifest: dossier.manifest,
    certificate: dossier.certificate,
    evaluation: dossier.evaluation,
    evidenceMarkdown: markdown,
  });
  if (!verdict.ok) throw new Error(`${name} dossier ${verdict.code} ${verdict.reason}`);
  return compiled;
}

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const events = JSON.parse(readFileSync(path.join(here, 'events.json'), 'utf8'));
const parsedEvents = parseFlightEvents(events);
if (!parsedEvents.ok) throw new Error(`${parsedEvents.code}: ${parsedEvents.message}`);
const flight = await flightImageFromDocument(parsedEvents.document);
const again = await flightImageFromDocument(parsedEvents.document);
if (Buffer.compare(flight.bytes, again.bytes) !== 0) throw new Error('flight image bytes changed between builds');

const expected = JSON.parse(readFileSync(path.join(here, 'expected.json'), 'utf8'));
if (expected.flightStateRoot !== flight.stateRoot) {
  throw new Error(`flight state root ${flight.stateRoot}, expected ${expected.flightStateRoot}`);
}

const flightSource = readFileSync(path.join(here, 'knowledge.ceg.yaml'), 'utf8');
const gapSource = readFileSync(path.join(here, 'gap.ceg.yaml'), 'utf8');
const geofencePlan = plan(cegNodeId('flight'), { supports: 'F_S' }, { F_S: ['geofence-clear'] }, { F_S: '1' });
const failsafePlan = plan(cegNodeId('flight'), { supports: 'F_S' }, { F_S: ['failsafe-clear'] }, { F_S: '1' });
const flightGraph = evaluate(
  'geofence-hold',
  flight.bytes,
  flightSource,
  geofencePlan,
  'Which committed evidence meets the geofence-clear requirement?',
  'SATISFIED',
);
evaluate(
  'failsafe-review',
  flight.bytes,
  flightSource,
  failsafePlan,
  'Which committed evidence meets the failsafe-clear requirement?',
  'SATISFIED',
);
evaluate(
  'failsafe-gap',
  flight.bytes,
  gapSource,
  failsafePlan,
  'Which committed evidence meets the failsafe-clear requirement?',
  'UNSATISFIED_EVIDENCE_REQUIREMENTS',
);

const armingText = renderEventText(parsedEvents.document.events.find((event) => event.id === 'arming'));
const checklistText = 'checklist complete before arming';
const review = createKnowledgeImageV5({
  actor: 'knolo-flight',
  sequence: 1,
  objects: [
    { kind: 'chunk', bytes: encoder.encode(armingText), meta: { source: 'arming.txt' } },
    { kind: 'chunk', bytes: encoder.encode(checklistText), meta: { source: 'checklist.txt' } },
  ],
});
const armingOnly = createKnowledgeImageV5({
  actor: 'knolo-flight',
  sequence: 1,
  objects: [{ kind: 'chunk', bytes: encoder.encode(armingText), meta: { source: 'arming.txt' } }],
});
const checklistPlan = plan(cegNodeId('arming'), { requires: 'F_S', valid_before: 'F_T' }, {
  F_S: ['checklist-complete'],
  F_T: ['checklist-complete'],
}, { F_S: '1', F_T: '1' });
evaluate(
  'checklist-before-arm',
  review.bytes,
  readFileSync(path.join(here, 'checklist.ceg.yaml'), 'utf8'),
  checklistPlan,
  'Which committed evidence meets the checklist-complete requirement?',
  'SATISFIED',
);
evaluate(
  'checklist-gap',
  armingOnly.bytes,
  readFileSync(path.join(here, 'checklist-gap.ceg.yaml'), 'utf8'),
  plan(cegNodeId('arming'), { requires: 'F_S' }, { F_S: ['checklist-complete'] }, { F_S: '1' }),
  'Which committed evidence meets the checklist-complete requirement?',
  'UNSATISFIED_EVIDENCE_REQUIREMENTS',
);

const session = await createCortexSession({
  image: flight.bytes,
  model: {
    selectEvidence({ hits }) {
      return { selectedIds: hits.slice(0, 1).map((hit) => hit.id), reason: 'top' };
    },
    synthesizeAnswer({ evidence }) {
      return {
        text: 'The flight image contains a geofence scan record.',
        claims: [{ text: 'The flight image contains a geofence scan record.', evidenceIds: [evidence[0].id] }],
        citations: [{ evidenceId: evidence[0].id }],
      };
    },
  },
});
const trace = await askCortex(session, { question: 'geofence scan', mode: 'evidence_answer' });
const verified = await verifyCortexAnswer({ image: flight.bytes, question: trace.question, result: trace });
if (!verified.ok) throw new Error(`cortex ${verified.code} ${verified.message}`);
const tampered = structuredClone(trace);
tampered.answer.citations[0].excerpt = 'tampered excerpt';
const citation = await verifyCortexAnswer({ image: flight.bytes, question: trace.question, result: tampered });
if (citation.ok) throw new Error('tampered cortex citation verified');
const otherImage = await verifyCortexAnswer({ image: armingOnly.bytes, question: trace.question, result: trace });
if (otherImage.ok) throw new Error('cortex trace verified against a different image');

const dir = mkdtempSync(path.join(tmpdir(), 'knolo-flight-'));
writeFileSync(path.join(dir, 'flight.knolo'), flight.bytes);
writeFileSync(path.join(dir, 'flight.kar.json'), flightGraph.bytes);
const mission = createKnowledgeImageV5({
  actor: 'knolo-flight-mission',
  sequence: 1,
  objects: [{ kind: 'chunk', bytes: encoder.encode(`${checklistText}\n`), meta: { source: 'mission.md' } }],
});
writeFileSync(path.join(dir, 'mission.knolo'), mission.bytes);
writeFileSync(path.join(dir, 'members.json'), `${JSON.stringify({
  format: 'composition-members-1',
  version: 1,
  members: [
    { alias: 'flight', kind: 'v5-image', path: 'flight.knolo' },
    { alias: 'witness', kind: 'kar-sidecar', path: 'flight.kar.json', bindsTo: 'flight' },
  ],
}, null, 2)}\n`);
const created = runCli(['compose', 'create', '--members', 'members.json', '--out', 'composition', '--host', 'mission.knolo'], dir);
if (created.status !== 0) throw new Error(created.stderr || created.stdout);
const attested = runCli(['attest', 'create', '--composition', 'composition', '--subject', 'composition', '--statement', 'cited', '--out', 'composition/attestation.json'], dir);
if (attested.status !== 0) throw new Error(attested.stderr || attested.stdout);
const checked = runCli(['verify-attestation', 'composition/attestation.json', '--composition', 'composition'], dir);
if (checked.status !== 0 || checked.stdout.trim() !== 'VERIFIED') {
  throw new Error(checked.stderr || checked.stdout);
}
const flipped = Buffer.from(readFileSync(path.join(dir, 'composition/members/flight.knolo')));
flipped[flipped.length - 1] ^= 1;
writeFileSync(path.join(dir, 'composition/members/flight.knolo'), flipped);
const mismatch = runCli(['compose', 'verify', 'composition'], dir);
if (mismatch.status === 0) throw new Error('tampered flight image verified');

const ingestDir = mkdtempSync(path.join(tmpdir(), 'knolo-flight-ingest-'));
writeFileSync(path.join(ingestDir, 'events.json'), readFileSync(path.join(here, 'events.json')));
writeFileSync(path.join(ingestDir, 'sample.log'), readFileSync(path.join(here, 'sample.log')));
const ingested = runCli(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'flight.knolo'], ingestDir);
if (ingested.status !== 0) throw new Error(ingested.stderr || ingested.stdout);
if (Buffer.compare(readFileSync(path.join(ingestDir, 'flight.knolo')), flight.bytes) !== 0) {
  throw new Error('CLI ingest bytes differ from the library image');
}
const badLog = Buffer.from(readFileSync(path.join(here, 'sample.log')));
badLog[0] ^= 1;
writeFileSync(path.join(ingestDir, 'bad.log'), badLog);
const refused = runCli(['flight', 'ingest', '--events', 'events.json', '--log', 'bad.log', '--out', 'refused.knolo'], ingestDir);
if (refused.status === 0) throw new Error('mismatched log was ingested');

console.log(flight.stateRoot);
console.log('VERIFIED');
console.log('Evidence requirements are not a safety or compliance determination.');
