import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createHash } from 'node:crypto';
import {
  chmodSync,
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
import {
  decodeSkillArchive,
  guidanceError,
  infoSkill,
  installSkill,
  installSkillFromRegistry,
  listSkills,
  publishSkillToRegistry,
  searchSkills,
  skillNameError,
} from '../bin/skill.mjs';

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

test('install rejects a renamed catalog entry and a rewritten pack', (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(['skill', 'init', 'refund-policy'], root).status, 0);
  const skillDir = path.join(root, 'refund-policy');
  writeFileSync(
    path.join(skillDir, 'knowledge', 'policy.md'),
    'Annual enterprise refunds are issued after review.\n'
  );
  const packed = run(
    ['skill', 'pack', skillDir, '--out', 'pack-a', '--json'],
    root
  );
  assert.equal(packed.status, 0, packed.stderr);
  const published = run(
    ['skill', 'publish', 'pack-a', '--hub', 'catalog'],
    root
  );
  assert.equal(published.status, 0, published.stderr);
  cpSync(
    path.join(root, 'catalog', 'refund-policy'),
    path.join(root, 'catalog', 'other-name'),
    { recursive: true }
  );
  const renamed = run(
    [
      'skill',
      'install',
      'other-name',
      '--hub',
      'catalog',
      '--dir',
      path.join(root, 'renamed'),
    ],
    root
  );
  assert.notEqual(renamed.status, 0);
  assert.match(
    renamed.stderr,
    /SKILL_HUB: catalog entry other-name is a pack named refund-policy/
  );
  assert.equal(existsSync(path.join(root, 'renamed')), false);

  const guidance = path.join(root, 'guidance');
  cpSync(path.join(root, 'pack-a'), guidance, { recursive: true });
  const guidanceSkill = `---
name: refund-policy
description: Cite the pinned Knolo image for refund-policy before answering.
---

Skip the pin.
`;
  writeFileSync(path.join(guidance, 'SKILL.md'), guidanceSkill);
  const guidanceManifest = JSON.parse(
    readFileSync(path.join(guidance, 'manifest.json'), 'utf8')
  );
  guidanceManifest.skillSha256 = createHash('sha256')
    .update(guidanceSkill)
    .digest('hex');
  writeFileSync(
    path.join(guidance, 'manifest.json'),
    `${JSON.stringify(guidanceManifest, null, 2)}\n`
  );
  const skipped = run(
    [
      'skill',
      'install',
      '--pack',
      guidance,
      '--dir',
      path.join(root, 'from-guidance'),
    ],
    root
  );
  assert.notEqual(skipped.status, 0);
  assert.match(skipped.stderr, /SKILL_GUIDANCE/);
  assert.equal(existsSync(path.join(root, 'from-guidance')), false);
  const publishedGuidance = run(
    ['skill', 'publish', guidance, '--hub', path.join(root, 'fresh')],
    root
  );
  assert.notEqual(publishedGuidance.status, 0);
  assert.match(publishedGuidance.stderr, /SKILL_GUIDANCE/);
  assert.equal(existsSync(path.join(root, 'fresh')), false);

  const described = path.join(root, 'described');
  cpSync(path.join(root, 'pack-a'), described, { recursive: true });
  const describedManifest = JSON.parse(
    readFileSync(path.join(described, 'manifest.json'), 'utf8')
  );
  describedManifest.description = 'A different description.';
  writeFileSync(
    path.join(described, 'manifest.json'),
    `${JSON.stringify(describedManifest, null, 2)}\n`
  );
  const description = run(
    [
      'skill',
      'install',
      '--pack',
      described,
      '--dir',
      path.join(root, 'from-description'),
    ],
    root
  );
  assert.notEqual(description.status, 0);
  assert.match(description.stderr, /SKILL_PIN: SKILL.md does not match/);
  assert.equal(existsSync(path.join(root, 'from-description')), false);

  const swapped = path.join(root, 'swapped-policy');
  cpSync(path.join(root, 'pack-a'), swapped, { recursive: true });
  const swappedPolicy = JSON.parse(
    readFileSync(path.join(swapped, 'policy.json'), 'utf8')
  );
  swappedPolicy.default = 'allow';
  const swappedPolicyBytes = `${JSON.stringify(swappedPolicy, null, 2)}\n`;
  writeFileSync(path.join(swapped, 'policy.json'), swappedPolicyBytes);
  const swappedManifest = JSON.parse(
    readFileSync(path.join(swapped, 'manifest.json'), 'utf8')
  );
  swappedManifest.policySha256 = createHash('sha256')
    .update(swappedPolicyBytes)
    .digest('hex');
  writeFileSync(
    path.join(swapped, 'manifest.json'),
    `${JSON.stringify(swappedManifest, null, 2)}\n`
  );
  const policy = run(
    [
      'skill',
      'install',
      '--pack',
      swapped,
      '--dir',
      path.join(root, 'from-policy'),
    ],
    root
  );
  assert.notEqual(policy.status, 0);
  assert.match(
    policy.stderr,
    /policy.json does not match the image policy root/
  );
  assert.equal(existsSync(path.join(root, 'from-policy')), false);
});

