import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../../core/dist/index.js';
import {
  MAX_FLIGHT_EVENT_BYTES,
  MAX_FLIGHT_EVENTS,
  parseFlightEvents,
  renderEventText,
} from '../bin/flight.mjs';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/knolo.mjs');
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/flight-ops');

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function event(partial) {
  const row = {
    id: 'arming',
    kind: 'arming',
    timestampUs: 1,
    byteStart: 0,
    byteEnd: 0,
    fields: { state: 'armed' },
    text: '',
    ...partial,
  };
  row.text = partial.text ?? renderEventText(row);
  return row;
}

function document(events, byteLength = 4) {
  return {
    format: 'flight-events-1',
    parser: { id: 'knolo-flight-fixture', version: '1' },
    log: { sha256: `sha256-${'ab'.repeat(32)}`, byteLength, format: 'ulog' },
    events,
  };
}

test('flight help states the evidence limit', () => {
  const root = run(['help'], process.cwd());
  assert.equal(root.status, 0);
  assert.match(root.stdout, /flight/);
  const help = run(['flight', '--help'], process.cwd());
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /verify-log/);
  assert.match(help.stdout, /does not mean a flight was safe/);
  assert.doesNotMatch(help.stdout, /Claim proven/);
});

test('parser rejects unsorted events, foreign formats, and over-cap lists', () => {
  const later = event({ id: 'later', timestampUs: 2 });
  const earlier = event({ id: 'earlier', timestampUs: 1 });
  const unsorted = parseFlightEvents(document([later, earlier]));
  assert.equal(unsorted.ok, false);
  assert.equal(unsorted.code, 'FLIGHT_EVENTS_INVALID');
  const foreign = document([event({})]);
  foreign.log.format = 'dji';
  const rejected = parseFlightEvents(foreign);
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /ulog, dataflash, or rosbag2/);
  for (const format of ['dataflash', 'rosbag2']) {
    const accepted = document([event({})]);
    accepted.log.format = format;
    assert.equal(parseFlightEvents(accepted).ok, true, format);
  }
  const many = [];
  for (let index = 0; index < MAX_FLIGHT_EVENTS + 1; index += 1) {
    many.push(event({ id: `e${index}`, timestampUs: index, fields: { state: 'armed' } }));
  }
  const capped = parseFlightEvents(document(many));
  assert.equal(capped.ok, false);
  assert.equal(capped.code, 'FLIGHT_TOO_MANY_EVENTS');
});

