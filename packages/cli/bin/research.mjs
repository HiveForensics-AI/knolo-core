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

const PACKAGE_USAGE = `Usage: knolo research package --question <text> --agent <id> --out <image.knolo> --source <file> [--source <file>] [--cite <image.knolo> --trace <answer.cortex.json> [--graph <file>]] [--json]

Packs local files into one V5 Knowledge Image. --agent is the host-supplied caller.
--cite and --trace are both required or both omitted. --graph is required when the
trace contains KAR evaluations, and it is the same file knolo cortex verify would use.
A trace is verified against --cite before any write. A failed check writes nothing.
When --cite is set, the image stores a digest-bound composition record for that
image and does not copy its bytes. When --graph is set, the checked graph is stored.
The command does not call a model and does not download an image.
A packed trace is an integrity check. It does not mean a claim is proven.
SATISFIED means the trace evidence requirements were met.`;

const VERIFY_USAGE = `Usage: knolo research verify <image.knolo> [--cited <file>]... [--require-material] [--json]

Verifies the image roots, then re-checks a stored composition record, Cortex trace,
and KAR graph with the existing verifiers. --cited supplies member bytes in member
order. Without those bytes, digest mode succeeds and says the cited bytes were not
supplied. --require-material fails when a member has no bytes. The command does not
call a model and does not download an image. A verified trace is an integrity check.
It does not mean a claim is proven. SATISFIED means evidence requirements were met.`;

