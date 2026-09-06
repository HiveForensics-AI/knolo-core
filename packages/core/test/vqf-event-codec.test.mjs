import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestDomain,
  mountKnowledgeImageV5,
} from '../dist/index.js';
import {
  decodeVqfEventPayload,
  encodeVqfEventPayload,
} from '../dist/compression/vqf1/event_codec.js';

const fixtures = [
  'knowledge-image-v5',
  'migrated-legacy-v3',
  'migrated-v4-claims-agents',
  'transaction-snapshot',
];
const digest = (value) => digestDomain('test', canonicalCbor(value));

function eventPayload(imageBytes) {
  const image = mountKnowledgeImageV5(imageBytes);
  const segment = image.segments.find((entry) => entry.kind === 2);
  assert.ok(segment);
  return imageBytes.slice(segment.offset + 48, segment.offset + segment.length);
}

function eventRecord(fields = {}, extra = {}) {
  const identity = {
    version: 1,
    transactionId: digest(['transaction', fields.seed ?? 0]),
    parents: fields.parents ?? [],
    actor: fields.actor ?? 'writer',
    actorCounter: fields.actorCounter ?? 1,
    kind: fields.kind ?? 'document.put',
    target: fields.target ?? digest(['target', fields.seed ?? 0]),
    payload: fields.payload ?? digest(['payload', fields.seed ?? 0]),
    provenance: fields.provenance ?? { source: 'test' },
  };
  return {
    ...extra,
    id: digestDomain('event', canonicalCbor(identity)),
    ...identity,
  };
}

test('VQF event codec reproduces every current fixture payload exactly', () => {
  for (const fixture of fixtures) {
    const imageBytes = Uint8Array.from(
      Buffer.from(
        readFileSync(
          new URL(
            `../../../conformance/v5/${fixture}.fixture.base64`,
            import.meta.url
          ),
          'utf8'
        ).trim(),
        'base64'
      )
    );
    const payload = eventPayload(imageBytes);
    const first = encodeVqfEventPayload(payload);
    assert.deepEqual(encodeVqfEventPayload(payload), first);
    const decoded = decodeVqfEventPayload(first.bytes);
    assert.deepEqual(decoded.logicalPayload, payload);
    assert.equal(
      digestDomain('segment', decoded.logicalPayload),
      digestDomain('segment', payload)
    );
    assert.deepEqual(decoded.statistics, first.statistics);
  }
});

test('event codec preserves parent order, repeated fields and extensions', () => {
  const parentA = digest('parent-a');
  const parentB = digest('parent-b');
  const sharedTarget = digest('shared-object');
  const events = [
    eventRecord(
      {
        seed: 1,
        parents: [parentB, parentA, parentB],
        actor: 'writer-a',
        actorCounter: 19,
        target: sharedTarget,
        payload: sharedTarget,
        provenance: { nested: ['α', 2], objectId: sharedTarget },
      },
      { future: { enabled: true }, revision: 4 }
    ),
    eventRecord(
      {
        seed: 2,
        parents: [parentA],
        actor: 'writer-a',
        actorCounter: 20,
        kind: 'metadata.put',
        target: sharedTarget,
        payload: sharedTarget,
      },
      { note: 'retained' }
    ),
  ];
  const payload = canonicalCbor(events);
  const encoded = encodeVqfEventPayload(payload);
  assert.equal(encoded.statistics.eventCount, 2);
  assert.equal(encoded.statistics.parentReferenceCount, 4);
  assert.ok(encoded.statistics.digestCount < 12);
  const decoded = decodeVqfEventPayload(encoded.bytes).logicalPayload;
  assert.deepEqual(decoded, payload);
  assert.deepEqual(decodeCanonicalCbor(decoded), decodeCanonicalCbor(payload));
});

test('event codec handles an empty canonical payload', () => {
  const payload = canonicalCbor([]);
  const encoded = encodeVqfEventPayload(payload);
  assert.deepEqual(
    decodeVqfEventPayload(encoded.bytes).logicalPayload,
    payload
  );
  assert.deepEqual(encoded.statistics, {
    logicalBytes: 1,
    physicalBytes: 7,
    eventCount: 0,
    parentReferenceCount: 0,
    digestCount: 0,
    stringCount: 0,
  });
});