test('ingest is byte-identical and refuses a mismatched log', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-flight-cli-'));
  try {
    writeFileSync(path.join(dir, 'events.json'), readFileSync(path.join(fixture, 'events.json')));
    writeFileSync(path.join(dir, 'sample.log'), readFileSync(path.join(fixture, 'sample.log')));
    const first = run(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'a.knolo', '--json'], dir);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const second = run(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'b.knolo'], dir);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const left = readFileSync(path.join(dir, 'a.knolo'));
    const right = readFileSync(path.join(dir, 'b.knolo'));
    assert.equal(Buffer.compare(left, right), 0);
    const printed = JSON.parse(first.stdout);
    assert.match(printed.stateRoot, /^sha256-[0-9a-f]{64}$/);
    const again = run(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'a.knolo'], dir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /Refusing to overwrite/);
    const bad = Buffer.from(readFileSync(path.join(dir, 'sample.log')));
    bad[0] ^= 1;
    writeFileSync(path.join(dir, 'bad.log'), bad);
    const refused = run(['flight', 'ingest', '--events', 'events.json', '--log', 'bad.log', '--out', 'c.knolo'], dir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /FLIGHT_LOG_MISMATCH/);
    assert.equal(existsSync(path.join(dir, 'c.knolo')), false);
    const hash = createHash('sha256').update(bad).digest('hex');
    assert.notEqual(`sha256-${hash}`, JSON.parse(readFileSync(path.join(dir, 'events.json'), 'utf8')).log.sha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dataflash and rosbag2 documents ingest and refuse a flipped log', () => {
  for (const format of ['dataflash', 'rosbag2']) {
    const dir = mkdtempSync(path.join(tmpdir(), `knolo-flight-${format}-`));
    try {
      const log = Buffer.from(`knolo ${format} fixture\n`);
      const digest = `sha256-${createHash('sha256').update(log).digest('hex')}`;
      const body = document([event({ id: format, timestampUs: 1 })], log.length);
      body.log.format = format;
      body.log.sha256 = digest;
      writeFileSync(path.join(dir, 'events.json'), JSON.stringify(body));
      writeFileSync(path.join(dir, 'sample.log'), log);
      const first = run(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'a.knolo', '--json'], dir);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const second = run(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'b.knolo'], dir);
      assert.equal(second.status, 0, second.stderr || second.stdout);
      assert.equal(Buffer.compare(readFileSync(path.join(dir, 'a.knolo')), readFileSync(path.join(dir, 'b.knolo'))), 0);
      const flipped = Buffer.from(log);
      flipped[0] ^= 1;
      writeFileSync(path.join(dir, 'bad.log'), flipped);
      const refused = run(['flight', 'ingest', '--events', 'events.json', '--log', 'bad.log', '--out', 'c.knolo'], dir);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /FLIGHT_LOG_MISMATCH/);
      assert.equal(existsSync(path.join(dir, 'c.knolo')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('flight event schema uses the ingest token and per-kind fields', () => {
  const schemaPath = path.resolve(fixture, '../../schemas/experimental/flight/flight-events-v1.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const token = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';
  const phrase = '^[a-z0-9][a-z0-9 -]{0,160}$';
  assert.equal(schema.$defs.token.pattern, token);
  assert.equal(schema.$defs.phrase.pattern, phrase);
  assert.equal(schema.properties.parser.properties.id.$ref, '#/$defs/token');
  assert.equal(schema.properties.parser.properties.version.$ref, '#/$defs/token');
  assert.equal(schema.$defs.event.properties.id.$ref, '#/$defs/token');
  assert.deepEqual(schema.properties.log.properties.format.enum, ['ulog', 'dataflash', 'rosbag2']);
  assert.equal(new RegExp(token).test('my parser'), false);
  assert.equal(new RegExp(token).test('knolo-flight-fixture'), true);
  const expected = {
    arming: ['state'],
    'nav-mode': ['mode'],
    'failsafe-assert': ['name'],
    'failsafe-clear': ['name'],
    'geofence-breach': ['name'],
    'geofence-clear': [],
    'battery-threshold': ['level'],
    'link-loss': [],
    'link-restored': [],
    'scan-summary': ['phrase'],
  };
  const branches = schema.$defs.event.oneOf;
  assert.equal(branches.length, Object.keys(expected).length);
  const fixtureDoc = JSON.parse(readFileSync(path.join(fixture, 'events.json'), 'utf8'));
  for (const row of fixtureDoc.events) {
    const branch = branches.find((item) => item.properties.kind.const === row.kind);
    assert.ok(branch, row.kind);
    assert.match(row.text, new RegExp(branch.properties.text.pattern));
    assert.deepEqual(Object.keys(row.fields), branch.properties.fields.required ?? []);
  }
  for (const branch of branches) {
    const kind = branch.properties.kind.const;
    assert.deepEqual(branch.properties.fields.required ?? [], expected[kind]);
    assert.equal(branch.properties.fields.additionalProperties, false);
    const sample = event({
      id: 'sample',
      kind,
      timestampUs: 0,
      fields: Object.fromEntries((expected[kind] ?? []).map((name) => [name, name === 'phrase' ? 'scan phrase' : 'token'])),
    });
    assert.match(sample.text, new RegExp(branch.properties.text.pattern));
  }
});

test('synthetic format fixtures lock their image roots', () => {
  for (const spec of [
    { dir: 'dataflash', log: 'sample.bin' },
    { dir: 'rosbag2', log: 'sample.mcap' },
  ]) {
    const source = path.join(fixture, spec.dir);
    const expected = JSON.parse(readFileSync(path.join(source, 'expected.json'), 'utf8'));
    const logBytes = readFileSync(path.join(source, spec.log));
    assert.ok(logBytes.length > 0 && logBytes.length < 100 * 1024, spec.dir);
    const dir = mkdtempSync(path.join(tmpdir(), `knolo-flight-${spec.dir}-`));
    try {
      writeFileSync(path.join(dir, 'events.json'), readFileSync(path.join(source, 'events.json')));
      writeFileSync(path.join(dir, spec.log), logBytes);
      const first = run(['flight', 'ingest', '--events', 'events.json', '--log', spec.log, '--out', 'a.knolo', '--json'], dir);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      assert.equal(JSON.parse(first.stdout).stateRoot, expected.flightStateRoot);
      const second = run(['flight', 'ingest', '--events', 'events.json', '--log', spec.log, '--out', 'b.knolo'], dir);
      assert.equal(second.status, 0, second.stderr || second.stdout);
      assert.equal(Buffer.compare(readFileSync(path.join(dir, 'a.knolo')), readFileSync(path.join(dir, 'b.knolo'))), 0);
      const flipped = Buffer.from(logBytes);
      flipped[0] ^= 1;
      writeFileSync(path.join(dir, 'bad.log'), flipped);
      const refused = run(['flight', 'ingest', '--events', 'events.json', '--log', 'bad.log', '--out', 'c.knolo'], dir);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /FLIGHT_LOG_MISMATCH/);
      assert.equal(existsSync(path.join(dir, 'c.knolo')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('verify-log matches the sample and refuses a flipped log or a non-flight image', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-flight-verify-'));
  try {
    writeFileSync(path.join(dir, 'events.json'), readFileSync(path.join(fixture, 'events.json')));
    writeFileSync(path.join(dir, 'sample.log'), readFileSync(path.join(fixture, 'sample.log')));
    const ingested = run(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'a.knolo', '--json'], dir);
    assert.equal(ingested.status, 0, ingested.stderr || ingested.stdout);
    const before = readFileSync(path.join(dir, 'a.knolo'));
    const verified = run(['flight', 'verify-log', '--image', 'a.knolo', '--log', 'sample.log'], dir);
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    assert.match(verified.stdout, /FLIGHT LOG VERIFIED/);
    assert.match(verified.stdout, /not a safety or compliance determination/);
    const json = run(['flight', 'verify-log', '--image', 'a.knolo', '--log', 'sample.log', '--json'], dir);
    assert.equal(json.status, 0, json.stderr || json.stdout);
    const printed = JSON.parse(json.stdout);
    assert.equal(printed.ok, true);
    assert.equal(printed.stateRoot, JSON.parse(ingested.stdout).stateRoot);
    assert.equal(printed.logSha256, JSON.parse(readFileSync(path.join(dir, 'events.json'), 'utf8')).log.sha256);
    const bad = Buffer.from(readFileSync(path.join(dir, 'sample.log')));
    bad[0] ^= 1;
    writeFileSync(path.join(dir, 'bad.log'), bad);
    const refused = run(['flight', 'verify-log', '--image', 'a.knolo', '--log', 'bad.log'], dir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /FLIGHT_LOG_MISMATCH/);
    assert.equal(Buffer.compare(before, readFileSync(path.join(dir, 'a.knolo'))), 0);
    const plain = await createKnowledgeImageV5({
      actor: 'knolo-flight',
      sequence: 1,
      objects: [{ kind: 'chunk', bytes: Buffer.from('note'), meta: { source: 'note.txt' } }],
    });
    writeFileSync(path.join(dir, 'plain.knolo'), plain.bytes);
    const missing = run(['flight', 'verify-log', '--image', 'plain.knolo', '--log', 'sample.log'], dir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FLIGHT_EVENTS_INVALID/);
    assert.match(missing.stderr, /one flight-log object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an oversized event file is refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-flight-size-'));
  try {
    writeFileSync(path.join(dir, 'events.json'), Buffer.alloc(MAX_FLIGHT_EVENT_BYTES + 1, 0x61));
    writeFileSync(path.join(dir, 'sample.log'), Buffer.from('x'));
    const refused = run(['flight', 'ingest', '--events', 'events.json', '--log', 'sample.log', '--out', 'out.knolo'], dir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /FLIGHT_EVENTS_TOO_LARGE/);
    assert.equal(existsSync(path.join(dir, 'out.knolo')), false);
    assert.equal(statSync(path.join(dir, 'events.json')).size > MAX_FLIGHT_EVENT_BYTES, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
