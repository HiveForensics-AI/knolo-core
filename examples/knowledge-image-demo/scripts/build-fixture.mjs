import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKnowledgeImageV5 } from '@knolo/core';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(appRoot, 'public/demo-image.v5');
const encoder = new TextEncoder();

const image = createKnowledgeImageV5({
  actor: 'knowledge-image-demo-fixture',
  objects: [
    {
      kind: 'source',
      bytes: encoder.encode('Flight operations handbook'),
      meta: {
        sourceId: 'flight-ops',
        title: 'Flight Operations Handbook',
        path: 'fixtures/flight-ops/handbook.txt',
      },
    },
    {
      kind: 'chunk',
      bytes: encoder.encode(
        'Before arming the aircraft, confirm the checklist, inspect the area, and verify the configured failsafe.'
      ),
      meta: { sourceId: 'flight-ops' },
    },
    {
      kind: 'chunk',
      bytes: encoder.encode(
        'If GPS quality drops below the required threshold, pause the operation and follow the failsafe procedure.'
      ),
      meta: { sourceId: 'flight-ops' },
    },
    {
      kind: 'source',
      bytes: encoder.encode('Maintenance notes'),
      meta: {
        sourceId: 'maintenance',
        title: 'Maintenance Notes',
        path: 'fixtures/maintenance/notes.txt',
      },
    },
    {
      kind: 'chunk',
      bytes: encoder.encode(
        'Record each completed inspection and include the date and technician identifier.'
      ),
      meta: { sourceId: 'maintenance' },
    },
  ],
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, image.bytes);
console.log(`Wrote ${outputPath}`);
