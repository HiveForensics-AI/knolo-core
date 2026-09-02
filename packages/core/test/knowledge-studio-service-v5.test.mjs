import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { createKnowledgeStudioServiceV5 } from '../dist/node.js';

function fixture() {
  return createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('studio service'),
        meta: {},
      },
    ],
  });
}

test('V5 Studio service serves authorized read-only snapshots', async () => {
  const image = fixture();
  const calls = [];
  const service = createKnowledgeStudioServiceV5({
    load: () => ({ image: image.bytes }),
    authorizeRead: (request) => {
      calls.push(request);
      return request.method === 'GET' || request.method === 'HEAD';
    },
  });

  const response = await service.handle(
    new Request('https://studio.test/studio/v5')
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal((await response.json()).readOnly, true);
  assert.equal(calls.length, 1);

  const head = await service.handle(
    new Request('https://studio.test/studio/v5', { method: 'HEAD' })
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(calls.length, 2);

  const post = await service.handle(
    new Request('https://studio.test/studio/v5', { method: 'POST' })
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.match(await post.text(), /read[_-]only/);
  assert.equal(calls.length, 2);

  const snapshot = await service.snapshot();
  assert.equal(snapshot.diagnostics.image.stateRoot, image.stateRoot);
  assert.equal(snapshot.capabilities.mutateImage, false);
});

test('V5 Studio service preserves host authorization and route boundaries', async () => {
  const service = createKnowledgeStudioServiceV5({
    load: () => ({ image: fixture().bytes }),
    authorizeRead: () => false,
  });

  const denied = await service.handle(
    new Request('https://studio.test/studio/v5')
  );
  assert.equal(denied.status, 403);

  const missing = await service.handle(
    new Request('https://studio.test/other')
  );
  assert.equal(missing.status, 404);
});

test('V5 Studio service fails closed when the snapshot loader is unavailable', async () => {
  const service = createKnowledgeStudioServiceV5({
    load: () => {
      throw new Error('private loader failure');
    },
  });

  const response = await service.handle(
    new Request('https://studio.test/studio/v5')
  );
  assert.equal(response.status, 503);
  assert.equal(
    await response.text(),
    '{"error":"studio_snapshot_unavailable"}'
  );
});

test('V5 Studio service rejects non-normalized paths at construction', () => {
  assert.throws(
    () =>
      createKnowledgeStudioServiceV5({
        path: 'studio/v5',
        load: () => ({ image: fixture().bytes }),
      }),
    /absolute|normalized/
  );
  assert.throws(
    () =>
      createKnowledgeStudioServiceV5({
        path: '/studio/v5/',
        load: () => ({ image: fixture().bytes }),
      }),
    /absolute|normalized/
  );
});
