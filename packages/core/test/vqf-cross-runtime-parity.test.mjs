import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mountKnowledgeImageV5 } from '../dist/index.js';

const manifest = JSON.parse(
  readFileSync(
    new URL('../../../conformance/vqf1/manifest.json', import.meta.url),
    'utf8'
  )
);

function fixtureBytes() {
  return Uint8Array.from(
    Buffer.from(
      readFileSync(
        new URL(
          '../../../conformance/vqf1/required-object-vqf.fixture.base64',
          import.meta.url
        ),
        'utf8'
      ).replace(/\s+/g, ''),
      'base64'
    )
  );
}

test('VQF compressed object fixture matches the shared cross-runtime manifest', () => {
  const bytes = fixtureBytes();
  const image = mountKnowledgeImageV5(bytes);
  const physicalDigest = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;

  assert.equal(bytes.length, manifest.physicalBytes);
  assert.equal(physicalDigest, manifest.physicalDigest);
  assert.equal(image.stateRoot, manifest.stateRoot);
  assert.equal(image.commitDigest, manifest.commitDigest);
  assert.equal(image.objects.length, manifest.objectCount);
  assert.deepEqual(
    image.segments.map(({ kind, flags, digest }) => ({ kind, flags, digest })),
    manifest.segments
  );
});

test('VQF compressed event fixture matches the shared cross-runtime manifest', () => {
  const eventManifest = manifest.eventFixture;
  const bytes = Uint8Array.from(
    Buffer.from(
      readFileSync(
        new URL(
          `../../../conformance/vqf1/${eventManifest.fixture}`,
          import.meta.url
        ),
        'utf8'
      ).replace(/\s+/g, ''),
      'base64'
    )
  );
  const image = mountKnowledgeImageV5(bytes);
  assert.equal(bytes.length, eventManifest.physicalBytes);
  assert.equal(
    `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
    eventManifest.physicalDigest
  );
  assert.equal(image.stateRoot, eventManifest.stateRoot);
  assert.equal(image.commitDigest, eventManifest.commitDigest);
  assert.equal(image.objects.length, eventManifest.objectCount);
  assert.equal(image.events.length, eventManifest.eventCount);
  assert.deepEqual(
    image.segments.map(({ kind, flags, digest }) => ({ kind, flags, digest })),
    eventManifest.segments
  );
});
