import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { KAR_CLI_MAX_IMAGE_BYTES, readBounded, readBoundedJson, readBoundedText } from './kar-limits.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `Usage: knolo kar <evaluate|verify|explain|inspect|graph|package|produce|domain|dossier|benchmark|demo|conformance> [options]

Knolo Adversarial Retrieval over a Committed Evidence Graph. Semantics are kar-1-research-1.
This command does not change V4 query, BM25, or MMR.
CEG authoring compiles source into the frozen sidecar. It does not change retrieval.
Producers propose CEG Source. They do not write committed graph bytes.
Domain Pack relation rules are review-required until a human gold gate says otherwise.

  knolo kar evaluate --image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..."
  knolo kar verify   --image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..." --result result.json
  knolo kar explain  --result result.json [--image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..."]
  knolo kar inspect  --image knowledge.knolo --graph knowledge.kar.json [--plan plan.json] [--query "..."]
  knolo kar graph build --image knowledge.knolo --source knowledge.ceg.yaml --out knowledge.kar.json
  knolo kar graph lint|review|inspect|diff|validate|check|rebuild
  knolo kar graph import claim-graph|json
  knolo kar package --image knowledge.knolo --graph knowledge.kar.json --out dist/my-knowledge-kar/
  knolo kar package verify dist/my-knowledge-kar/
  knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out proposals.json
  knolo kar produce review proposals.json
  knolo kar produce apply --proposals proposals.json --out generated.ceg.yaml
  knolo kar domain validate domains/contracts
  knolo kar domain inspect domains/contracts
  knolo kar domain test domains/contracts
  knolo kar dossier build --image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..." --out dossier/
  knolo kar dossier verify dossier/
  knolo kar benchmark annotate --packet packet.json --decisions decisions.json --out labels.json --role human --reviewer-id <id>
  knolo kar benchmark adjudicate --packet packet.json --a pass-a.json --b pass-b.json --decisions decisions.json --out gold.json --role human-adjudicator --reviewer-id <id>
  knolo kar benchmark agreement --a pass-a.json --b pass-b.json
  knolo kar demo
  knolo kar conformance

  --json              Print the machine-readable evaluation, build, or inspection
  --auto              Write accepted deterministic producer output as CEG Source

Exit status is 0 for a completed command, including a KAR abstention.
verify, dossier verify, and conformance return non-zero when a check fails.
`;

export async function runKarCli(argv) {
  const { command, positionals, flags } = parseArgs(argv);
  if (!command || command === 'help' || flags.help) {
    console.log(USAGE.trim());
    return;
  }
  if (command === 'graph' || command === 'package') {
    const { runKarAuthoring } = await import('./kar-graph.mjs');
    return runKarAuthoring(command, positionals.slice(1), flags);
  }
  if (command === 'produce' || command === 'domain') {
    const { runKarProduce } = await import('./kar-produce.mjs');
    return runKarProduce(command, positionals.slice(1), flags);
  }
  if (command === 'benchmark') {
    const { runKarBenchmark } = await import('./kar-benchmark.mjs');
    return runKarBenchmark(positionals.slice(1), flags);
  }
  if (command === 'demo') return runRepoScript(path.join('examples', 'kar-v6', 'run.mjs'));
  if (command === 'conformance') return runRepoScript(path.join('conformance', 'kar', 'v1', 'run.mjs'));
  const kar = await loadKar();
  if (command === 'dossier') return dossierCommand(kar, positionals.slice(1), flags);
  if (command === 'evaluate') return evaluateCommand(kar, flags);
  if (command === 'verify') return verifyCommand(kar, flags);
  if (command === 'explain') return explainCommand(kar, flags);
  if (command === 'inspect') return inspectCommand(kar, flags);
  throw new Error(`Unknown kar command "${command}".\n${USAGE}`);
}

async function evaluateCommand(kar, flags) {
  const { session, plan, query } = openSession(kar, flags, true);
  const result = kar.evaluateKar(session, { proposition: query, plan });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(kar.renderKarEvaluation(result));
}

async function verifyCommand(kar, flags) {
  const image = readBytes(required(flags, 'image'));
  const graph = readJson(required(flags, 'graph'));
  const plan = readJson(required(flags, 'plan'));
  const query = required(flags, 'query');
  const result = readJson(required(flags, 'result'));
  const verdict = kar.verifyKar({ image, graph, proposition: query, plan, result });
  if (!verdict.ok) {
    console.log(verdict.code);
    console.log(verdict.reason);
    process.exitCode = 1;
    return;
  }
  console.log('VERIFIED');
}

async function explainCommand(kar, flags) {
  const result = readJson(required(flags, 'result'));
  const wantsResolution = flags.image || flags.graph || flags.plan || flags.query;
  if (wantsResolution && !(flags.image && flags.graph && flags.plan && flags.query)) {
    throw new Error('Resolving evidence text requires --image, --graph, --plan, and --query together. Certificate-only explanation uses --result alone.');
  }
  const explanation = wantsResolution
    ? kar.explainKarResult(openSession(kar, flags, true).session, result)
    : kar.explainKarCertificate(result);
  if (flags.json) {
    console.log(JSON.stringify(explanation, null, 2));
    return;
  }
  console.log(kar.renderKarExplanation(explanation));
}

async function inspectCommand(kar, flags) {
  const { session, plan } = openSession(kar, flags, false);
  const graph = session.graph;
  const symbols = [...new Set(graph.relations.map((relation) => relation.relation))].sort();
  const complexity = plan ? kar.inspectKarComplexity(session, plan, flags.query ?? '') : null;
  const report = {
    experimental: true,
    semantics: 'kar-1-research-1',
    stateRoot: session.image.stateRoot,
    knowledgeRoot: session.image.knowledgeRoot,
    objectRoot: session.image.objectRoot,
    commitDigest: session.image.commitDigest,
    semanticRoot: session.roots.semanticRoot,
    nodes: graph.nodes.length,
    relations: graph.relations.length,
    evidenceBindings: graph.bindings.length,
    relationTypes: symbols,
    cover: complexity,
    bounds: plan ? plan.bounds : null,
  };
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines = [
    'KAR INSPECTION',
    `V5 state root        ${report.stateRoot ?? '(none)'}`,
    `KAR knowledge root   ${report.knowledgeRoot}`,
    `CEG semantic root    ${report.semanticRoot}`,
    `object root          ${report.objectRoot ?? '(none)'}`,
    `commit digest        ${report.commitDigest ?? '(none)'}`,
    `nodes                ${report.nodes}`,
    `relations            ${report.relations}`,
    `evidence bindings    ${report.evidenceBindings}`,
    `relation types       ${symbols.join(', ') || '(none)'}`,
  ];
  if (!complexity) {
    lines.push('cover complexity     plan not supplied');
  } else {
    lines.push(`cover risk           ${complexity.risk}`);
    lines.push(`candidates           ${complexity.candidates}`);
    lines.push(`distinct masks       ${complexity.distinctRequirementMasks}`);
    lines.push(`cardinality bound    ${complexity.cardinalityBound}`);
    lines.push(`max cover visits     ${complexity.maxCoverVisits}`);
    lines.push(`combination bound    ${complexity.estimatedCombinationUpperBound}`);
  }
  if (plan) {
    lines.push(`resource bounds      closureNodes ${plan.bounds.maxClosureNodes}, closureEdges ${plan.bounds.maxClosureEdges}, coverVisits ${plan.bounds.maxCoverVisits}`);
  }
  console.log(lines.join('\n'));
}

function dossierCommand(kar, args, flags) {
  if (!kar.createKarDossier || !kar.renderKarDossier || !kar.verifyKarDossier) {
    throw new Error('Could not load the KAR dossier API. Build packages/core first.');
  }
  const sub = args[0];
  if (sub === 'build') return buildDossier(kar, flags);
  if (sub === 'verify') return verifyDossier(kar, args[1]);
  throw new Error(`Unknown dossier command "${sub ?? ''}".\n${USAGE}`);
}

function buildDossier(kar, flags) {
  const out = path.resolve(process.cwd(), required(flags, 'out'));
  if (existsSync(path.join(out, 'manifest.json'))) {
    throw new Error(`Refusing to overwrite ${out}`);
  }
  const imagePath = path.resolve(process.cwd(), required(flags, 'image'));
  const graphPath = path.resolve(process.cwd(), required(flags, 'graph'));
  const planPath = path.resolve(process.cwd(), required(flags, 'plan'));
  const proposition = required(flags, 'query');
  const image = readBytes(imagePath);
  const graph = readJson(graphPath);
  const plan = readJson(planPath);
  const dossier = kar.createKarDossier({ image, graph, plan, proposition });
  mkdirSync(out, { recursive: true });
  copyFileSync(imagePath, path.join(out, 'knowledge.knolo'));
  copyFileSync(graphPath, path.join(out, 'knowledge.kar.json'));
  copyFileSync(planPath, path.join(out, 'plan.json'));
  writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(dossier.manifest, null, 2)}\n`);
  writeFileSync(path.join(out, 'certificate.json'), `${JSON.stringify(dossier.certificate, null, 2)}\n`);
  writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(dossier.evaluation, null, 2)}\n`);
  writeFileSync(path.join(out, 'evidence.md'), kar.renderKarDossier(dossier));
  if (flags.json) console.log(JSON.stringify(dossier.manifest, null, 2));
  else console.log(`${dossier.statusStatement}\n${out}`);
}

function verifyDossier(kar, directory) {
  if (!directory) throw new Error('Missing dossier directory.\nknolo kar dossier verify dossier/');
  const dir = path.resolve(process.cwd(), directory);
  const image = readBytes(path.join(dir, 'knowledge.knolo'));
  const graph = readJson(path.join(dir, 'knowledge.kar.json'));
  const plan = readJson(path.join(dir, 'plan.json'));
  const manifest = readJson(path.join(dir, 'manifest.json'));
  const certificate = readJson(path.join(dir, 'certificate.json'));
  const evaluation = readJson(path.join(dir, 'result.json'));
  const evidenceMarkdown = readBoundedText(path.join(dir, 'evidence.md'));
  const proposition = evaluation && typeof evaluation.proposition === 'string' ? evaluation.proposition : '';
  if (!proposition) {
    console.log('KAR_RESULT_INVALID');
    console.log('The dossier result has no proposition.');
    process.exitCode = 1;
    return;
  }
  const verdict = kar.verifyKarDossier({
    image,
    graph,
    plan,
    proposition,
    manifest,
    certificate,
    evaluation,
    evidenceMarkdown,
  });
  if (!verdict.ok) {
    console.log(verdict.code);
    console.log(verdict.reason);
    process.exitCode = 1;
    return;
  }
  console.log('VERIFIED');
}

function openSession(kar, flags, requirePlan) {
  const image = readBytes(required(flags, 'image'));
  const graph = readJson(required(flags, 'graph'));
  const session = kar.createKarSession({ image, graph });
  if (!requirePlan && !flags.plan) return { session, plan: null, query: flags.query ?? '' };
  const plan = readJson(required(flags, 'plan'));
  const query = requirePlan ? required(flags, 'query') : flags.query ?? '';
  return { session, plan, query };
}

function runRepoScript(relative) {
  const root = findRepoRoot(process.cwd()) ?? findRepoRoot(path.resolve(__dirname, '../../..'));
  const script = root ? path.join(root, relative) : '';
  if (!root || !existsSync(script)) {
    throw new Error(`Could not find ${relative}. Run this command from a knolo-core checkout.`);
  }
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  process.exitCode = result.status === null ? 1 : result.status;
}

function findRepoRoot(start) {
  let dir = start;
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(path.join(dir, 'packages', 'core', 'package.json')) && existsSync(path.join(dir, 'conformance', 'kar', 'v1', 'run.mjs'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

async function loadKar() {
  const candidates = [
    '@knolo/core/kar',
    path.resolve(__dirname, '../../core/dist/kar/index.js'),
    path.resolve(__dirname, '../../core/dist/experimental/kar/index.js'),
    '@knolo/core/experimental/kar',
  ];
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@') ? candidate : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (loaded.createKarSession && loaded.evaluateKar && loaded.verifyKar) return loaded;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Could not load @knolo/core/kar. Build packages/core first.');
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') flags.json = true;
    else if (arg === '--auto') flags.auto = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      flags[key] = value;
      index += 1;
    } else positionals.push(arg);
  }
  return { command: positionals[0] ?? '', positionals, flags };
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`Missing --${name}`);
  return flags[name];
}

function readBytes(file) {
  return readBounded(file, KAR_CLI_MAX_IMAGE_BYTES);
}

function readJson(file) {
  return readBoundedJson(file);
}
