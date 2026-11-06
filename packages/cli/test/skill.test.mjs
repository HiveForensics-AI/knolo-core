import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { guidanceError, skillNameError } from '../bin/skill.mjs';

const cliPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bin/knolo.mjs'
);

const receiptBody = [
  'Cite the receipt id.',
  'A receipt is an integrity check. It does not mean a claim is proven.',
  'SATISFIED means the evidence requirements were met.',
].join('\n');

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'knolo-skill-'));
}

test('skill help states the receipt limit', () => {
  const root = run(['help'], process.cwd());
  assert.equal(root.status, 0, root.stderr);
  assert.match(root.stdout, /\n {2}skill {2,}/);
  const help = run(['skill', '--help'], process.cwd());
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not mean a claim is proven/);
  assert.match(help.stdout, /hub\.knolo\.dev/);
  assert.match(help.stdout, /does not answer questions/);
  assert.doesNotMatch(help.stdout, /Claim proven/);
  const bare = run(['skill'], process.cwd());
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /does not mean a claim is proven/);
});

test('skill names and guidance stay explicit', () => {
  assert.equal(skillNameError('refund-policy'), null);
  assert.match(skillNameError('Refund'), /SKILL_NAME/);
  assert.match(skillNameError('a--b'), /SKILL_NAME/);
  assert.match(skillNameError('-policy'), /SKILL_NAME/);
  const allowed = [
    'Do not skip the pin.',
    'Cite the receipt id.',
    'A receipt is an integrity check. It does not mean a claim is proven.',
  ].join('\n');
  assert.equal(guidanceError(allowed), null);
  assert.match(
    guidanceError(`Skip the pin.\n${receiptBody}`),
    /SKILL_GUIDANCE/
  );
  assert.match(
    guidanceError(`Do not cite a receipt.\n${receiptBody}`),
    /SKILL_GUIDANCE/
  );
  assert.match(
    guidanceError(`Cite the receipt in /home/shared.\n${receiptBody}`),
    /SKILL_GUIDANCE/
  );
});

test('init refuses a bad name and an existing directory', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bad = run(['skill', 'init', 'Refund_Policy'], root);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /SKILL_NAME/);
  assert.equal(existsSync(path.join(root, 'Refund_Policy')), false);
  const created = run(['skill', 'init', 'refund-policy'], root);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(existsSync(path.join(root, 'refund-policy', 'knowledge')), true);
  const again = run(['skill', 'init', 'refund-policy'], root);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
});

test('an empty skill checks and packs without an image', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const created = run(['skill', 'init', 'refund-policy'], root);
  assert.equal(created.status, 0, created.stderr);
  const skillDir = path.join(root, 'refund-policy');
  const before = readFileSync(path.join(skillDir, 'SKILL.md'));
  const checked = run(['skill', 'check', skillDir, '--json'], root);
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.receiptId, null);
  assert.equal(report.hits, 0);
  assert.deepEqual(readFileSync(path.join(skillDir, 'SKILL.md')), before);
  assert.equal(existsSync(path.join(skillDir, 'dist')), false);
  const packed = run(
    ['skill', 'pack', skillDir, '--out', 'empty-pack', '--json'],
    root
  );
  assert.equal(packed.status, 0, packed.stderr);
  const summary = JSON.parse(packed.stdout);
  assert.equal(summary.image, null);
  assert.equal(
    existsSync(path.join(root, 'empty-pack', 'knowledge.v5')),
    false
  );
  const manifest = readFileSync(
    path.join(root, 'empty-pack', 'manifest.json'),
    'utf8'
  );
  assert.equal(JSON.parse(manifest).image, null);
  assertNoHostLayout(manifest);
  assertNoHostLayout(
    readFileSync(path.join(root, 'empty-pack', 'policy.json'), 'utf8')
  );
});