test('event codec rejects malformed records, corruption and resource excess', () => {
  const record = eventRecord({ seed: 10 });
  const payload = canonicalCbor([record]);
  const encoded = encodeVqfEventPayload(payload);
  for (const bytes of [
    new Uint8Array(),
    encoded.bytes.slice(0, -1),
    Uint8Array.of(2, ...encoded.bytes.slice(1)),
    Uint8Array.of(encoded.bytes[0], 1, ...encoded.bytes.slice(2)),
    Uint8Array.of(...encoded.bytes, 0),
  ]) {
    assert.throws(() => decodeVqfEventPayload(bytes));
  }
  assert.throws(() => encodeVqfEventPayload(canonicalCbor({})), /payload/);
  assert.throws(
    () => encodeVqfEventPayload(payload, { limits: { maxEvents: 0 } }),
    /count/
  );
  assert.throws(
    () => decodeVqfEventPayload(encoded.bytes, { limits: { maxEvents: 0 } }),
    /bound|count/
  );
  assert.throws(
    () =>
      encodeVqfEventPayload(payload, {
        limits: { maxLogicalBytes: payload.length - 1 },
      }),
    /logical/
  );
  assert.throws(
    () =>
      decodeVqfEventPayload(encoded.bytes, {
        limits: { maxPhysicalBytes: encoded.bytes.length - 1 },
      }),
    /limit/
  );
  const withParent = canonicalCbor([
    eventRecord({ seed: 11, parents: [digest('parent')] }),
  ]);
  assert.throws(
    () => encodeVqfEventPayload(withParent, { limits: { maxParents: 0 } }),
    /parent count/
  );
  const badId = { ...record, id: digest('wrong') };
  assert.throws(
    () => encodeVqfEventPayload(canonicalCbor([badId])),
    /identity/
  );
  for (const bad of [
    { ...record, version: 2 },
    { ...record, actor: '' },
    { ...record, actorCounter: 0 },
    { ...record, actorCounter: 1.5 },
    { ...record, parents: 'none' },
    { ...record, parents: ['invalid'] },
    { ...record, target: 1 },
    { ...record, provenance: [] },
  ]) {
    assert.throws(() => encodeVqfEventPayload(canonicalCbor([bad])));
  }
});

test('1,000 seeded event payloads round-trip with exact identities and bytes', () => {
  let seed = 20260906;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let caseIndex = 0; caseIndex < 1000; caseIndex++) {
    const transactionId = digest(['transaction', random() % 31]);
    const target = digest(['target', random() % 17]);
    const parentPool = [
      digest(['parent', random() % 9]),
      digest(['parent', random() % 9]),
    ];
    const makeEvent = (index) => {
      const identity = {
        version: 1,
        transactionId,
        parents: index === 0 ? [] : [...parentPool].reverse(),
        actor: `actor-${caseIndex % 5}`,
        actorCounter: index + 1 + (random() % 1000),
        kind: index % 2 ? 'document.put' : 'metadata.put',
        target,
        payload: index % 2 ? target : digest(['payload', random() % 17]),
        provenance: {
          caseIndex,
          objectId: target,
          unicode: `東京-${random() % 7}`,
        },
      };
      return {
        extension: { index, retained: true },
        id: digestDomain('event', canonicalCbor(identity)),
        ...identity,
      };
    };
    const records = [makeEvent(0), makeEvent(1), makeEvent(2)];
    if (caseIndex % 2) records.reverse();
    const payload = canonicalCbor(records);
    const encoded = encodeVqfEventPayload(payload);
    assert.deepEqual(encodeVqfEventPayload(payload), encoded);
    const decoded = decodeVqfEventPayload(encoded.bytes);
    assert.deepEqual(decoded.logicalPayload, payload);
    assert.equal(
      digestDomain('segment', decoded.logicalPayload),
      digestDomain('segment', payload)
    );
  }
});
