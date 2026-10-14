/**
 * knolo cortex
 *
 * Bounded evidence retrieval. The CLI does not call a model and does not
 * take an API key. Verification recomputes roots. It does not mean the
 * answer is true.
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KAR_CLI_MAX_IMAGE_BYTES, KAR_CLI_MAX_TEXT_BYTES, readBounded, readBoundedJson } from './kar-limits.mjs';

const USAGE = `Usage:
  knolo cortex find <image> --question "..." [--top-k 100] [--policy policy.json] --out candidates.json
  knolo cortex ask <image> --question "..." [--graph file] [--plan plan.json] [--mode find_relevant] [--policy policy.json] [--created-at text] --out answer.cortex.json
  knolo cortex explain <answer.cortex.json>
  knolo cortex verify --image <image> --answer answer.cortex.json [--graph file] [--question "..."]

The CLI does not load a model. Hosts inject a model through createCortexSession.
Verification checks the trace against the image. It does not mean the answer is true.
SATISFIED on a KAR reference means evidence requirements were met. It does not mean a claim is proven.`;

export async function runCortexCli(args) {
  const sub = args[0];
  if (sub === 'find') return writeTrace(await runAsk(parseFlags(args.slice(1)), 'find_relevant'));
  if (sub === 'ask') return writeTrace(await runAsk(parseFlags(args.slice(1)), undefined));
  if (sub === 'explain') return explain(parseFlags(args.slice(1)));
  if (sub === 'verify') return verify(parseFlags(args.slice(1)));
  throw new Error(`Unknown cortex command.\n${USAGE}`);
}

async function runAsk(flags, forcedMode) {
  const imagePath = flags._[0];
  if (!imagePath) throw new Error(USAGE);
  const question = required(flags, 'question');
  const api = await loadCortex();
  const policy = flags.policy ? readBoundedJson(flags.policy) : {};
  if (flags['top-k'] !== undefined) {
    const topK = Number(flags['top-k']);
    if (!Number.isInteger(topK) || topK < 1) throw new Error('--top-k must be a positive integer.');
    policy.maxCandidatesPerRound = topK;
  }
  const session = await api.createCortexSession({
    image: new Uint8Array(readBounded(imagePath, KAR_CLI_MAX_IMAGE_BYTES)),
    ...(flags.graph ? { graph: readBoundedJson(flags.graph) } : {}),
    ...(flags.plan ? { plan: readBoundedJson(flags.plan) } : {}),
    policy,
  });
  const mode = forcedMode ?? flags.mode ?? 'evidence_answer';
  const trace = await api.askCortex(session, {
    question,
    mode,
    ...(flags['created-at'] ? { createdAt: flags['created-at'] } : {}),
  });
  return { flags, trace };
}

async function writeTrace(result) {
  const json = `${JSON.stringify(result.trace, null, 2)}\n`;
  if (result.flags.out) {
    const out = path.resolve(process.cwd(), result.flags.out);
    if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
    writeFileSync(out, json);
    console.log(`${result.trace.answer.status} ${result.trace.receipt.traceRoot}`);
    return;
  }
  console.log(json);
}

async function explain(flags) {
  const file = flags._[0] ?? flags.answer;
  if (!file) throw new Error(USAGE);
  const api = await loadCortex();
  const trace = readBoundedJson(file);
  console.log(`${JSON.stringify(api.explainCortexAnswer(trace), null, 2)}\n`);
}

async function verify(flags) {
  const api = await loadCortex();
  const answer = required(flags, 'answer');
  const image = required(flags, 'image');
  const trace = readBoundedJson(answer, KAR_CLI_MAX_TEXT_BYTES);
  const verified = await api.verifyCortexAnswer({
    image: new Uint8Array(readBounded(image, KAR_CLI_MAX_IMAGE_BYTES)),
    question: flags.question ?? trace.question,
    result: trace,
    ...(flags.graph ? { graph: readBoundedJson(flags.graph) } : {}),
  });
  if (!verified.ok) throw new Error(`${verified.code}: ${verified.message}`);
  console.log(`ok ${verified.traceRoot}`);
}

async function loadCortex() {
  const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/dist/cortex/index.js');
  const loaded = await import(pathToFileURL(candidate).href);
  if (!loaded.createCortexSession || !loaded.askCortex || !loaded.verifyCortexAnswer) {
    throw new Error('Could not load @knolo/core/cortex. Build packages/core first.');
  }
  return loaded;
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`Missing --${name}.\n${USAGE}`);
  return flags[name];
}

function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--question') flags.question = args[++i];
    else if (arg === '--graph') flags.graph = args[++i];
    else if (arg === '--plan') flags.plan = args[++i];
    else if (arg === '--mode') flags.mode = args[++i];
    else if (arg === '--policy') flags.policy = args[++i];
    else if (arg === '--out') flags.out = args[++i];
    else if (arg === '--top-k') flags['top-k'] = args[++i];
    else if (arg === '--created-at') flags['created-at'] = args[++i];
    else if (arg === '--image') flags.image = args[++i];
    else if (arg === '--answer') flags.answer = args[++i];
    else if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}.\n${USAGE}`);
    else flags._.push(arg);
  }
  return flags;
}
