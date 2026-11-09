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
  return Uint8Array.from(
    Buffer.from(
      readFileSync(
        '../../conformance/v5/knowledge-image-v5.fixture.base64',
        'utf8'
      ).trim(),
      'base64'
    )
  );
}

test('V5 EQL query roots are deterministic and verifiable', () => {
  const image = fixtureImage();
  const first = queryKnowledgeImageV5(
    image,
    'FROM metadata SEARCH "hello" LIMIT 10'
  );
  const second = queryKnowledgeImageV5(
    image,
    'from metadata search "HELLO" limit 10'
  );
  assert.deepEqual(second, first);
  assert.equal(
    first.planRoot,
    'sha256-832b843bb24c188ec60f54689a2e6c3af7c4c8c1121c3c8fa782a89b06db5d11'
  );
  assert.equal(
    first.resultRoot,
    'sha256-577f70602232871a16191a9648ddac3a8788f9508898ddad2f6a287efb489f9b'
  );
  assert.equal(first.hits.length, 1);
  verifyKnowledgeQueryResultV5(image, first);
});

test('V5 EQL filters scalar metadata and normalize AND order', () => {
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('Alpha evidence'),
        meta: { namespace: 'Docs', rank: 1 },
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('Beta evidence'),
        meta: { namespace: 'other', rank: 1 },
      },
    ],
  });
  const first = queryKnowledgeImageV5(
    image,
    'FROM chunk WHERE meta.rank = 1 AND meta.namespace = "DOCS" SEARCH "alpha" LIMIT 10'
  );
  const second = queryKnowledgeImageV5(
    image,
    'FROM chunk WHERE meta.namespace = "docs" AND meta.rank = 1 SEARCH "ALPHA" LIMIT 10'
  );
  assert.deepEqual(first, second);
  assert.equal(first.hits.length, 1);
  assert.equal(first.hits[0].kind, 'chunk');
});

test('V5 EQL remounts mutable KnowledgeImage inputs before querying', () => {
  const image = createKnowledgeImageV5({
    objects: [
      { kind: 'chunk', bytes: new TextEncoder().encode('original'), meta: {} },
    ],
  });
  const object = image.objects[0];
  object.bytes = new TextEncoder().encode('tampered');
  const result = queryKnowledgeImageV5(
    image,
    'FROM chunk SEARCH "original" LIMIT 10'
  );
  assert.equal(result.hits.length, 1);
  verifyKnowledgeQueryResultV5(image, result);
});

test('V5 EQL rejects unsupported or unbounded expressions', () => {
  assert.throws(
    () => parseKnowledgeQueryV5('SELECT * FROM chunk'),
    /start with FROM/i
  );
  assert.throws(
    () => parseKnowledgeQueryV5('FROM chunk WHERE bytes = "x"'),
    /unsupported.*field/i
  );
  assert.throws(
    () => parseKnowledgeQueryV5('FROM chunk LIMIT 1001'),
    /between 1 and 1000/i
  );
  assert.throws(
    () => parseKnowledgeQueryV5('FROM chunk SEARCH ""'),
    /cannot be empty/i
  );
  assert.throws(
    () => parseKnowledgeQueryV5('FROM chunk ORDER BY bytes'),
    /unsupported.*order field/i
  );
  assert.throws(
    () => parseKnowledgeQueryV5('FROM chunk JOIN metadata ON bytes = meta.key'),
    /unsupported.*join field/i
  );
});

test('V5 EQL ordering is deterministic with an object-id tie break', () => {
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('one'),
        meta: { rank: 1 },
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('two'),
        meta: { rank: 2 },
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('three'),
        meta: { rank: 1 },
      },
    ],
  });
  const descending = queryKnowledgeImageV5(
    image,
    'FROM chunk ORDER BY meta.rank DESC LIMIT 10'
  );
  const normalized = queryKnowledgeImageV5(
    image,
    'from chunk order by meta.rank desc limit 10'
  );
  assert.deepEqual(normalized, descending);
  assert.equal(descending.plan.orderBy.direction, 'desc');
  assert.equal(descending.hits.length, 3);
  assert.equal(
    descending.hits[0].objectId,
    image.objects.find((object) => Number(object.meta.rank) === 2).id
  );
  const ascending = queryKnowledgeImageV5(
    image,
    'FROM chunk ORDER BY meta.rank ASC LIMIT 10'
  );
  assert.equal(
    ascending.hits[0].objectId,
    image.objects
      .filter((object) => Number(object.meta.rank) === 1)
      .sort((left, right) => left.id.localeCompare(right.id))[0].id
  );
  assert.notEqual(descending.resultRoot, ascending.resultRoot);
});

test('V5 EQL equality joins return stable joined identities', () => {
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'source',
        bytes: new TextEncoder().encode('source-a'),
        meta: { ref: 'alpha' },
      },
      {
        kind: 'source',
        bytes: new TextEncoder().encode('source-b'),
        meta: { ref: 'missing' },
      },
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('metadata-a'),
        meta: { key: 'alpha' },
      },
    ],
  });
  const joined = queryKnowledgeImageV5(
    image,
    'FROM source JOIN metadata ON meta.ref = meta.key ORDER BY id ASC LIMIT 10'
  );
  const repeated = queryKnowledgeImageV5(
    image,
    'from source join metadata on meta.ref = meta.key order by id asc limit 10'
  );
  assert.deepEqual(repeated, joined);
  assert.deepEqual(joined.plan.joins, [
    { kind: 'metadata', leftField: 'meta.ref', rightField: 'meta.key' },
  ]);
  assert.equal(joined.hits.length, 1);
  assert.equal(joined.hits[0].kind, 'source');
  assert.deepEqual(joined.hits[0].joinedObjectIds, [
    image.objects.find((object) => object.kind === 'metadata').id,
  ]);
  assert.match(joined.resultRoot, /^sha256-[0-9a-f]{64}$/);
});

