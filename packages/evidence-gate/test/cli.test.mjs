import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '@knolo/core';
import { evidenceSourceDigestV1 } from '../dist/index.js';
import { runEvidenceGate } from '../bin/evidence-gate.mjs';

const encoder = new TextEncoder();

test('CLI checks and explains a request from files', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'knolo-evidence-gate-'));
  const policy = {
    version: 1,
    default: 'deny',
    rules: [{ effect: 'allow', action: 'read', principal: 'support-agent' }],
  };
  const image = createKnowledgeImageV5({
    policy,
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode('Refunds are available.'),
        meta: {},
      },
    ],
  });
  const imagePath = path.join(directory, 'knowledge.v5');
  const requestPath = path.join(directory, 'request.json');
  const resultPath = path.join(directory, 'result.json');
  writeFileSync(imagePath, image.bytes);
  writeFileSync(
    requestPath,
    JSON.stringify({
      principal: 'support-agent',
      policy: {
        knowledge: policy,
        onConflict: 'contested',
        requireEvidenceFor: ['fact'],
      },
      claims: [
        {
          id: 'refunds',
          text: 'Refunds are available.',
          modality: 'fact',
          evidence: [
            {
              objectId: image.objects[0].id,
              sourceDigest: evidenceSourceDigestV1(image, image.objects[0].id),
              start: 0,
              end: image.objects[0].bytes.length,
              relation: 'supports',
            },
          ],
        },
      ],
    })
  );
  const checked = runEvidenceGate([
    'check',
    '--image',
    imagePath,
    '--request',
    requestPath,
    '--out',
    resultPath,
  ]);
  writeFileSync(resultPath, `${JSON.stringify(checked.value)}\n`);
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.equal(result.overall, 'supported');
  const explanation = runEvidenceGate([
    'explain',
    '--image',
    imagePath,
    '--request',
    requestPath,
    '--result',
    resultPath,
  ]);
  assert.match(
    explanation.value.claims[0].evidence[0].text,
    /Refunds are available/
  );
});
