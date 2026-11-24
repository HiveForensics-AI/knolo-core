import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { answerPersona, buildPersonaPack } from '../bin/persona.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(root, 'packages/cli/bin/knolo.mjs');
const examplePath = path.join(root, 'examples/persona-chat/chat.mjs');

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
  return mkdtempSync(path.join(tmpdir(), 'knolo-persona-'));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function prepare(parent) {
  const created = run(['persona', 'init', 'ada-voice'], parent);
  assert.equal(created.status, 0, created.stderr);
  const dir = path.join(parent, 'ada-voice');
  const built = run(
    ['persona', 'build', dir, '--out', path.join(dir, 'dist', 'one.knolo'), '--json'],
    parent
  );
  assert.equal(built.status, 0, built.stderr);
  return { dir, built: JSON.parse(built.stdout) };
}

test('persona help states the receipt limit', () => {
  const rootHelp = run(['help'], process.cwd());
  assert.equal(rootHelp.status, 0, rootHelp.stderr);
  assert.match(rootHelp.stdout, /\n {2}persona {2,}/);
  const help = run(['persona', '--help'], process.cwd());
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not mean a claim is proven/);
  assert.match(help.stdout, /The host owns the model/);
  assert.match(help.stdout, /does not mean the claim is true/);
  assert.doesNotMatch(help.stdout, /\/home\//);
});

test('init refuses a bad name and an existing directory', (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const bad = run(['persona', 'init', 'Ada_Voice'], parent);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /PERSONA_NAME/);
  assert.equal(existsSync(path.join(parent, 'Ada_Voice')), false);
  const created = run(['persona', 'init', 'ada-voice'], parent);
  assert.equal(created.status, 0, created.stderr);
  const pem = path.join(parent, 'ada-voice', 'creator-private.pem');
  assert.equal(existsSync(pem), true);
  assert.equal(statSync(pem).mode & 0o777, 0o600);
  const again = run(['persona', 'init', 'ada-voice'], parent);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
});

test('two builds of one directory share a state root', (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { dir } = prepare(parent);
  const consent = readFileSync(path.join(dir, 'consent.json'), 'utf8');
  assert.equal(consent.includes('signature'), false);
  const second = run(
    ['persona', 'build', dir, '--out', path.join(dir, 'dist', 'two.knolo'), '--json'],
    parent
  );
  assert.equal(second.status, 0, second.stderr);
  const parsed = JSON.parse(second.stdout);
  const first = readFileSync(path.join(dir, 'dist', 'one.knolo'));
  const other = readFileSync(path.join(dir, 'dist', 'two.knolo'));
  assert.deepEqual(first, other);
  assert.equal(parsed.stateRoot, JSON.parse(run(
    ['persona', 'verify', path.join(dir, 'dist', 'one.knolo'), '--json'],
    parent
  ).stdout).stateRoot);
  assert.match(run(['persona', 'verify', path.join(dir, 'dist', 'one.knolo')], parent).stdout, /integrity check/);
});

test('build refuses a missing or swapped creator signature', (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const created = run(['persona', 'init', 'ada-voice'], parent);
  assert.equal(created.status, 0, created.stderr);
  const dir = path.join(parent, 'ada-voice');
  const consentPath = path.join(dir, 'consent.json');
  const consent = readJson(consentPath);
  const { publicKey } = generateKeyPairSync('ed25519');
  consent.publicKey = publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(consentPath, JSON.stringify(consent, null, 2));
  const swapped = run(['persona', 'build', dir, '--out', path.join(dir, 'dist', 'bad.knolo')], parent);
  assert.notEqual(swapped.status, 0);
  assert.match(swapped.stderr, /invalid creator signature/);
  assert.equal(existsSync(path.join(dir, 'dist', 'bad.knolo')), false);
  rmSync(path.join(dir, 'creator-private.pem'));
  const missing = run(['persona', 'build', dir, '--out', path.join(dir, 'dist', 'bad.knolo')], parent);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing creator signature/);
});

test('build refuses third-party correspondence without a consent record', (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const created = run(['persona', 'init', 'ada-voice'], parent);
  assert.equal(created.status, 0, created.stderr);
  const dir = path.join(parent, 'ada-voice');
  mkdirSync(path.join(dir, 'fans'));
  writeFileSync(path.join(dir, 'fans', 'note.md'), 'hello from a fan\n');
  const consent = readJson(path.join(dir, 'consent.json'));
  consent.sources.push({
    id: 'fans/note.md',
    owner: 'third-party',
    role: 'correspondence',
    party: 'fan',
  });
  writeFileSync(path.join(dir, 'consent.json'), JSON.stringify(consent, null, 2));
  const built = run(['persona', 'build', dir, '--out', path.join(dir, 'dist', 'bad.knolo')], parent);
  assert.notEqual(built.status, 0);
  assert.match(built.stderr, /third-party correspondence without a consent record/);
});

