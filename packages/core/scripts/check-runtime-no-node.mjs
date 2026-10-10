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
const runtimeBundle = await readFile(distIndexPath, 'utf8');
const karBundle = await readFile(karIndexPath, 'utf8');
const authoringBundle = await readFile(authoringIndexPath, 'utf8');

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
  karBundle.includes('/authoring'),
  false,
  'KAR retrieval entry must not load the CEG authoring compiler'
);
for (const token of karForbidden) {
  assert.equal(
    authoringBundle.includes(token),
    false,
    `CEG authoring entry must not include Node stdlib reference: ${token}`
  );
}

console.log('Runtime bundle contains no Node stdlib specifiers.');
