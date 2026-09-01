import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectKnowledgeRuntimeV5,
  inspectKnowledgeStudioManagementV5,
} from '../dist/index.js';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
  'conformance/v5'
);
const fixture = JSON.parse(
  readFileSync(
    path.join(root, 'runtime-diagnostics-studio-v1.fixture.json'),
    'utf8'
  )
);
const image = Uint8Array.from(
  Buffer.from(
    readFileSync(path.join(root, fixture.image), 'utf8').replace(/\s/g, ''),
    'base64'
  )
);

test('V5 diagnostics and Studio roots match the shared fixture', () => {
  const diagnostics = inspectKnowledgeRuntimeV5({ image });
  const studio = inspectKnowledgeStudioManagementV5({ image });

  assert.deepEqual(diagnostics, fixture.diagnostics);
  assert.equal(studio.managementRoot, fixture.studio.managementRoot);
  assert.deepEqual(
    { ...studio, diagnostics: undefined },
    { ...fixture.studio, diagnostics: undefined }
  );
});
