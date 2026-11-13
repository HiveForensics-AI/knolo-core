/**
 * knolo research package
 *
 * Packs local research files into one V5 Knowledge Image.
 * It does not call a model, open a network connection, or download an image.
 * A packed Cortex trace is an integrity check. It does not mean a claim is proven.
 */
import { createHash } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  KAR_CLI_MAX_IMAGE_BYTES,
  KAR_CLI_MAX_TEXT_BYTES,
  readBounded,
} from './kar-limits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTOR = 'knolo-research';
const AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const USAGE = `Usage: knolo research package --question <text> --agent <id> --out <image.knolo> --source <file> [--source <file>] [--cite <image.knolo> --trace <answer.cortex.json> [--graph <file>]] [--json]

Packs local files into one V5 Knowledge Image. --agent is the host-supplied caller.
--cite and --trace are both required or both omitted. --graph is required when the
trace contains KAR evaluations, and it is the same file knolo cortex verify would use.
A trace is verified against --cite before any write. A failed check writes nothing.
The command does not call a model and does not download an image.
A packed trace is an integrity check. It does not mean a claim is proven.
SATISFIED means the trace evidence requirements were met.`;

export async function runResearchCli(argv) {
  if (
    argv.length === 0 ||
    argv[0] === 'help' ||
    argv[0] === '--help' ||
    argv[0] === '-h'
  ) {
    console.log(USAGE);
    return;
  }
  if (argv[0] !== 'package') {
    throw new Error(`Unknown research command "${argv[0]}".\n${USAGE}`);
  }
  const flags = parseFlags(argv.slice(1));
  if (flags.help) {
    console.log(USAGE);
    return;
  }
  await packageResearch(flags);
}

async function packageResearch(flags) {
  const question = required(flags.question, '--question');
  const agent = required(flags.agent, '--agent');
  const outPath = required(flags.out, '--out');
  if (!AGENT.test(agent)) {
    throw new Error('RESEARCH_PACK_INVALID: --agent must be a short token.');
  }
  const questionBytes = Buffer.from(question, 'utf8');
  if (
    questionBytes.length === 0 ||
    questionBytes.length > KAR_CLI_MAX_TEXT_BYTES
  ) {
    throw new Error('RESEARCH_PACK_INVALID: --question is empty or too large.');
  }
  if (flags.sources.length === 0) {
    throw new Error('RESEARCH_PACK_INVALID: pass at least one --source.');
  }
  const cite = flags.cite ?? '';
  const tracePath = flags.trace ?? '';
  if (Boolean(cite) !== Boolean(tracePath)) {
    throw new Error('RESEARCH_PACK_INVALID: pass --cite and --trace together.');
  }
  if (flags.graph && !tracePath) {
    throw new Error(
      'RESEARCH_PACK_INVALID: --graph requires --cite and --trace.'
    );
  }
  const resolvedOut = path.resolve(process.cwd(), outPath);
  if (existsSync(resolvedOut))
    throw new Error(`Refusing to overwrite ${outPath}`);

  const names = new Set();
  const sources = [];
  for (const file of flags.sources) {
    const source = path.basename(file);
    if (!source || source === '.' || source === '..' || names.has(source)) {
      throw new Error(
        `RESEARCH_PACK_INVALID: --source basename "${source}" is missing or repeated.`
      );
    }
    names.add(source);
    const bytes = readBounded(file, KAR_CLI_MAX_TEXT_BYTES);
    sources.push({
      source,
      bytes,
      sha256: digest(bytes),
    });
  }

  const apis = await loadApis();
  let trace = null;
  if (tracePath) {
    const citeBytes = readBounded(cite, KAR_CLI_MAX_IMAGE_BYTES);
    const cited = apis.core.mountKnowledgeImageV5(citeBytes);
    const traceBytes = readBounded(tracePath, KAR_CLI_MAX_TEXT_BYTES);
    const parsed = JSON.parse(new TextDecoder().decode(traceBytes));
    const graph = flags.graph
      ? JSON.parse(
          new TextDecoder().decode(
            readBounded(flags.graph, KAR_CLI_MAX_TEXT_BYTES)
          )
        )
      : undefined;
    const verified = await apis.cortex.verifyCortexAnswer({
      image: new Uint8Array(citeBytes),
      question: typeof parsed.question === 'string' ? parsed.question : '',
      result: parsed,
      ...(graph === undefined ? {} : { graph }),
    });
    if (!verified.ok) throw new Error(`${verified.code}: ${verified.message}`);
    trace = {
      bytes: traceBytes,
      traceRoot: verified.traceRoot,
      citedStateRoot: cited.stateRoot,
    };
  }

  const objects = [
    {
      kind: 'metadata',
      bytes: questionBytes,
      meta: { role: 'research-pack', agent },
    },
    ...sources.map((source) => ({
      kind: 'chunk',
      bytes: source.bytes,
      meta: { source: source.source, sha256: source.sha256 },
    })),
  ];
  if (trace) {
    objects.push({
      kind: 'metadata',
      bytes: trace.bytes,
      meta: {
        role: 'cortex-trace',
        traceRoot: trace.traceRoot,
        citedStateRoot: trace.citedStateRoot,
      },
    });
  }
  const image = apis.core.createKnowledgeImageV5({
    actor: ACTOR,
    sequence: 1,
    objects,
  });
  writeNewFile(resolvedOut, outPath, Buffer.from(image.bytes));
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          stateRoot: image.stateRoot,
          sources: sources.length,
          traceRoot: trace ? trace.traceRoot : null,
        },
        null,
        2
      )
    );
    return;
  }
  console.log(
    `RESEARCH PACK\nstate root       ${image.stateRoot}\nsources          ${sources.length}\ntrace            ${trace ? trace.traceRoot : 'none'}\nwrote            ${outPath}\n\nA packed trace is an integrity check. It does not mean a claim is proven.\nSATISFIED means evidence requirements were met.`
  );
}

function writeNewFile(resolved, display, bytes) {
  try {
    writeFileSync(resolved, bytes, { flag: 'wx' });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite ${display}`);
    }
    try {
      unlinkSync(resolved);
    } catch {
      // The original write error is the one to surface.
    }
    throw error;
  }
}

function digest(bytes) {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

function required(value, flag) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`RESEARCH_PACK_INVALID: ${flag} is required.`);
  }
  return value;
}

async function loadApis() {
  const dist = path.resolve(__dirname, '../../core/dist');
  const core = await importFirst(
    [path.join(dist, 'index.js'), '@knolo/core'],
    (loaded) => loaded.createKnowledgeImageV5 && loaded.mountKnowledgeImageV5
  );
  const cortex = await importFirst(
    [path.join(dist, 'cortex/index.js'), '@knolo/core/cortex'],
    (loaded) => loaded.verifyCortexAnswer
  );
  return { core, cortex };
}

async function importFirst(candidates, check) {
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@')
        ? candidate
        : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (check(loaded)) return loaded;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Could not load @knolo/core. Build packages/core first.');
}

function parseFlags(argv) {
  const flags = { sources: [], help: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (!arg.startsWith('--'))
      throw new Error(`Unexpected argument "${arg}".\n${USAGE}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    index += 1;
    if (key === 'source') flags.sources.push(value);
    else if (key === 'question') flags.question = value;
    else if (key === 'agent') flags.agent = value;
    else if (key === 'out') flags.out = value;
    else if (key === 'cite') flags.cite = value;
    else if (key === 'trace') flags.trace = value;
    else if (key === 'graph') flags.graph = value;
    else throw new Error(`Unknown option --${key}.\n${USAGE}`);
  }
  return flags;
}