function textPlan(terms, mode = 'all', rank = 'relevance') {
  return {
    version: 1,
    source: 'knowledge-image-v5',
    kind: 'chunk',
    filters: [],
    search: null,
    limit: 10,
    textQuery: {
      mode,
      rank,
      terms: terms.map((term) =>
        typeof term === 'string' ? { text: term, phrase: false } : term
      ),
    },
  };
}

test('textQuery matches whole words and leaves EQL substring search in id order', () => {
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('quote and quota'),
        meta: {},
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('a quo mark'),
        meta: {},
      },
    ],
  });
  const substring = queryKnowledgeImageV5(
    image,
    'FROM chunk SEARCH "quo" LIMIT 10'
  );
  assert.equal(substring.plan.textQuery, undefined);
  assert.equal(substring.plan.search, 'quo');
  assert.equal(substring.hits.length, 2);
  assert.deepEqual(
    substring.hits.map((hit) => hit.objectId),
    image.objects.map((object) => object.id)
  );
  verifyKnowledgeQueryResultV5(image, substring);

  const whole = queryKnowledgeImageV5(image, textPlan(['quo']));
  assert.equal(whole.plan.search, null);
  assert.equal(whole.hits.length, 1);
  assert.equal(
    whole.hits[0].objectId,
    image.objects.find((object) =>
      new TextDecoder().decode(object.bytes).includes('quo mark')
    ).id
  );
  verifyKnowledgeQueryResultV5(image, whole);
  const replay = queryKnowledgeImageV5(image, whole.plan);
  assert.deepEqual(replay.hits, whole.hits);
  assert.equal(replay.resultRoot, whole.resultRoot);
});

test('textQuery phrases, partial mode, and empty terms do not match every chunk', () => {
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('annual enterprise refunds are due'),
        meta: {},
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('enterprise customer refunds'),
        meta: {},
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('alpha only'),
        meta: {},
      },
    ],
  });
  const phrase = queryKnowledgeImageV5(
    image,
    textPlan([{ text: 'enterprise refunds', phrase: true }])
  );
  assert.equal(phrase.hits.length, 1);
  assert.match(
    new TextDecoder().decode(
      image.objects.find((object) => object.id === phrase.hits[0].objectId)
        .bytes
    ),
    /annual enterprise refunds/
  );

  const all = queryKnowledgeImageV5(image, textPlan(['alpha', 'zebra']));
  assert.equal(all.hits.length, 0);
  const partial = queryKnowledgeImageV5(
    image,
    textPlan(['alpha', 'zebra'], 'partial')
  );
  assert.equal(partial.hits.length, 1);
  verifyKnowledgeQueryResultV5(image, partial);

  const empty = queryKnowledgeImageV5(image, textPlan([]));
  assert.equal(empty.hits.length, 0);
  verifyKnowledgeQueryResultV5(image, empty);
});

test('relevance rank puts a path match ahead of an earlier object id', () => {
  let image;
  let named;
  let earlier;
  for (let pad = 0; pad < 40; pad += 1) {
    const filler = 'x'.repeat(pad);
    image = createKnowledgeImageV5({
      objects: [
        {
          kind: 'chunk',
          bytes: new TextEncoder().encode(
            `source: notes/other.md\n\n${filler} billing is mentioned once in the body.`
          ),
          meta: {
            path: 'notes/other.md',
            scope: 'files',
            locator: 'lines 1-3',
          },
        },
        {
          kind: 'chunk',
          bytes: new TextEncoder().encode(
            `source: skills/billing.md\n\n${filler} no extra terms here.`
          ),
          meta: {
            path: 'skills/billing.md',
            scope: 'skills',
            locator: 'lines 1-3',
          },
        },
      ],
    });
    named = image.objects.find(
      (object) => object.meta.path === 'skills/billing.md'
    );
    earlier = image.objects.find(
      (object) => object.meta.path === 'notes/other.md'
    );
    if (named.id > earlier.id) break;
  }
  assert.ok(named.id > earlier.id);
  const ranked = queryKnowledgeImageV5(image, textPlan(['billing']));
  assert.equal(ranked.hits[0].objectId, named.id);
  const byId = queryKnowledgeImageV5(image, textPlan(['billing'], 'all', 'id'));
  assert.equal(byId.hits[0].objectId, earlier.id);
  assert.notEqual(ranked.resultRoot, byId.resultRoot);
  verifyKnowledgeQueryResultV5(image, ranked);
  const eql = queryKnowledgeImageV5(
    image,
    'FROM chunk SEARCH "billing" LIMIT 10'
  );
  assert.equal(eql.hits[0].objectId, earlier.id);
  verifyKnowledgeQueryResultV5(image, eql);
});