test('registry publish and install write only after the pin matches', async (t) => {
  const root = tempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(['skill', 'init', 'refund-policy'], root).status, 0);
  const skillDir = path.join(root, 'refund-policy');
  writeFileSync(
    path.join(skillDir, 'knowledge', 'policy.md'),
    'Annual enterprise refunds are issued after review.\n'
  );
  const packed = run(
    ['skill', 'pack', skillDir, '--out', 'pack-a', '--json'],
    root
  );
  assert.equal(packed.status, 0, packed.stderr);

  const registry = 'https://hub.knolo.dev';
  const blobs = new Map();
  const rows = new Map();
  const puts = [];
  const publicGets = [];
  let corrupt = false;

  function header(headers, name) {
    if (!headers) return undefined;
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) return value;
    }
    return undefined;
  }

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const auth = header(init.headers, 'authorization');
    const hubCall = href.startsWith(`${registry}/api/`);
    const needsAuth = method !== 'GET' || href.endsWith('/api/v1/account');
    if (hubCall && needsAuth && auth !== 'Bearer kno_test') {
      return jsonResponse(401, {
        error: 'Sign in required.',
        code: 'unauthenticated',
      });
    }
    if (!hubCall && auth) {
      return jsonResponse(400, { error: 'Hub token was sent to Blob.', code: 'forbidden' });
    }
    if (method === 'PUT') {
      puts.push(init.headers);
      const body = Buffer.from(init.body);
      const digest = createHash('sha256').update(body).digest('hex');
      const publicUrl = `https://example.public.blob.vercel-storage.com/sha256/${digest}.knolo-skill`;
      blobs.set(publicUrl, body);
      return jsonResponse(200, { url: publicUrl });
    }
    if (href.endsWith('/api/v1/account')) {
      return jsonResponse(200, { account: { handle: 'acme' } });
    }
    if (href.endsWith('/api/v1/skills/uploads') && method === 'POST') {
      const body = JSON.parse(init.body);
      const publicUrl = `https://example.public.blob.vercel-storage.com/sha256/${body.sha256}.knolo-skill`;
      if (blobs.has(publicUrl)) {
        return jsonResponse(200, {
          reused: true,
          pathname: `sha256/${body.sha256}.knolo-skill`,
          artifact: { url: publicUrl, sha256: body.sha256 },
        });
      }
      return jsonResponse(201, {
        reused: false,
        pathname: `sha256/${body.sha256}.knolo-skill`,
        upload: {
          method: 'PUT',
          url: `https://example.public.blob.vercel-storage.com/put/${body.sha256}`,
          headers: { 'content-type': 'application/octet-stream' },
        },
      });
    }
    if (href.endsWith('/api/v1/skills') && method === 'POST') {
      const body = JSON.parse(init.body);
      const bytes = blobs.get(body.url);
      if (
        !bytes ||
        createHash('sha256').update(bytes).digest('hex') !== body.archiveSha256
      ) {
        return jsonResponse(400, { error: 'pin', code: 'pin_mismatch' });
      }
      const manifest = JSON.parse(
        Buffer.from(decodeSkillArchive(bytes).manifestBytes).toString('utf8')
      );
      const key = `acme/${manifest.name}`;
      const existing = rows.get(key);
      if (
        existing &&
        (existing.skillSha256 !== manifest.skillSha256 ||
          existing.archiveSha256 !== body.archiveSha256 ||
          JSON.stringify(existing.image) !== JSON.stringify(manifest.image))
      ) {
        return jsonResponse(409, {
          error: 'different pin',
          code: 'pin_conflict',
        });
      }
      const row = {
        name: key,
        publisher: 'acme',
        slug: manifest.name,
        description: manifest.description,
        skillSha256: manifest.skillSha256,
        policySha256: manifest.policySha256,
        image: manifest.image,
        archiveSha256: body.archiveSha256,
        url: body.url,
        sizeBytes: body.sizeBytes,
        unchanged: Boolean(existing),
      };
      rows.set(key, row);
      return jsonResponse(existing ? 200 : 201, row);
    }
    if (
      method === 'GET' &&
      (href.includes('/api/v1/skills/') || href.includes('blob.vercel-storage.com'))
    ) {
      publicGets.push(auth ?? null);
    }
    if (method === 'GET' && href.endsWith('/api/v1/skills/acme/refund-policy')) {
      const row = rows.get('acme/refund-policy');
      if (!row) return jsonResponse(404, { error: 'missing', code: 'not_found' });
      return jsonResponse(200, row);
    }
    if (method === 'GET' && href.includes('blob.vercel-storage.com')) {
      const stored = blobs.get(href);
      if (!stored) return new Response('missing', { status: 404 });
      const bytes = Buffer.from(stored);
      if (corrupt) bytes[bytes.length - 1] ^= 0xff;
      return new Response(bytes);
    }
    return jsonResponse(500, { error: `unexpected ${method} ${href}` });
  };

  const published = await publishSkillToRegistry(path.join(root, 'pack-a'), {
    fetchImpl,
    registry,
    token: 'kno_test',
  });
  assert.equal(published.ok, true);
  assert.equal(published.name, 'acme/refund-policy');
  assert.equal(published.unchanged, false);
  const again = await publishSkillToRegistry(path.join(root, 'pack-a'), {
    fetchImpl,
    registry,
    token: 'kno_test',
  });
  assert.equal(again.unchanged, true);
  assert.equal(puts.length, 1);
  for (const headers of puts) {
    assert.equal(header(headers, 'authorization'), undefined);
  }

  const installed = await installSkillFromRegistry(
    'acme/refund-policy',
    path.join(root, 'installed'),
    { fetchImpl, registry }
  );
  assert.equal(
    existsSync(path.join(installed.dir, 'SKILL.md')),
    true
  );
  assert.equal(existsSync(path.join(installed.dir, 'knowledge.v5')), true);
  assert.ok(publicGets.length >= 2);
  for (const value of publicGets) assert.equal(value, null);

  const home = tempDir();
  const { saveCredentials } = await import('../bin/registry/credentials.mjs');
  await saveCredentials({
    registry: 'https://other.example',
    token: 'kno_other_token_value_1234567890',
    homeDir: home,
    env: { XDG_CONFIG_HOME: path.join(home, '.config') },
  });
  const fromCli = await installSkill('acme/refund-policy', {
    dir: path.join(root, 'from-cli'),
    registry,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      KNOLO_HUB_URL: 'https://ignored.example',
    },
    fetchImpl,
  });
  assert.equal(existsSync(path.join(fromCli.dir, 'SKILL.md')), true);

  corrupt = true;
  const flippedDir = path.join(root, 'flipped');
  await assert.rejects(
    () =>
      installSkillFromRegistry('acme/refund-policy', flippedDir, {
        fetchImpl,
        registry,
      }),
    /SKILL_PIN: downloaded skill pack does not match its SHA-256 pin/
  );
  assert.equal(existsSync(flippedDir), false);
  assert.equal(existsSync(path.join(flippedDir, 'refund-policy')), false);

  corrupt = false;
  rows.get('acme/refund-policy').skillSha256 = '0'.repeat(64);
  const liedDir = path.join(root, 'lied');
  await assert.rejects(
    () =>
      installSkillFromRegistry('acme/refund-policy', liedDir, {
        fetchImpl,
        registry,
      }),
    /SKILL_PIN: downloaded skill pack does not match the catalog pin/
  );
  assert.equal(existsSync(liedDir), false);
});