test('verify fails while a withdrawn source is still in the image', (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { dir, built } = prepare(parent);
  const image = path.join(dir, 'dist', 'one.knolo');
  const ok = run(['persona', 'verify', image, '--json'], parent);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).stateRoot, built.stateRoot);
  const flagged = run(['persona', 'verify', image, '--withdrawn', 'exemplars/greeting.md'], parent);
  assert.notEqual(flagged.status, 0);
  assert.match(flagged.stderr, /withdrawn source is still present: exemplars\/greeting.md/);
  const consent = readJson(path.join(dir, 'consent.json'));
  consent.withdrawn = ['exemplars/greeting.md'];
  writeFileSync(path.join(dir, 'consent.json'), JSON.stringify(consent, null, 2));
  const stillThere = run(
    ['persona', 'build', dir, '--out', path.join(dir, 'dist', 'kept.knolo'), '--json'],
    parent
  );
  assert.equal(stillThere.status, 0, stillThere.stderr);
  const rejected = run(['persona', 'verify', path.join(dir, 'dist', 'kept.knolo')], parent);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /withdrawn source is still present/);
  rmSync(path.join(dir, 'exemplars', 'greeting.md'));
  consent.sources = consent.sources.filter((source) => source.id !== 'exemplars/greeting.md');
  writeFileSync(path.join(dir, 'consent.json'), JSON.stringify(consent, null, 2));
  const dropped = run(
    ['persona', 'build', dir, '--out', path.join(dir, 'dist', 'dropped.knolo'), '--json'],
    parent
  );
  assert.equal(dropped.status, 0, dropped.stderr);
  const droppedBody = JSON.parse(dropped.stdout);
  assert.notEqual(droppedBody.stateRoot, built.stateRoot);
  const checked = run(['persona', 'verify', path.join(dir, 'dist', 'dropped.knolo'), '--json'], parent);
  assert.equal(checked.status, 0, checked.stderr);
});

test('eval prints a score and a receipt without a model', (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { dir, built } = prepare(parent);
  const evaluated = run(
    [
      'persona',
      'eval',
      path.join(dir, 'dist', 'one.knolo'),
      '--fixtures',
      path.join(dir, 'fixtures.json'),
      '--json',
    ],
    parent
  );
  assert.equal(evaluated.status, 0, evaluated.stderr);
  const body = JSON.parse(evaluated.stdout);
  assert.equal(body.stateRoot, built.stateRoot);
  assert.ok(body.score > 0 && body.score <= 1);
  assert.match(body.receiptId, /^pr_[0-9a-f]{24}$/);
  assert.ok(body.excerpts.length >= 2);
  assert.match(body.note, /integrity check/);
});

test('the adapter blocks a banned topic and missing evidence without a model', async (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { dir } = prepare(parent);
  const image = path.join(dir, 'dist', 'one.knolo');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('model was called');
  };
  const banned = await answerPersona(
    [image, '--situation', 'greeting', '--prompt', 'What is the payroll number?'],
    { fetchImpl, print() {}, printError() {} }
  );
  assert.equal(banned.exitCode, 1);
  assert.equal(banned.modelCalled, false);
  assert.equal(calls, 0);
  const missing = await answerPersona(
    [image, '--situation', 'booking', '--prompt', 'Can we meet tomorrow?'],
    { fetchImpl, print() {}, printError() {} }
  );
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.modelCalled, false);
  assert.equal(calls, 0);
});

test('the adapter refuses a reply that omits the disclosure line', async (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { dir } = prepare(parent);
  const image = path.join(dir, 'dist', 'one.knolo');
  let calls = 0;
  const printed = [];
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Hello there' } }] }),
    };
  };
  const refused = await answerPersona(
    [image, '--situation', 'greeting', '--prompt', 'Hello', '--model', 'fixture'],
    {
      fetchImpl,
      print: (line) => printed.push(line),
      printError() {},
    }
  );
  assert.equal(calls, 1);
  assert.equal(refused.modelCalled, true);
  assert.equal(refused.exitCode, 1);
  assert.equal(printed.includes('Hello there'), false);
});

test('an unmet obligation does not call the model', async (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const created = run(['persona', 'init', 'ada-voice'], parent);
  assert.equal(created.status, 0, created.stderr);
  const dir = path.join(parent, 'ada-voice');
  writeFileSync(path.join(dir, 'disclosure.txt'), 'Hello only.\n');
  const blocked = run(['persona', 'build', dir, '--out', path.join(dir, 'dist', 'gap.knolo')], parent);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /unmet obligations: disclosure/);
  const built = await buildPersonaPack(dir, { checkObligations: false });
  const image = path.join(dir, 'dist', 'gap.knolo');
  mkdirSync(path.dirname(image), { recursive: true });
  writeFileSync(image, built.bytes);
  let calls = 0;
  const result = await answerPersona(
    [image, '--situation', 'greeting', '--prompt', 'Hello', '--model', 'fixture'],
    {
      fetchImpl: async () => {
        calls += 1;
        throw new Error('model was called');
      },
      print() {},
      printError() {},
    }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.modelCalled, false);
  assert.equal(calls, 0);
});

test('the example evidence path does not call a model', (t) => {
  const parent = tempDir();
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { dir } = prepare(parent);
  const image = path.join(dir, 'dist', 'one.knolo');
  const result = spawnSync(
    process.execPath,
    [examplePath, image, '--situation', 'greeting', '--prompt', 'Hello', '--evidence'],
    { cwd: parent, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /This chatbot is AI and is not the creator/);
  assert.match(result.stdout, /integrity check/);
  assert.match(result.stdout, /sha256-[0-9a-f]{64}/);
});