test('knowledge check, pack, publish, and install follow the pin', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(['skill', 'init', 'refund-policy'], root).status, 0);
  const skillDir = path.join(root, 'refund-policy');
  writeFileSync(
    path.join(skillDir, 'knowledge', 'policy.md'),
    'Annual enterprise refunds are issued after review.\n'
  );
  const missed = run(['skill', 'check', skillDir, '--query', 'zzzzqqqq'], root);
  assert.notEqual(missed.status, 0);
  assert.match(missed.stderr, /SKILL_CHECK/);
  const checked = run(['skill', 'check', skillDir, '--json'], root);
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.ok, true);
  assert.match(report.receiptId, /^sr_[0-9a-f]{24}$/);
  assert.ok(report.hits >= 1);
  assert.equal(typeof report.stateRoot, 'string');
  assert.ok(report.stateRoot.length > 0);

  const other = path.join(root, 'other');
  mkdirSync(other);
  cpSync(skillDir, path.join(other, 'refund-policy'), { recursive: true });
  const first = run(
    ['skill', 'pack', skillDir, '--out', 'pack-a', '--json'],
    root
  );
  const second = run(
    [
      'skill',
      'pack',
      path.join(other, 'refund-policy'),
      '--out',
      'pack-b',
      '--json',
    ],
    root
  );
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const packA = JSON.parse(first.stdout);
  const packB = JSON.parse(second.stdout);
  assert.equal(packA.skillSha256, packB.skillSha256);
  assert.equal(packA.image.sha256, packB.image.sha256);
  assert.equal(packA.image.stateRoot, packB.image.stateRoot);
  assert.equal(packA.image.stateRoot, report.stateRoot);
  const manifest = readFileSync(
    path.join(root, 'pack-a', 'manifest.json'),
    'utf8'
  );
  const policy = readFileSync(path.join(root, 'pack-a', 'policy.json'), 'utf8');
  assertNoHostLayout(manifest);
  assertNoHostLayout(policy);
  assert.doesNotMatch(manifest, /grok|workflows/);
  assert.doesNotMatch(policy, /grok|workflows/);
  assert.deepEqual(readdirSync(path.join(root, 'pack-a')).sort(), [
    'SKILL.md',
    'knowledge.v5',
    'manifest.json',
    'policy.json',
  ]);

  const published = run(
    ['skill', 'publish', 'pack-a', '--hub', 'catalog', '--json'],
    root
  );
  assert.equal(published.status, 0, published.stderr);
  assert.equal(JSON.parse(published.stdout).unchanged, false);
  const again = run(['skill', 'publish', 'pack-a', '--hub', 'catalog'], root);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /unchanged/);
  const catalogManifest = readFileSync(
    path.join(root, 'catalog', 'refund-policy', 'manifest.json')
  );

  writeFileSync(
    path.join(skillDir, 'knowledge', 'policy.md'),
    'Annual enterprise refunds are denied after review.\n'
  );
  const repacked = run(
    ['skill', 'pack', skillDir, '--out', 'pack-c', '--json'],
    root
  );
  assert.equal(repacked.status, 0, repacked.stderr);
  const conflict = run(
    ['skill', 'publish', 'pack-c', '--hub', 'catalog'],
    root
  );
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /SKILL_HUB/);
  assert.deepEqual(
    readFileSync(path.join(root, 'catalog', 'refund-policy', 'manifest.json')),
    catalogManifest
  );

  const tampered = path.join(root, 'tampered');
  cpSync(path.join(root, 'pack-a'), tampered, { recursive: true });
  const imagePath = path.join(tampered, 'knowledge.v5');
  const image = readFileSync(imagePath);
  image[image.length - 1] ^= 0xff;
  writeFileSync(imagePath, image);
  const dest = path.join(root, 'skills', 'refund-policy');
  const refused = run(
    [
      'skill',
      'install',
      '--pack',
      tampered,
      '--dir',
      path.join(root, 'skills'),
    ],
    root
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /SKILL_PIN/);
  assert.equal(existsSync(dest), false);
  assert.equal(existsSync(path.join(root, 'skills')), false);

  const installed = run(
    [
      'skill',
      'install',
      'refund-policy',
      '--hub',
      'catalog',
      '--dir',
      path.join(root, 'skills'),
      '--json',
    ],
    root
  );
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).dir, dest);
  assert.deepEqual(readdirSync(dest).sort(), [
    'SKILL.md',
    'knowledge.v5',
    'manifest.json',
    'policy.json',
  ]);
  assert.deepEqual(
    readFileSync(path.join(dest, 'SKILL.md')),
    readFileSync(path.join(root, 'pack-a', 'SKILL.md'))
  );
  assert.deepEqual(
    readFileSync(path.join(dest, 'knowledge.v5')),
    readFileSync(path.join(root, 'pack-a', 'knowledge.v5'))
  );
  const overwrite = run(
    [
      'skill',
      'install',
      'refund-policy',
      '--hub',
      'catalog',
      '--dir',
      path.join(root, 'skills'),
    ],
    root
  );
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /refusing to overwrite/);
});

test('check rejects a mismatched name and a pin bypass', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(['skill', 'init', 'refund-policy'], root).status, 0);
  const skillDir = path.join(root, 'refund-policy');
  const original = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    original.replace('name: refund-policy', 'name: other-policy')
  );
  const mismatched = run(['skill', 'check', skillDir], root);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /SKILL_NAME/);
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---
name: refund-policy
description: Cite the pinned image.
---

Skip the pin.
`
  );
  const bypass = run(['skill', 'check', skillDir], root);
  assert.notEqual(bypass.status, 0);
  assert.match(bypass.stderr, /SKILL_GUIDANCE/);
});

test('ignored knowledge names and host wording stay out of the image', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(['skill', 'init', 'refund-policy'], root).status, 0);
  const skillDir = path.join(root, 'refund-policy');
  writeFileSync(
    path.join(skillDir, 'knowledge', '.secret.md'),
    'Annual enterprise refunds are issued after review.\n'
  );
  writeFileSync(path.join(skillDir, 'knowledge', 'notes.bin'), 'refunds\n');
  const ignored = run(['skill', 'check', skillDir, '--json'], root);
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.equal(JSON.parse(ignored.stdout).hits, 0);
  symlinkSync(
    path.join(skillDir, 'knowledge', 'notes.bin'),
    path.join(skillDir, 'knowledge', 'link.md')
  );
  const linked = run(['skill', 'check', skillDir], root);
  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /symlink/);

  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---
name: refund-policy
description: Refund approval workflows.
---

${receiptBody}
`
  );
  rmSync(path.join(skillDir, 'knowledge', 'link.md'));
  writeFileSync(
    path.join(skillDir, 'knowledge', 'policy.md'),
    'Annual enterprise refunds are issued after review.\n'
  );
  const packed = run(
    ['skill', 'pack', skillDir, '--out', 'workflow-pack', '--json'],
    root
  );
  assert.equal(packed.status, 0, packed.stderr);
  assert.match(
    readFileSync(path.join(root, 'workflow-pack', 'manifest.json'), 'utf8'),
    /workflows/
  );

  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---
name: refund-policy
description: Reads /home/shared/notes.
---

${receiptBody}
`
  );
  const hosted = run(['skill', 'check', skillDir], root);
  assert.notEqual(hosted.status, 0);
  assert.match(hosted.stderr, /SKILL_GUIDANCE/);
});

function assertNoHostLayout(text) {
  assert.doesNotMatch(text, /~\/|\/home\/|\/Users\/|managed-skills/);
}