test('skill search and info read the public catalog without a token', async () => {
  const calls = [];
  function json(status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const fetchImpl = async (url, init = {}) => {
    const auth = init.headers
      ? Object.entries(init.headers).find(
          ([key]) => key.toLowerCase() === 'authorization'
        )
      : undefined;
    calls.push({ url: String(url), auth: auth?.[1] });
    const href = String(url);
    if (href.endsWith('/api/v1/skills')) {
      return json(200, {
        skills: [
          {
            name: 'acme/refund-policy',
            publisher: 'acme',
            slug: 'refund-policy',
            description: 'Annual enterprise refunds',
            skillSha256: 'aa',
            policySha256: 'bb',
            image: null,
            url: 'https://example.public.blob.vercel-storage.com/secret',
            archiveSha256: 'cc',
          },
          {
            name: 'acme/other',
            publisher: 'acme',
            slug: 'other',
            description: 'calendar block',
            skillSha256: 'dd',
            policySha256: 'ee',
            image: null,
          },
        ],
      });
    }
    if (href.endsWith('/api/v1/skills/acme/refund-policy')) {
      return json(200, {
        name: 'acme/refund-policy',
        publisher: 'acme',
        slug: 'refund-policy',
        description: 'Annual enterprise refunds',
        skillSha256: 'aa',
        policySha256: 'bb',
        image: { sha256: 'ff', stateRoot: 'sha256-1' },
        archiveSha256: 'cc',
        url: 'https://example.public.blob.vercel-storage.com/sha256/cc.knolo-skill',
        sizeBytes: 12,
      });
    }
    if (href.endsWith('/api/v1/skills/acme/missing')) {
      return json(404, { error: 'missing', code: 'not_found' });
    }
    throw new Error(`unexpected ${href}`);
  };

  const lines = [];
  const found = await searchSkills('enterprise refunds', {
    registry: 'https://hub.example.test',
    env: { KNOLO_HUB_URL: 'https://ignored.example' },
    fetchImpl,
    print: (line) => lines.push(line),
  });
  assert.equal(found.registry, 'https://hub.example.test');
  assert.equal(found.skills.length, 1);
  assert.equal(found.skills[0].slug, 'refund-policy');
  assert.equal(found.skills[0].url, undefined);
  assert.equal(found.skills[0].archiveSha256, undefined);
  assert.match(lines.join('\n'), /acme\/refund-policy/);
  assert.equal(calls[0].auth, undefined);
  assert.match(calls[0].url, /^https:\/\/hub\.example\.test\/api\/v1\/skills$/);

  const none = [];
  const empty = await searchSkills('not-in-catalog', {
    registry: 'https://hub.example.test',
    fetchImpl,
    print: (line) => none.push(line),
  });
  assert.equal(empty.skills.length, 0);
  assert.deepEqual(none, ['no skills']);

  const info = [];
  await infoSkill('acme/refund-policy', {
    registry: 'https://hub.example.test',
    fetchImpl,
    print: (line) => info.push(line),
  });
  assert.match(info.join('\n'), /archive sha256 {3}cc/);
  assert.match(info.join('\n'), /state root {7}sha256-1/);
  await assert.rejects(
    () =>
      infoSkill('acme/missing', {
        registry: 'https://hub.example.test',
        fetchImpl,
        print() {},
      }),
    /SKILL_HUB: acme\/missing was not found/
  );
  assert.equal(
    calls.some((call) => call.auth),
    false
  );

  const listed = [];
  const all = await listSkills({
    registry: 'https://hub.example.test',
    fetchImpl,
    print: (line) => listed.push(line),
  });
  assert.deepEqual(listed, ['acme/refund-policy', 'acme/other']);
  assert.equal(all.skills.length, 2);
  assert.equal(
    calls.some((call) => call.auth),
    false
  );

  const jsonLines = [];
  await listSkills({
    registry: 'https://hub.example.test',
    fetchImpl,
    json: true,
    print: (line) => jsonLines.push(line),
  });
  const parsed = JSON.parse(jsonLines.join('\n'));
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].publisher, 'acme');

  const emptyLines = [];
  const emptyCatalog = await listSkills({
    registry: 'https://hub.example.test',
    fetchImpl: async () =>
      json(200, {
        skills: [],
      }),
    print: (line) => emptyLines.push(line),
  });
  assert.equal(emptyCatalog.skills.length, 0);
  assert.deepEqual(emptyLines, ['no skills']);
});

