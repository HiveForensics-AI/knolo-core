import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(
  pathToFileURL(path.join(root, 'packages/core/dist/index.js')).href
);

const legacyBytes = await core.buildPack([
  {
    id: 'v5-smoke-source',
    text: 'V5 smoke content proves deterministic migration, query, and receipts.',
  },
]);
const pack = await core.mountPack({ src: legacyBytes });
const hits = core.query(pack, 'deterministic migration');
assert.ok(hits.length > 0, 'legacy query returned no hits');
const receipt = core.queryWithReceipt(pack, 'deterministic migration').receipt;
core.verifyReceipt(receipt, pack);

const migration = await core.migrateV4ToV5(legacyBytes);
const image = core.mountKnowledgeImageV5(migration.image);
const inspected = core.inspectKnowledgeImageV5(migration.image);
const verification = core.verifyKnowledgeImageV5(migration.image);
assert.equal(inspected.valid, true);
assert.equal(verification.valid, true);
assert.equal(verification.stateRoot, image.stateRoot);
assert.equal(verification.commitDigest, image.commitDigest);
assert.ok(
  verification.segments.length >= 3,
  'V5 image inspection found too few segments'
);
const v5Query = core.queryKnowledgeImageV5(
  image,
  'FROM chunk SEARCH "deterministic" LIMIT 5'
);
assert.ok(v5Query.hits.length > 0, 'V5 image query returned no hits');

console.log(
  'V5 clean-environment smoke passed: create, inspect, query, verify, migrate, and receipt.'
);
