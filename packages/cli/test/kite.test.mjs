import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../../core/dist/index.js';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
const cliPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bin/knolo.mjs'
);
const example = path.join(root, 'examples/kite-policy');

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('knolo kite evaluates and verifies the policy example', () => {
  const help = run(['kite', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /kite evaluate/);
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-kite-'));
  try {
    const image = createKnowledgeImageV5({
      actor: 'kite-cli',
      sequence: 1,
      objects: [
        {
          kind: 'chunk',
          bytes: Buffer.from(
            'The security policy forbids contractor access.\n'
          ),
          meta: { source: 'policy.md' },
        },
        {
          kind: 'chunk',
          bytes: Buffer.from(
            'The contractor exception allows restricted access.\n'
          ),
          meta: { source: 'exception.md' },
        },
      ],
    });
    const imagePath = path.join(dir, 'policy.knolo');
    const outPath = path.join(dir, 'result.json');
    writeFileSync(imagePath, Buffer.from(image.bytes));
    const evaluated = run([
      'kite',
      'evaluate',
      '--image',
      imagePath,
      '--contract',
      path.join(example, 'contract.json'),
      '--rules',
      path.join(example, 'rules.json'),
      '--completeness',
      path.join(example, 'completeness.json'),
      '--as-of',
      '2026-11-10',
      '--out',
      outPath,
      '--json',
    ]);
    assert.equal(evaluated.status, 0, evaluated.stderr);
    const result = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(result.verdict, 'UNDERDETERMINED');
    assert.equal(result.retrievals[0].obligationId, 'approval');
    const certificatePath = path.join(dir, 'certificate.json');
    writeFileSync(certificatePath, JSON.stringify(result.certificate));
    const verified = run([
      'kite',
      'verify',
      '--image',
      imagePath,
      '--contract',
      path.join(example, 'contract.json'),
      '--rules',
      path.join(example, 'rules.json'),
      '--completeness',
      path.join(example, 'completeness.json'),
      '--as-of',
      '2026-11-10',
      '--certificate',
      certificatePath,
    ]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /^ok sha256-/);
    result.certificate.verdict = 'WARRANTED_IN_SCOPE';
    writeFileSync(certificatePath, JSON.stringify(result.certificate));
    const rejected = run([
      'kite',
      'verify',
      '--image',
      imagePath,
      '--contract',
      path.join(example, 'contract.json'),
      '--rules',
      path.join(example, 'rules.json'),
      '--completeness',
      path.join(example, 'completeness.json'),
      '--as-of',
      '2026-11-10',
      '--certificate',
      certificatePath,
    ]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /KITE_CERTIFICATE_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