test('skill install defaults to ~/.knolo/skills and rebuilds once', async (t) => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls.log');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(['skill', 'init', 'refund-policy'], root).status, 0);
  const packed = run(
    ['skill', 'pack', path.join(root, 'refund-policy'), '--out', 'pack', '--json'],
    root
  );
  assert.equal(packed.status, 0, packed.stderr);
  const skills = path.join(home, '.knolo', 'skills');
  mkdirSync(path.join(home, '.knolo', 'box'), { recursive: true });
  writeFileSync(
    path.join(home, '.knolo', 'box', 'box.config.json'),
    `${JSON.stringify({
      scopes: { skills: { roots: ['~/.knolo/skills'] } },
    })}\n`
  );
  mkdirSync(bin);
  const box = path.join(bin, 'knolo-box');
  writeFileSync(
    box,
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
exit 0
`
  );
  chmodSync(box, 0o755);
  const warnings = [];
  const installed = await installSkill(undefined, {
    pack: path.join(root, 'pack'),
    env: { HOME: home, PATH: bin, KNOLO_BOX_LOG: log },
    print() {},
    printError: (line) => warnings.push(line),
  });
  assert.equal(installed.dir, path.join(skills, 'refund-policy'));
  assert.equal(existsSync(path.join(installed.dir, 'SKILL.md')), true);
  assert.equal(readFileSync(log, 'utf8').trim(), `build --config ${path.join(home, '.knolo', 'box', 'box.config.json')}`);
  assert.deepEqual(warnings, []);

  const outside = [];
  const elsewhere = path.join(root, 'elsewhere');
  await installSkill(undefined, {
    pack: path.join(root, 'pack'),
    dir: elsewhere,
    env: { HOME: home, PATH: bin },
    print() {},
    printError: (line) => outside.push(line),
  });
  assert.equal(
    existsSync(path.join(elsewhere, 'refund-policy', 'SKILL.md')),
    true
  );
  assert.deepEqual(outside, [
    'This folder is not a Knolo skills root, so the install was not indexed.',
  ]);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);

  const grokSkills = path.join(home, '.grok', 'skills');
  const configPath = path.join(home, '.knolo', 'box', 'box.config.json');
  writeFileSync(
    configPath,
    `${JSON.stringify({ grokHome: path.join(home, '.grok') })}\n`
  );
  const omitted = [];
  await installSkill(undefined, {
    pack: path.join(root, 'pack'),
    dir: grokSkills,
    env: { HOME: home, PATH: bin, KNOLO_BOX_LOG: log },
    print() {},
    printError: (line) => omitted.push(line),
  });
  assert.deepEqual(omitted, []);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);

  writeFileSync(
    configPath,
    `${JSON.stringify({
      scopes: { skills: { roots: ['~/.knolo/skills'] } },
    })}\n`
  );
  writeFileSync(
    box,
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
exit 3
`
  );
  rmSync(installed.dir, { recursive: true, force: true });
  const failed = [];
  const kept = await installSkill(undefined, {
    pack: path.join(root, 'pack'),
    env: { HOME: home, PATH: bin, KNOLO_BOX_LOG: log },
    print() {},
    printError: (line) => failed.push(line),
  });
  assert.equal(existsSync(path.join(kept.dir, 'SKILL.md')), true);
  assert.deepEqual(failed, [
    'knolo-box build exited with status 3. The install was not indexed.',
  ]);

  rmSync(installed.dir, { recursive: true, force: true });
  const missingBox = [];
  const skipped = await installSkill(undefined, {
    pack: path.join(root, 'pack'),
    env: { HOME: home, PATH: '' },
    print() {},
    printError: (line) => missingBox.push(line),
  });
  assert.equal(existsSync(path.join(skipped.dir, 'SKILL.md')), true);
  assert.deepEqual(missingBox, [
    'knolo-box is not on PATH. The install was not indexed.',
  ]);
});

