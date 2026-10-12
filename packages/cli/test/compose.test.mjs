import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../../core/dist/index.js';

const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');
const encoder = new TextEncoder();

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('compose and attest help state the limits', () => {
  const root = run(['help'], process.cwd());
  assert.equal(root.status, 0);
  assert.match(root.stdout, /compose/);
  assert.match(root.stdout, /attest/);
  const help = run(['compose', '--help'], process.cwd());
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not mean SATISFIED/);
  assert.match(help.stdout, /Hub attested: true/);
  assert.doesNotMatch(help.stdout, /Claim proven/);
  assert.doesNotMatch(help.stdout, /Claim false/);
  const attest = run(['attest', '--help'], process.cwd());
  assert.match(attest.stdout, /does not mean the claim is true or false/);
  assert.doesNotMatch(attest.stdout, /Claim proven/);
});

test('compose create, verify, attest, and refuse overwrite', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-compose-'));
  try {
    const alpha = createKnowledgeImageV5({
      actor: 'cli-alpha',
      sequence: 1,
      objects: [{ kind: 'chunk', bytes: encoder.encode('Alpha demo sentence for composition.'), meta: { source: 'alpha.txt' } }],
    });
    const beta = createKnowledgeImageV5({
      actor: 'cli-beta',
      sequence: 1,
      objects: [{ kind: 'chunk', bytes: encoder.encode('Beta demo sentence for composition.'), meta: { source: 'beta.txt' } }],
    });
    writeFileSync(path.join(dir, 'alpha.knolo'), alpha.bytes);
    writeFileSync(path.join(dir, 'beta.knolo'), beta.bytes);
    writeFileSync(path.join(dir, 'members.json'), `${JSON.stringify({
      format: 'composition-members-1',
      version: 1,
      members: [
        { alias: 'beta', kind: 'v5-image', path: 'beta.knolo' },
      ],
    }, null, 2)}\n`);
    const created = run(['compose', 'create', '--members', 'members.json', '--out', 'composition', '--host', 'alpha.knolo'], dir);
    assert.equal(created.status, 0, created.stderr || created.stdout);
    assert.match(created.stdout, /sha256-/);
    const again = run(['compose', 'create', '--members', 'members.json', '--out', 'composition', '--host', 'alpha.knolo'], dir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /Refusing to overwrite/);
    const verified = run(['compose', 'verify', 'composition'], dir);
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    assert.equal(verified.stdout.trim(), 'VERIFIED');
    const record = JSON.parse(readFileSync(path.join(dir, 'composition/composition.json'), 'utf8'));
    assert.equal(record.format, 'composition-record-1');
    assert.equal(record.host.stateRoot, alpha.stateRoot);
    const query = run(['compose', 'query', '--composition', 'composition', '--eql', 'FROM chunk SEARCH "demo" LIMIT 5', '--json'], dir);
    assert.equal(query.status, 0, query.stderr || query.stdout);
    const queried = JSON.parse(query.stdout);
    assert.equal(queried.results.find((row) => row.alias === 'beta').status, 'queried');
    const attested = run(['attest', 'create', '--composition', 'composition', '--subject', 'composition', '--statement', 'cited', '--out', 'composition/attestation.json'], dir);
    assert.equal(attested.status, 0, attested.stderr || attested.stdout);
    const attestVerified = run(['attest', 'verify', 'composition/attestation.json', '--composition', 'composition'], dir);
    assert.equal(attestVerified.status, 0, attestVerified.stderr);
    assert.equal(attestVerified.stdout.trim(), 'VERIFIED');
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const privateKey = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
    writeFileSync(path.join(dir, 'key.json'), `${JSON.stringify({ principal: 'cli', keyId: 'key-1', publicKey, privateKey }, null, 2)}\n`);
    const signedOut = path.join(dir, 'signed.json');
    const signed = run(['attest', 'create', '--composition', 'composition', '--subject', 'composition', '--statement', 'mount', '--out', 'signed.json', '--sign-key', 'key.json', '--issued-at', '1700000000000', '--expires-at', '1800000000000'], dir);
    assert.equal(signed.status, 0, signed.stderr || signed.stdout);
    const good = run(['verify-attestation', 'signed.json', '--public-key', 'key.json', '--now', '1700000001000'], dir);
    assert.equal(good.status, 0, good.stderr || good.stdout);
    assert.equal(good.stdout.trim(), 'VERIFIED');
    const expired = run(['verify-attestation', 'signed.json', '--public-key', 'key.json', '--now', '1800000000000'], dir);
    assert.equal(expired.status, 1);
    assert.match(expired.stdout, /ATTESTATION_EXPIRED/);
    const tampered = JSON.parse(readFileSync(signedOut, 'utf8'));
    const raw = Buffer.from(tampered.signature.signature, 'base64');
    raw[0] ^= 1;
    tampered.signature.signature = raw.toString('base64');
    writeFileSync(signedOut, `${JSON.stringify(tampered, null, 2)}\n`);
    const bad = run(['verify-attestation', 'signed.json', '--public-key', 'key.json', '--now', '1700000001000'], dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /ATTESTATION_MISMATCH/);
    const content = run(['verify-attestation', 'signed.json', '--content-only'], dir);
    assert.equal(content.status, 0, content.stderr || content.stdout);
    assert.equal(content.stdout.trim(), 'VERIFIED content-only');
    const member = path.join(dir, 'composition/members/beta.knolo');
    const bytes = readFileSync(member);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(member, bytes);
    const mismatch = run(['compose', 'verify', 'composition'], dir);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stdout, /COMPOSITION_DIGEST_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
