/**
 * knolo flight ingest
 *
 * Packs a flight-events-1 document into a V5 Knowledge Image.
 * It does not decode the log. log.format is ulog, dataflash, or rosbag2.
 * SATISFIED is not a statement that a flight was safe or compliant.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBounded } from './kar-limits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FLIGHT_EVENTS_FORMAT = 'flight-events-1';
export const MAX_FLIGHT_EVENTS = 10_000;
export const MAX_FLIGHT_EVENT_BYTES = 2 * 1024 * 1024;
export const FLIGHT_ACTOR = 'knolo-flight';

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PHRASE = /^[a-z0-9][a-z0-9 -]{0,160}$/;
const DIGEST = /^sha256-[0-9a-f]{64}$/;
const TOP_KEYS = ['format', 'parser', 'log', 'events'];
const EVENT_KEYS = ['id', 'kind', 'timestampUs', 'byteStart', 'byteEnd', 'fields', 'text'];
const KIND_FIELDS = {
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

const USAGE = `Usage: knolo flight ingest --events <events.json> --log <file> --out <image.knolo> [--json]

Packs a flight-events-1 document into a V5 Knowledge Image.
The command hashes --log and refuses the image when the hash or byte length differs.
It does not decode a flight log. Parsing stays in an external producer.
A later KAR status of SATISFIED means evidence requirements were met.
It does not mean a flight was safe, legal, or compliant.`;

export async function runFlightCli(argv) {
  const { positionals, flags } = parseArgs(argv);
  const sub = positionals[0] ?? '';
  if (!sub || sub === 'help' || flags.help) {
    console.log(USAGE);
    return;
  }
  if (sub !== 'ingest') throw new Error(`Unknown flight command "${sub}".\n${USAGE}`);
  const eventsPath = required(flags, 'events');
  const logPath = required(flags, 'log');
  const outPath = required(flags, 'out');
  const resolvedOut = path.resolve(process.cwd(), outPath);
  if (existsSync(resolvedOut)) throw new Error(`Refusing to overwrite ${outPath}. Choose a new --out path.`);
  const document = readEvents(eventsPath);
  const log = await inspectLog(logPath);
  if (log.byteLength !== document.log.byteLength || log.sha256 !== document.log.sha256) {
    throw new Error('FLIGHT_LOG_MISMATCH: log bytes do not match events.log.sha256 or events.log.byteLength.');
  }
  const image = await flightImageFromDocument(document);
  writeFileSync(resolvedOut, image.bytes);
  if (flags.json) {
    console.log(JSON.stringify({
      ok: true,
      stateRoot: image.stateRoot,
      events: document.events.length,
      wrote: outPath,
    }, null, 2));
    return;
  }
  console.log(`FLIGHT IMAGE\nstate root       ${image.stateRoot}\nevents           ${document.events.length}\nwrote            ${outPath}\n\nEvidence requirements are not a safety or compliance determination.`);
}

export function readEvents(file) {
  const resolved = path.resolve(process.cwd(), file);
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error(`FLIGHT_EVENTS_INVALID: ${file} is not a file.`);
  if (stat.size > MAX_FLIGHT_EVENT_BYTES) {
    throw new Error(`FLIGHT_EVENTS_TOO_LARGE: ${file} is ${stat.size} bytes; limit is ${MAX_FLIGHT_EVENT_BYTES}.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readBounded(file, MAX_FLIGHT_EVENT_BYTES).toString('utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`FLIGHT_EVENTS_INVALID: ${message}`);
  }
  const document = parseFlightEvents(parsed);
  if (!document.ok) throw new Error(`${document.code}: ${document.message}`);
  return document.document;
}

export function parseFlightEvents(value) {
  if (!isPlain(value) || !sameKeys(value, TOP_KEYS)) {
    return fail('FLIGHT_EVENTS_INVALID', 'Document must be flight-events-1 with parser, log, and events.');
  }
  if (value.format !== FLIGHT_EVENTS_FORMAT) {
    return fail('FLIGHT_EVENTS_INVALID', 'format must be flight-events-1.');
  }
  const parser = parseParser(value.parser);
  if (!parser.ok) return parser;
  const log = parseLog(value.log);
  if (!log.ok) return log;
  if (!Array.isArray(value.events)) return fail('FLIGHT_EVENTS_INVALID', 'events must be an array.');
  if (value.events.length > MAX_FLIGHT_EVENTS) {
    return fail('FLIGHT_TOO_MANY_EVENTS', `event count ${value.events.length} exceeds ${MAX_FLIGHT_EVENTS}.`);
  }
  const events = [];
  const ids = new Set();
  for (const [index, raw] of value.events.entries()) {
    const parsed = parseEvent(raw, index, log.log.byteLength);
    if (!parsed.ok) return parsed;
    if (ids.has(parsed.event.id)) return fail('FLIGHT_EVENTS_INVALID', `Duplicate event id ${parsed.event.id}.`);
    ids.add(parsed.event.id);
    events.push(parsed.event);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (compareEvents(events[index - 1], events[index]) > 0) {
      return fail('FLIGHT_EVENTS_INVALID', 'events must be sorted by timestampUs, kind, byteStart, and id.');
    }
  }
  return { ok: true, document: { format: FLIGHT_EVENTS_FORMAT, parser: parser.parser, log: log.log, events } };
}

export function renderEventText(event) {
  const time = event.timestampUs;
  const fields = event.fields;
  switch (event.kind) {
    case 'arming':
      return `ARMING_STATE ${fields.state} at ${time} us.`;
    case 'nav-mode':
      return `NAV_STATE ${fields.mode} at ${time} us.`;
    case 'failsafe-assert':
      return `FAILSAFE ${fields.name} asserted at ${time} us.`;
    case 'failsafe-clear':
      return `FAILSAFE ${fields.name} cleared at ${time} us.`;
    case 'geofence-breach':
      return `GEOFENCE_BREACH ${fields.name} at ${time} us.`;
    case 'geofence-clear':
      return `GEOFENCE clear at ${time} us.`;
    case 'battery-threshold':
      return `battery threshold crossed at ${time} us. level ${fields.level}.`;
    case 'link-loss':
      return `link loss recorded at ${time} us.`;
    case 'link-restored':
      return `LINK_RESTORED at ${time} us.`;
    case 'scan-summary':
      return `${fields.phrase} at ${time} us.`;
    default:
      return '';
  }
}

export async function flightImageFromDocument(document) {
  const api = await loadImageApi();
  const encoder = new TextEncoder();
  const objects = [
    {
      kind: 'metadata',
      bytes: encoder.encode(metadataText(document)),
      meta: {
        source: 'flight-log.txt',
        role: 'flight-log',
        logSha256: document.log.sha256,
        byteLength: String(document.log.byteLength),
        parserId: document.parser.id,
        parserVersion: document.parser.version,
        eventCount: String(document.events.length),
        logFormat: document.log.format,
      },
    },
    ...document.events.map((event) => ({
      kind: 'chunk',
      bytes: encoder.encode(event.text),
      meta: {
        source: `${event.id}.txt`,
        eventKind: event.kind,
        timestampUs: String(event.timestampUs),
        byteStart: String(event.byteStart),
        byteEnd: String(event.byteEnd),
        logSha256: document.log.sha256,
      },
    })),
  ];
  return api.createKnowledgeImageV5({ actor: FLIGHT_ACTOR, sequence: 1, objects });
}

export function hashFile(file) {
  const resolved = path.resolve(process.cwd(), file);
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(resolved);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(`sha256-${hash.digest('hex')}`));
  });
}

function metadataText(document) {
  return [
    'format flight-events-1',
    `log ${document.log.sha256}`,
    `bytes ${document.log.byteLength}`,
    `parser ${document.parser.id} ${document.parser.version}`,
    `events ${document.events.length}`,
    '',
  ].join('\n');
}

function parseParser(value) {
  if (!isPlain(value) || !sameKeys(value, ['id', 'version'])) {
    return fail('FLIGHT_EVENTS_INVALID', 'parser must contain id and version.');
  }
  if (typeof value.id !== 'string' || !TOKEN.test(value.id)) {
    return fail('FLIGHT_EVENTS_INVALID', 'parser.id must be a short token.');
  }
  if (typeof value.version !== 'string' || !TOKEN.test(value.version)) {
    return fail('FLIGHT_EVENTS_INVALID', 'parser.version must be a short token.');
  }
  return { ok: true, parser: { id: value.id, version: value.version } };
}

function parseLog(value) {
  if (!isPlain(value) || !sameKeys(value, ['sha256', 'byteLength', 'format'])) {
    return fail('FLIGHT_EVENTS_INVALID', 'log must contain sha256, byteLength, and format.');
  }
  if (typeof value.sha256 !== 'string' || !DIGEST.test(value.sha256)) {
    return fail('FLIGHT_EVENTS_INVALID', 'log.sha256 must be sha256- and 64 lowercase hex digits.');
  }
  if (!nonNegativeInteger(value.byteLength)) {
    return fail('FLIGHT_EVENTS_INVALID', 'log.byteLength must be a non-negative integer.');
  }
  if (value.format !== 'ulog' && value.format !== 'dataflash' && value.format !== 'rosbag2') {
    return fail('FLIGHT_EVENTS_INVALID', 'log.format must be ulog, dataflash, or rosbag2.');
  }
  return { ok: true, log: { sha256: value.sha256, byteLength: value.byteLength, format: value.format } };
}

function parseEvent(value, index, byteLength) {
  const pathName = `events[${index}]`;
  if (!isPlain(value) || !sameKeys(value, EVENT_KEYS)) {
    return fail('FLIGHT_EVENTS_INVALID', `${pathName} has missing or unknown fields.`);
  }
  if (typeof value.id !== 'string' || !TOKEN.test(value.id)) {
    return fail('FLIGHT_EVENTS_INVALID', `${pathName}.id must be a short token.`);
  }
  const fields = KIND_FIELDS[value.kind];
  if (!fields) return fail('FLIGHT_EVENTS_INVALID', `${pathName}.kind is not a phase 1 event kind.`);
  if (!nonNegativeInteger(value.timestampUs) || !nonNegativeInteger(value.byteStart) || !nonNegativeInteger(value.byteEnd)) {
    return fail('FLIGHT_EVENTS_INVALID', `${pathName} timestamps and byte offsets must be non-negative integers.`);
  }
  if (value.byteEnd < value.byteStart || value.byteEnd > byteLength) {
    return fail('FLIGHT_EVENTS_INVALID', `${pathName} byte range is outside the log.`);
  }
  const parsedFields = parseFields(value.fields, fields, pathName);
  if (!parsedFields.ok) return parsedFields;
  const event = {
    id: value.id,
    kind: value.kind,
    timestampUs: value.timestampUs,
    byteStart: value.byteStart,
    byteEnd: value.byteEnd,
    fields: parsedFields.fields,
    text: '',
  };
  event.text = renderEventText(event);
  if (value.text !== event.text) {
    return fail('FLIGHT_EVENTS_INVALID', `${pathName}.text must be the canonical sentence for its kind and fields.`);
  }
  return { ok: true, event };
}

function parseFields(value, names, pathName) {
  if (!isPlain(value) || !sameKeys(value, names)) {
    return fail('FLIGHT_EVENTS_INVALID', `${pathName}.fields must contain exactly ${names.join(', ') || 'no keys'}.`);
  }
  const fields = {};
  for (const name of names) {
    const text = value[name];
    const pattern = name === 'phrase' ? PHRASE : TOKEN;
    if (typeof text !== 'string' || !pattern.test(text)) {
      return fail('FLIGHT_EVENTS_INVALID', `${pathName}.fields.${name} is not a canonical token.`);
    }
    fields[name] = text;
  }
  return { ok: true, fields };
}

function compareEvents(left, right) {
  if (left.timestampUs !== right.timestampUs) return left.timestampUs - right.timestampUs;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  if (left.byteStart !== right.byteStart) return left.byteStart - right.byteStart;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

function fail(code, message) {
  return { ok: false, code, message };
}

function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPlain(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function sameKeys(value, keys) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) return false;
  const allowed = new Set(keys);
  return actual.every((key) => allowed.has(key));
}

async function inspectLog(file) {
  const resolved = path.resolve(process.cwd(), file);
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error(`FLIGHT_LOG_MISMATCH: ${file} is not a file.`);
  const sha256 = await hashFile(file);
  return { byteLength: stat.size, sha256 };
}

async function loadImageApi() {
  const candidates = [
    path.resolve(__dirname, '../../core/dist/index.js'),
    '@knolo/core',
  ];
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@') ? candidate : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (loaded.createKnowledgeImageV5) return loaded;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Could not load @knolo/core. Build packages/core first.');
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      flags[key] = value;
      index += 1;
    } else positionals.push(arg);
  }
  return { positionals, flags };
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`Missing --${name}`);
  return flags[name];
}
