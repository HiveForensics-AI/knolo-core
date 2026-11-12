import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createKnowledgeCapsuleV1,
  createKnowledgeImageV5,
  decodeKnowledgeCapsuleV1,
  encodeKnowledgeCapsuleV1,
  knowledgeObjectIdV1,
  verifyKnowledgeCapsuleV1,
} from '../../../packages/core/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const done = new Set();

function finish(name) {
  done.add(name);
}

export async function runCapsuleConformance() {
  const image = createKnowledgeImageV5({
    objects: [
      { kind: 'metadata', bytes: new TextEncoder().encode('alpha'), meta: {} },
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('beta'),
        meta: { label: 'b' },
      },
    ],
  });
  const selected = image.objects[1];
  assert.equal(
    knowledgeObjectIdV1({
      kind: selected.kind,
      bytes: selected.bytes,
      meta: selected.meta,
    }),
    selected.id
  );
  const capsule = createKnowledgeCapsuleV1({
    image,
    objectIds: [selected.id],
  });
  const decoded = decodeKnowledgeCapsuleV1(encodeKnowledgeCapsuleV1(capsule));
  assert.equal(
    verifyKnowledgeCapsuleV1(decoded, image.stateRoot).stateRoot,
    image.stateRoot
  );
  assert.equal(decoded.objects.length, 1);
  assert.deepEqual(
    decoded.objectIds,
    image.objects.map((object) => object.id)
  );
  finish('valid-capsule');

  const swapped = {
    ...decoded,
    objects: decoded.objects.map((object) => ({
      ...object,
      bytes: new TextEncoder().encode('swapped'),
    })),
  };
  assert.throws(
    () => verifyKnowledgeCapsuleV1(swapped, image.stateRoot),
    /object id mismatch/
  );
  finish('swapped-object-body');

  const shortened = { ...decoded, objectIds: [selected.id] };
  assert.throws(
    () => verifyKnowledgeCapsuleV1(shortened, image.stateRoot),
    /object root mismatch/
  );
  finish('object-root-mismatch');

  const mutated = {
    ...decoded,
    commit: {
      ...decoded.commit,
      eventRoot: `sha256-${'11'.repeat(32)}`,
    },
  };
  assert.throws(
    () => verifyKnowledgeCapsuleV1(mutated, image.stateRoot),
    /state root mismatch/
  );
  finish('state-root-mismatch');

  const expected = JSON.parse(
    readFileSync(path.join(here, 'expected.json'), 'utf8')
  );
  assert.deepEqual([...done].sort(), [...expected.cases].sort());
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  runCapsuleConformance().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