const USAGE = `${PACKAGE_USAGE}\n\n${VERIFY_USAGE}`;

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
  if (argv[0] === 'package') {
    const flags = parseFlags(argv.slice(1));
    if (flags.help) {
      console.log(PACKAGE_USAGE);
      return;
    }
    await packageResearch(flags);
    return;
  }
  if (argv[0] === 'verify') {
    const flags = parseVerifyFlags(argv.slice(1));
    if (flags.help) {
      console.log(VERIFY_USAGE);
      return;
    }
    await verifyResearch(flags);
    return;
  }
  throw new Error(`Unknown research command "${argv[0]}".\n${USAGE}`);
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
    const graphBytes = flags.graph
      ? readBounded(flags.graph, KAR_CLI_MAX_TEXT_BYTES)
      : undefined;
    const graph =
      graphBytes === undefined
        ? undefined
        : JSON.parse(new TextDecoder().decode(graphBytes));
    const verified = await apis.cortex.verifyCortexAnswer({
      image: new Uint8Array(citeBytes),
      question: typeof parsed.question === 'string' ? parsed.question : '',
      result: parsed,
      ...(graph === undefined ? {} : { graph }),
    });
    if (!verified.ok) throw new Error(`${verified.code}: ${verified.message}`);
    const composition = compositionForCite(apis.composition, {
      cited,
      citeBytes,
      traceRoot: verified.traceRoot,
    });
    trace = {
      bytes: traceBytes,
      traceRoot: verified.traceRoot,
      citedStateRoot: cited.stateRoot,
      composition,
      graphBytes,
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
    objects.push({
      kind: 'metadata',
      bytes: Buffer.from(trace.composition.text),
      meta: {
        role: 'composition',
        compositionRoot: trace.composition.compositionRoot,
        citedStateRoot: trace.citedStateRoot,
        traceRoot: trace.traceRoot,
      },
    });
    if (trace.graphBytes) {
      objects.push({
        kind: 'metadata',
        bytes: trace.graphBytes,
        meta: { role: 'kar-graph' },
      });
    }
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

async function verifyResearch(flags) {
  if (!flags.image) {
    throw new Error(`RESEARCH_PACK_INVALID: pass the research image.\n${VERIFY_USAGE}`);
  }
  const bytes = readBounded(flags.image, KAR_CLI_MAX_IMAGE_BYTES);
  const apis = await loadApis();
  let verification;
  try {
    verification = apis.core.verifyKnowledgeImageV5(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`KNOWLEDGE_IMAGE_INVALID: ${message}`);
  }
  if (!verification.valid) {
    throw new Error('KNOWLEDGE_IMAGE_INVALID: Image roots do not verify.');
  }
  const image = apis.core.mountKnowledgeImageV5(bytes);
  const packs = byRole(image, 'research-pack');
  const traces = byRole(image, 'cortex-trace');
  const compositions = byRole(image, 'composition');
  const graphs = byRole(image, 'kar-graph');
  if (packs.length !== 1) {
    throw new Error('RESEARCH_PACK_INVALID: the image needs one research-pack object.');
  }
  const agent = packs[0].meta.agent;
  if (typeof agent !== 'string' || !AGENT.test(agent)) {
    throw new Error('RESEARCH_PACK_INVALID: the research pack has no caller.');
  }
  if (traces.length > 1 || compositions.length > 1 || graphs.length > 1) {
    throw new Error('RESEARCH_PACK_INVALID: a research role is repeated.');
  }
  if (Boolean(traces.length) !== Boolean(compositions.length) || (graphs.length && !traces.length)) {
    throw new Error('RESEARCH_PACK_INVALID: the citation, trace, and graph do not belong together.');
  }

  let members = [];
  let citedBytesSupplied = false;
  let compositionRoot = null;
  const supplied = new Map();
  if (compositions.length === 1) {
    const record = parseJson(compositions[0].bytes, 'COMPOSITION_INVALID');
    let parsed;
    try {
      parsed = apis.composition.parseCompositionRecord(record);
    } catch (error) {
      throw coded(error, 'COMPOSITION_INVALID');
    }
    if (compositions[0].meta.compositionRoot !== parsed.compositionRoot) {
      throw new Error('COMPOSITION_ROOT_MISMATCH: Stored compositionRoot does not match the record.');
    }
    if (flags.cited.length > parsed.members.length) {
      throw new Error('RESEARCH_PACK_INVALID: more --cited files than composition members.');
    }
    const material = {};
    for (let index = 0; index < flags.cited.length; index += 1) {
      const member = parsed.members[index];
      const citedBytes = new Uint8Array(readBounded(flags.cited[index], KAR_CLI_MAX_IMAGE_BYTES));
      material[member.alias] = { bytes: citedBytes };
      supplied.set(member.alias, citedBytes);
    }
    citedBytesSupplied = flags.cited.length > 0;
    const verdict = apis.composition.verifyCompositionRecord(record, {
      members: material,
      requireMaterial: flags.requireMaterial,
    });
    if (!verdict.ok) {
      throw new Error(`${verdict.code}: composition check failed.`);
    }
    compositionRoot = verdict.compositionRoot;
    members = verdict.members.map((status) => {
      const member = parsed.members.find((item) => item.alias === status.alias);
      return {
        alias: status.alias,
        status: status.status,
        stateRoot: member && member.stateRoot ? member.stateRoot : null,
        sha256: member && member.sha256 ? member.sha256 : null,
      };
    });
    const cite = members.find((member) => member.alias === 'cite');
    if (cite && compositions[0].meta.citedStateRoot !== cite.stateRoot) {
      throw new Error('COMPOSITION_DIGEST_MISMATCH: Stored citedStateRoot does not match the record.');
    }
  } else if (flags.requireMaterial && flags.cited.length > 0) {
    throw new Error('RESEARCH_PACK_INVALID: --cited was passed and the image has no composition record.');
  } else if (flags.cited.length > 0) {
    throw new Error('RESEARCH_PACK_INVALID: --cited was passed and the image has no composition record.');
  }

  let traceRoot = null;
  let traceChecked = false;
  let traceStatuses = [];
  const citeBytes = supplied.get('cite');
  if (traces.length === 1) {
    const trace = parseJson(traces[0].bytes, 'CORTEX_TRACE_INVALID');
    traceStatuses = Array.isArray(trace.karEvaluations)
      ? trace.karEvaluations.map((item) => item && item.status).filter((status) => typeof status === 'string')
      : [];
    if (citeBytes) {
      const graph = graphs.length === 1 ? parseJson(graphs[0].bytes, 'KAR_SIDECAR_INVALID') : undefined;
      if (graph !== undefined) {
        const kar = await loadKar();
        try {
          kar.createKarSession({ image: citeBytes, graph });
        } catch (error) {
          throw coded(error, 'KAR_GRAPH_INVALID');
        }
      }
      const verified = await apis.cortex.verifyCortexAnswer({
        image: citeBytes,
        question: typeof trace.question === 'string' ? trace.question : '',
        result: trace,
        ...(graph === undefined ? {} : { graph }),
      });
      if (!verified.ok) throw new Error(`${verified.code}: ${verified.message}`);
      if (traces[0].meta.traceRoot !== verified.traceRoot) {
        throw new Error('CORTEX_ROOT_MISMATCH: Stored traceRoot does not match the trace.');
      }
      traceRoot = verified.traceRoot;
      traceChecked = true;
    } else {
      traceRoot = typeof traces[0].meta.traceRoot === 'string' ? traces[0].meta.traceRoot : null;
    }
  }

  let graphChecked = false;
  if (graphs.length === 1) {
    const graph = parseJson(graphs[0].bytes, 'KAR_SIDECAR_INVALID');
    const kar = await loadKar();
    if (citeBytes) {
      if (!traceChecked) {
        try {
          kar.createKarSession({ image: citeBytes, graph });
        } catch (error) {
          throw coded(error, 'KAR_GRAPH_INVALID');
        }
      }
      graphChecked = true;
    } else {
      const sidecar = kar.validateKarSidecar(graph);
      if (!sidecar.ok) {
        const issue = sidecar.errors[0];
        throw new Error(`${issue.code}: ${issue.message}`);
      }
    }
  }

  const summary = {
    ok: true,
    stateRoot: verification.stateRoot,
    sha256: digest(bytes),
    agent,
    compositionRoot,
    citedBytesSupplied,
    members,
    traceRoot,
    traceChecked,
    traceStatuses,
    graphChecked,
    graphPresent: graphs.length === 1,
  };
  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const citedLines = members.length
    ? members
        .map((member) => `${member.alias} ${member.status} ${member.sha256} ${member.stateRoot}`)
        .join('\n                 ')
    : 'none';
  const traceLine = !traces.length
    ? 'none'
    : traceChecked
      ? `${traceRoot}${traceStatuses.length ? ` ${traceStatuses.join(',')}` : ''}`
      : `${traceRoot ?? 'stored'} not re-checked`;
  const graphLine = !graphs.length ? 'none' : graphChecked ? 'checked' : 'present, cited bytes were not supplied';
  const digestNote =
    compositions.length === 1 && !citedBytesSupplied
      ? '\nCited bytes were not supplied.\n'
      : '\n';
  console.log(
    `RESEARCH VERIFY\nstate root       ${summary.stateRoot}\nfile sha256      ${summary.sha256}\nagent            ${agent}\ncited            ${citedLines}\ntrace            ${traceLine}\ngraph            ${graphLine}\n${digestNote}A verified trace is an integrity check. It does not mean a claim is proven.\nSATISFIED means evidence requirements were met.`
  );
}

function byRole(image, role) {
  return image.objects.filter((object) => object.meta && object.meta.role === role);
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${code}: stored JSON is not valid.`);
  }
}

function coded(error, fallback) {
  if (error && typeof error.code === 'string' && error.code.length > 0) {
    return new Error(`${error.code}: ${error.message}`);
  }
  if (error instanceof Error && /^[A-Z0-9_]+:/.test(error.message)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${fallback}: ${message}`);
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

function compositionForCite(composition, input) {
  let created;
  try {
    created = composition.createCompositionRecord({
      host: { kind: 'none' },
      availability: 'digest',
      members: [
        {
          alias: 'cite',
          kind: 'v5-image',
          stateRoot: input.cited.stateRoot,
          objectRoot: input.cited.commit.objectRoot,
          commitDigest: input.cited.commitDigest,
          sha256: digest(input.citeBytes),
        },
      ],
    });
  } catch (error) {
    const code = error && error.code ? error.code : 'COMPOSITION_INVALID';
    throw new Error(`${code}: ${error.message}`);
  }
  const verdict = composition.verifyCompositionRecord(created.record);
  if (!verdict.ok) {
    throw new Error(`${verdict.code}: composition check failed.`);
  }
  return {
    compositionRoot: created.compositionRoot,
    text: JSON.stringify(created.record),
  };
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

async function loadKar() {
  const dist = path.resolve(__dirname, '../../core/dist');
  return importFirst(
    [path.join(dist, 'experimental/kar/index.js'), '@knolo/core/experimental/kar'],
    (loaded) => loaded.createKarSession && loaded.validateKarSidecar
  );
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
  const composition = await importFirst(
    [path.join(dist, 'composition/index.js'), '@knolo/core/composition'],
    (loaded) => loaded.createCompositionRecord && loaded.verifyCompositionRecord
  );
  return { core, cortex, composition };
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

function parseVerifyFlags(argv) {
  const flags = { cited: [], help: false, json: false, requireMaterial: false, image: '' };
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
    if (arg === '--require-material') {
      flags.requireMaterial = true;
      continue;
    }
    if (arg === '--cited') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Missing value for --cited');
      }
      flags.cited.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}.\n${VERIFY_USAGE}`);
    }
    if (flags.image) throw new Error(`Unexpected argument "${arg}".\n${VERIFY_USAGE}`);
    flags.image = arg;
  }
  return flags;
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
