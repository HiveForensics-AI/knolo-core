/**
 * knolo kite evaluate | verify
 *
 * Replays a typed contract against a local V5 image.
 * It does not call a model and it does not download an image.
 * A certificate is an integrity check. It does not mean a claim is true.
 */
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  KAR_CLI_MAX_IMAGE_BYTES,
  KAR_CLI_MAX_TEXT_BYTES,
  readBounded,
} from './kar-limits.mjs';

const USAGE = `Usage: knolo kite <evaluate|verify> [options]

  knolo kite evaluate --image <image.knolo> --contract <contract.json> --rules <rules.json> [--completeness <file>] [--changes <file>] [--bounds <file>] [--graph <file>] [--as-of YYYY-MM-DD] [--out <result.json>] [--json]
  knolo kite verify --image <image.knolo> --contract <contract.json> --rules <rules.json> --certificate <certificate.json> [--completeness <file>] [--changes <file>] [--bounds <file>] [--graph <file>] [--as-of YYYY-MM-DD]

Evaluation names unmet obligations and derives a verdict inside the declared changes.
Verification recomputes that derivation.
A certificate is an integrity check. It does not mean the claim is true.
BOUND_EXCEEDED means the search did not finish and is not a certificate.`;

export async function runKiteCli(argv) {
  if (
    argv.length === 0 ||
    argv[0] === 'help' ||
    argv[0] === '--help' ||
    argv[0] === '-h'
  ) {
    console.log(USAGE);
    return;
  }
  const command = argv[0];
  if (command !== 'evaluate' && command !== 'verify') {
    throw new Error(`Unknown kite command "${command}".\n${USAGE}`);
  }
  const flags = parseFlags(argv.slice(1));
  if (flags.help) {
    console.log(USAGE);
    return;
  }
  try {
    if (command === 'evaluate') await evaluate(flags);
    else await verify(flags);
  } catch (error) {
    if (
      error &&
      typeof error.code === 'string' &&
      error.code.startsWith('KITE')
    ) {
      throw new Error(`${error.code}: ${error.message}`);
    }
    if (error && error.code === 'BOUND_EXCEEDED') {
      throw new Error(`${error.code}: ${error.message}`);
    }
    throw error;
  }
}

async function evaluate(flags) {
  const api = await loadKite();
  const session = createSession(api, flags);
  const result = await api.evaluateKiteSession(session, optionsFrom(flags));
  const body = `${JSON.stringify(result, null, 2)}\n`;
  if (flags.out) writeNew(flags.out, body);
  if (flags.json || !flags.out) {
    if (flags.json) process.stdout.write(body);
    else if (result.certificate) {
      console.log(`${result.verdict} ${result.certificate.invarianceRoot}`);
    } else console.log(result.verdict);
  }
}

async function verify(flags) {
  const api = await loadKite();
  const certificate = readJson(required(flags.certificate, '--certificate'));
  const verified = await api.verifyKiteCertificate({
    ...inputFrom(flags),
    ...optionsFrom(flags),
    certificate,
  });
  if (!verified.ok) throw new Error(`${verified.code}: ${verified.message}`);
  console.log(`ok ${verified.invarianceRoot}`);
}

function createSession(api, flags) {
  return api.createKiteSession(inputFrom(flags));
}

function inputFrom(flags) {
  const input = {
    image: new Uint8Array(
      readBounded(required(flags.image, '--image'), KAR_CLI_MAX_IMAGE_BYTES)
    ),
    contract: readJson(required(flags.contract, '--contract')),
    rules: readJson(required(flags.rules, '--rules')),
  };
  if (flags.completeness) input.completeness = readJson(flags.completeness);
  if (flags.changes) input.changes = readJson(flags.changes);
  if (flags.bounds) input.bounds = readJson(flags.bounds);
  if (flags.graph) input.graph = readJson(flags.graph);
  return input;
}

function optionsFrom(flags) {
  const options = {};
  if (flags.question) options.question = flags.question;
  if (flags.asOf) options.asOf = flags.asOf;
  return options;
}

function readJson(file) {
  const bytes = readBounded(file, KAR_CLI_MAX_TEXT_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(
      `KITE_CONTRACT_INVALID: ${path.basename(file)} is not JSON.`
    );
  }
}

function writeNew(file, body) {
  const resolved = path.resolve(process.cwd(), file);
  if (existsSync(resolved)) throw new Error(`Refusing to overwrite ${file}`);
  try {
    writeFileSync(resolved, body, { flag: 'wx' });
  } catch (error) {
    if (error && error.code !== 'EEXIST') {
      try {
        unlinkSync(resolved);
      } catch {
        // The file was not created.
      }
    }
    throw error;
  }
}

async function loadKite() {
  const candidate = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../core/dist/kite/index.js'
  );
  const loaded = await import(pathToFileURL(candidate).href);
  if (
    !loaded.createKiteSession ||
    !loaded.evaluateKiteSession ||
    !loaded.verifyKiteCertificate
  ) {
    throw new Error(
      'Could not load @knolo/core/kite. Build packages/core first.'
    );
  }
  return loaded;
}

function required(value, name) {
  if (!value) throw new Error(`Missing ${name}.\n${USAGE}`);
  return value;
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--image') flags.image = args[++index];
    else if (arg === '--contract') flags.contract = args[++index];
    else if (arg === '--rules') flags.rules = args[++index];
    else if (arg === '--completeness') flags.completeness = args[++index];
    else if (arg === '--changes') flags.changes = args[++index];
    else if (arg === '--bounds') flags.bounds = args[++index];
    else if (arg === '--graph') flags.graph = args[++index];
    else if (arg === '--certificate') flags.certificate = args[++index];
    else if (arg === '--as-of') flags.asOf = args[++index];
    else if (arg === '--question') flags.question = args[++index];
    else if (arg === '--out') flags.out = args[++index];
    else throw new Error(`Unknown kite option "${arg}".\n${USAGE}`);
  }
  return flags;
}