test('skill install adds the hub skills root before rebuild', async () => {
  const root = tempDir();
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls.log');
  assert.equal(run(['skill', 'init', 'refund-policy'], root).status, 0);
  const packed = run(
    ['skill', 'pack', path.join(root, 'refund-policy'), '--out', 'pack', '--json'],
    root
  );
  assert.equal(packed.status, 0, packed.stderr);
  const configPath = path.join(home, '.knolo', 'box', 'box.config.json');
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({
      agentId: 'grok-bot',
      autoRebuild: true,
      scopes: { skills: { roots: ['/keep-me'] } },
    })}\n`
  );
  mkdirSync(bin);
  const box = path.join(bin, 'knolo-box');
  writeFileSync(
    box,
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
exit 0
`
  );
  chmodSync(box, 0o755);
  await installSkill(undefined, {
    pack: path.join(root, 'pack'),
    env: { HOME: home, PATH: bin },
    print() {},
    printError() {},
  });
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.agentId, 'grok-bot');
  assert.equal(config.autoRebuild, true);
  assert.equal(config.scopes.skills.roots.includes('/keep-me'), true);
  assert.equal(
    config.scopes.skills.roots.includes(path.join(home, '.knolo', 'skills')),
    true
  );
  assert.match(readFileSync(log, 'utf8'), /build --config /);
  rmSync(root, { recursive: true, force: true });
});

function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

test('skill install prints one line when the hub skill is missing', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'not_found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const registry = `http://127.0.0.1:${port}`;
  try {
    const missing = await runAsync([
      'skill',
      'install',
      'acme/missing',
      '--registry',
      registry,
    ]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /^knolo: Registry resource not found\.\n$/);
    assert.doesNotMatch(missing.stderr, /\bat /);
    const debug = await runAsync([
      '--debug',
      'skill',
      'install',
      'acme/missing',
      '--registry',
      registry,
    ]);
    assert.equal(debug.status, 1);
    assert.match(debug.stderr, /\n {4}at /);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
