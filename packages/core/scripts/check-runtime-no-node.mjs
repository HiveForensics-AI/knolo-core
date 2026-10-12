import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distIndexPath = fileURLToPath(
  new URL('../dist/index.js', import.meta.url)
);
const karIndexPath = fileURLToPath(
  new URL('../dist/experimental/kar/index.js', import.meta.url)
);
const authoringIndexPath = fileURLToPath(
  new URL('../dist/experimental/kar/authoring/index.js', import.meta.url)
);
const publicKarPath = fileURLToPath(
  new URL('../dist/kar/index.js', import.meta.url)
);
const publicAuthoringPath = fileURLToPath(
  new URL('../dist/kar/authoring/index.js', import.meta.url)
);
const compositionIndexPath = fileURLToPath(
  new URL('../dist/composition/index.js', import.meta.url)
);
const rootSourcePath = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const runtimeBundle = await readFile(distIndexPath, 'utf8');
const karBundle = await readFile(karIndexPath, 'utf8');
const authoringBundle = await readFile(authoringIndexPath, 'utf8');
const publicKarBundle = await readFile(publicKarPath, 'utf8');
const publicAuthoringBundle = await readFile(publicAuthoringPath, 'utf8');
const compositionBundle = await readFile(compositionIndexPath, 'utf8');
const rootSource = await readFile(rootSourcePath, 'utf8');

const forbidden = ['node:fs', 'fs/promises', 'node:path'];
for (const token of forbidden) {
  assert.equal(
    runtimeBundle.includes(token),
    false,
    `Runtime entry must not include Node stdlib reference: ${token}`
  );
}

const karForbidden = ['node:fs', 'fs/promises', 'node:path', 'node:crypto'];
for (const token of karForbidden) {
  assert.equal(
    karBundle.includes(token),
    false,
    `Experimental KAR entry must not include Node stdlib reference: ${token}`
  );
}
assert.equal(
  runtimeBundle.includes('experimental/kar'),
  false,
  'Root runtime entry must not load experimental KAR'
);
assert.equal(
  runtimeBundle.includes('/kar/index'),
  false,
  'Root runtime entry must not load the public KAR entry'
);
assert.equal(
  karBundle.includes('/authoring'),
  false,
  'KAR retrieval entry must not load the CEG authoring compiler'
);
assert.equal(
  publicKarBundle.includes('/authoring'),
  false,
  'Public KAR entry must not load the CEG authoring compiler'
);
for (const token of karForbidden) {
  assert.equal(
    publicKarBundle.includes(token),
    false,
    `Public KAR entry must not include Node stdlib reference: ${token}`
  );
  assert.equal(
    publicAuthoringBundle.includes(token),
    false,
    `Public CEG authoring entry must not include Node stdlib reference: ${token}`
  );
}
for (const token of karForbidden) {
  assert.equal(
    authoringBundle.includes(token),
    false,
    `CEG authoring entry must not include Node stdlib reference: ${token}`
  );
}

for (const token of ['node:fs', 'fs/promises', 'node:path', 'node:crypto', '/authoring']) {
  assert.equal(
    compositionBundle.includes(token),
    false,
    `Composition entry must not include ${token}`
  );
}
assert.equal(runtimeBundle.includes('createCompositionRecord'), false, 'Root runtime entry must not export composition');
assert.equal(runtimeBundle.includes('composition-record-1'), false, 'Root runtime entry must not name composition records');
assert.equal(rootSource.includes('createCompositionRecord'), false, 'Root source entry must not export composition');
assert.equal(rootSource.includes('composition-record-1'), false, 'Root source entry must not name composition records');
assert.equal(publicKarBundle.includes('composition-record-1'), false, 'Public KAR entry must not name composition records');

console.log('Runtime bundle contains no Node stdlib specifiers.');
