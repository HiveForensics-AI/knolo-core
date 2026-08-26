import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  parseKnowledgeQueryV5,
  queryKnowledgeImageV5,
  verifyKnowledgeQueryResultV5,
} from '../dist/index.js';

function fixtureImage() {
  return Uint8Array.from(Buffer.from(readFileSync('../../conformance/v5/knowledge-image-v5.fixture.base64', 'utf8').trim(), 'base64'));
}

test('V5 EQL query roots are deterministic and verifiable', () => {
  const image = fixtureImage();
  const first = queryKnowledgeImageV5(image, 'FROM metadata SEARCH "hello" LIMIT 10');
  const second = queryKnowledgeImageV5(image, 'from metadata search "HELLO" limit 10');
  assert.deepEqual(second, first);
  assert.equal(first.planRoot, 'sha256-832b843bb24c188ec60f54689a2e6c3af7c4c8c1121c3c8fa782a89b06db5d11');
  assert.equal(first.resultRoot, 'sha256-577f70602232871a16191a9648ddac3a8788f9508898ddad2f6a287efb489f9b');
  assert.equal(first.hits.length, 1);
  verifyKnowledgeQueryResultV5(image, first);
});

test('V5 EQL filters scalar metadata and normalize AND order', () => {
  const image = createKnowledgeImageV5({ objects: [
    { kind: 'chunk', bytes: new TextEncoder().encode('Alpha evidence'), meta: { namespace: 'Docs', rank: 1 } },
    { kind: 'chunk', bytes: new TextEncoder().encode('Beta evidence'), meta: { namespace: 'other', rank: 1 } },
  ] });
  const first = queryKnowledgeImageV5(image, 'FROM chunk WHERE meta.rank = 1 AND meta.namespace = "DOCS" SEARCH "alpha" LIMIT 10');
  const second = queryKnowledgeImageV5(image, 'FROM chunk WHERE meta.namespace = "docs" AND meta.rank = 1 SEARCH "ALPHA" LIMIT 10');
  assert.deepEqual(first, second);
  assert.equal(first.hits.length, 1);
  assert.equal(first.hits[0].kind, 'chunk');
});

test('V5 EQL rejects unsupported or unbounded expressions', () => {
  assert.throws(() => parseKnowledgeQueryV5('SELECT * FROM chunk'), /start with FROM/i);
  assert.throws(() => parseKnowledgeQueryV5('FROM chunk WHERE bytes = "x"'), /unsupported.*field/i);
  assert.throws(() => parseKnowledgeQueryV5('FROM chunk LIMIT 1001'), /between 1 and 1000/i);
  assert.throws(() => parseKnowledgeQueryV5('FROM chunk SEARCH ""'), /cannot be empty/i);
  assert.throws(() => parseKnowledgeQueryV5('FROM chunk ORDER BY bytes'), /unsupported.*order field/i);
  assert.throws(() => parseKnowledgeQueryV5('FROM chunk JOIN metadata ON bytes = meta.key'), /unsupported.*join field/i);
});

test('V5 EQL ordering is deterministic with an object-id tie break', () => {
  const image = createKnowledgeImageV5({ objects: [
    { kind: 'chunk', bytes: new TextEncoder().encode('one'), meta: { rank: 1 } },
    { kind: 'chunk', bytes: new TextEncoder().encode('two'), meta: { rank: 2 } },
    { kind: 'chunk', bytes: new TextEncoder().encode('three'), meta: { rank: 1 } },
  ] });
  const descending = queryKnowledgeImageV5(image, 'FROM chunk ORDER BY meta.rank DESC LIMIT 10');
  const normalized = queryKnowledgeImageV5(image, 'from chunk order by meta.rank desc limit 10');
  assert.deepEqual(normalized, descending);
  assert.equal(descending.plan.orderBy.direction, 'desc');
  assert.equal(descending.hits.length, 3);
  assert.equal(descending.hits[0].objectId, image.objects.find((object) => Number(object.meta.rank) === 2).id);
  const ascending = queryKnowledgeImageV5(image, 'FROM chunk ORDER BY meta.rank ASC LIMIT 10');
  assert.equal(ascending.hits[0].objectId, image.objects.filter((object) => Number(object.meta.rank) === 1).sort((left, right) => left.id.localeCompare(right.id))[0].id);
  assert.notEqual(descending.resultRoot, ascending.resultRoot);
});

test('V5 EQL equality joins return stable joined identities', () => {
  const image = createKnowledgeImageV5({ objects: [
    { kind: 'source', bytes: new TextEncoder().encode('source-a'), meta: { ref: 'alpha' } },
    { kind: 'source', bytes: new TextEncoder().encode('source-b'), meta: { ref: 'missing' } },
    { kind: 'metadata', bytes: new TextEncoder().encode('metadata-a'), meta: { key: 'alpha' } },
  ] });
  const joined = queryKnowledgeImageV5(image, 'FROM source JOIN metadata ON meta.ref = meta.key ORDER BY id ASC LIMIT 10');
  const repeated = queryKnowledgeImageV5(image, 'from source join metadata on meta.ref = meta.key order by id asc limit 10');
  assert.deepEqual(repeated, joined);
  assert.deepEqual(joined.plan.joins, [{ kind: 'metadata', leftField: 'meta.ref', rightField: 'meta.key' }]);
  assert.equal(joined.hits.length, 1);
  assert.equal(joined.hits[0].kind, 'source');
  assert.deepEqual(joined.hits[0].joinedObjectIds, [image.objects.find((object) => object.kind === 'metadata').id]);
  assert.match(joined.resultRoot, /^sha256-[0-9a-f]{64}$/);
});
