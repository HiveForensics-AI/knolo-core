import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRODUCE_USAGE = `Usage: knolo kar produce <rules|ontology|model|review|apply> [options]

Producers propose CEG Source. They do not write a Committed Evidence Graph.
compileCegSource remains the only writer of committed bytes.

  knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out proposals.json
  knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out generated.ceg.yaml --auto
  knolo kar produce review proposals.json
  knolo kar produce apply --proposals proposals.json --decisions decisions.json --out generated.ceg.yaml
  knolo kar produce ontology --input ontology.json --mapping mapping.json --out proposals.json [--image knowledge.knolo]
  knolo kar produce model --input model.json --out proposals.json [--image knowledge.knolo] [--domain domains/contracts]

  --auto              Write accepted deterministic output as CEG Source
  --json              Print machine-readable output

--auto does not accept model output. An existing --out file is left unchanged.
`;

const DOMAIN_USAGE = `Usage: knolo kar domain <validate|inspect|test> <domain-directory>

  knolo kar domain validate domains/contracts
  knolo kar domain inspect domains/contracts
  knolo kar domain test domains/contracts

  --json              Print machine-readable output
`;

export async function runKarProduce(command, positionals, flags) {
  if (command === 'domain') return runDomain(positionals, flags);
  return runProduce(positionals, flags);
}

async function runProduce(positionals, flags) {
  const sub = positionals[0] ?? '';
  if (!sub || sub === 'help') {
    console.log(PRODUCE_USAGE.trim());
    return;
  }
  const authoring = await loadAuthoring();
  if (sub === 'rules') return produceRules(authoring, flags);
  if (sub === 'ontology') return produceOntology(authoring, flags);
  if (sub === 'model') return produceModel(authoring, flags);
  if (sub === 'review') return reviewProposals(authoring, positionals, flags);
  if (sub === 'apply') return applyProposals(authoring, flags);
  throw new Error(`Unknown kar produce command "${sub}".\n${PRODUCE_USAGE}`);
}

async function runDomain(positionals, flags) {
  const sub = positionals[0] ?? '';
  if (!sub || sub === 'help') {
    console.log(DOMAIN_USAGE.trim());
    return;
  }
  const authoring = await loadAuthoring();
  const directory = positionals[1] ?? flags.domain;
  if (!directory) throw new Error('Missing domain directory.');
  const loaded = loadDomainDirectory(authoring, directory);
  if (!loaded.ok) return fail(flags, loaded.diagnostics);
  if (sub === 'validate') return validateDomain(authoring, loaded, flags);
  if (sub === 'inspect') return inspectDomain(authoring, loaded, flags);
  if (sub === 'test') return testDomain(authoring, loaded, flags);
  throw new Error(`Unknown kar domain command "${sub}".\n${DOMAIN_USAGE}`);
}

async function produceRules(authoring, flags) {
  const image = readBytes(required(flags, 'image'));
  const loaded = loadDomainDirectory(authoring, required(flags, 'domain'));
  if (!loaded.ok) return fail(flags, loaded.diagnostics);
  const ran = authoring.runRuleProducer({ pack: loaded.pack, image });
  if (!ran.ok) return fail(flags, ran.diagnostics);
  if (flags.auto) return writeAutoSource(authoring, flags, ran.run);
  writeRun(required(flags, 'out'), ran.run);
  if (flags.json) console.log(JSON.stringify({ ok: true, proposals: ran.run.proposals.length, domainPackRoot: ran.run.provenance.domainPackRoot }, null, 2));
  else console.log(`CEG PRODUCER RUN\nproposals        ${ran.run.proposals.length}\ndomain pack      ${ran.run.provenance.domainPackRoot}\nwrote            ${flags.out}`);
}

async function produceOntology(authoring, flags) {
  const ontology = readJson(required(flags, 'input'));
  const mapping = readJson(required(flags, 'mapping'));
  const image = flags.image ? readBytes(flags.image) : undefined;
  const ran = authoring.runOntologyProducer({ ontology, mapping, image, auto: flags.auto === true });
  if (!ran.ok) return fail(flags, ran.diagnostics);
  if (flags.auto) return writeAutoSource(authoring, flags, ran.run);
  writeRun(required(flags, 'out'), ran.run);
  if (flags.json) console.log(JSON.stringify({ ok: true, proposals: ran.run.proposals.length }, null, 2));
  else console.log(`CEG PRODUCER RUN\nproposals        ${ran.run.proposals.length}\nwrote            ${flags.out}`);
}

async function produceModel(authoring, flags) {
  if (flags.auto) throw new Error('Model output cannot be auto-accepted. Review proposals, then apply explicit decisions.');
  const output = readJson(required(flags, 'input'));
  const image = flags.image ? readBytes(flags.image) : undefined;
  let catalog;
  if (image) {
    const catalogModule = await loadCatalog();
    const opened = catalogModule.openEvidenceCatalog(image);
    if (!opened.ok) return fail(flags, opened.diagnostics);
    catalog = opened.catalog;
  }
  let domainPack;
  if (flags.domain) {
    const loaded = loadDomainDirectory(authoring, flags.domain);
    if (!loaded.ok) return fail(flags, loaded.diagnostics);
    domainPack = loaded.pack;
  }
  const ran = authoring.validateModelProposals({ output, catalog, domainPack });
  if (!ran.ok) return fail(flags, ran.diagnostics);
  writeRun(required(flags, 'out'), ran.run);
  if (flags.json) console.log(JSON.stringify({ ok: true, proposals: ran.run.proposals.length, autoAcceptModelOutput: false }, null, 2));
  else console.log(`CEG PRODUCER RUN\nproposals        ${ran.run.proposals.length}\nmodel output     PROPOSED\nwrote            ${flags.out}`);
}

function reviewProposals(authoring, positionals, flags) {
  const file = positionals[1] ?? flags.proposals;
  if (!file) throw new Error('Missing producer run path.');
  const run = readJson(file);
  const text = authoring.renderProducerReview(run);
  if (flags.json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }
  console.log(text);
}

function applyProposals(authoring, flags) {
  const run = readJson(required(flags, 'proposals'));
  const decisions = flags.decisions
    ? readJson(flags.decisions)
    : { format: 'ceg-decisions-1', decisions: [] };
  const applied = authoring.applyProducerDecisions(run, decisions);
  if (!applied.ok) return fail(flags, applied.diagnostics);
  const out = required(flags, 'out');
  writeNew(out, out.endsWith('.json') ? authoring.emitCegSourceJson(applied.source) : authoring.emitCegSourceYaml(applied.source));
  if (flags.json) console.log(JSON.stringify({ ok: true, concepts: Object.keys(applied.source.concepts).length, relations: applied.source.relations.length }, null, 2));
  else console.log(`CEG SOURCE\nconcepts         ${Object.keys(applied.source.concepts).length}\nrelations        ${applied.source.relations.length}\nwrote            ${out}`);
}

function validateDomain(authoring, loaded, flags) {
  const report = {
    ok: true,
    id: loaded.pack.id,
    version: loaded.pack.version,
    domainPackRoot: authoring.domainPackRoot(loaded.pack),
    rules: loaded.pack.rules.length,
    fixtures: loaded.fixtures.length,
    plans: Object.keys(loaded.pack.planTemplates).sort(),
  };
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(`CEG DOMAIN VALID\nid               ${report.id}\nversion          ${report.version}\nroot             ${report.domainPackRoot}`);
}

function inspectDomain(authoring, loaded, flags) {
  if (flags.json) {
    console.log(JSON.stringify({
      id: loaded.pack.id,
      version: loaded.pack.version,
      domainPackRoot: authoring.domainPackRoot(loaded.pack),
      description: loaded.pack.description ?? null,
      relations: [...loaded.pack.relations].sort(),
      conceptKinds: loaded.pack.conceptKinds.map((kind) => kind.id).sort(),
      rules: loaded.pack.rules.length,
      planTemplates: Object.keys(loaded.pack.planTemplates).sort(),
      fixtures: loaded.fixtures.length,
    }, null, 2));
    return;
  }
  console.log(authoring.inspectDomainPack(loaded.pack, loaded.fixtures.length));
}

function testDomain(authoring, loaded, flags) {
  const report = authoring.testDomainFixtures(loaded.pack, loaded.fixtures);
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(authoring.renderDomainTest(report));
  if (!report.ok || report.unmatchedRules.length > 0) process.exitCode = 1;
}

function writeAutoSource(authoring, flags, run) {
  const out = required(flags, 'out');
  const production = productionPath(out);
  writeNew(out, out.endsWith('.json') ? authoring.emitCegSourceJson(run.fragment) : authoring.emitCegSourceYaml(run.fragment));
  writeNew(production, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`CEG SOURCE\nwrote            ${out}\nproduction       ${production}`);
}

function writeRun(file, run) {
  writeNew(file, `${JSON.stringify(run, null, 2)}\n`);
}

export function loadDomainDirectory(authoring, directory) {
  const resolved = resolve(directory);
  const parsed = authoring.parseAuthoringDocument(readFileSync(path.join(resolved, 'domain.yaml'), 'utf8'));
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, diagnostics: [{ severity: 'error', code: 'CEG_DOMAIN_INVALID', path: 'domain.yaml', message: 'Domain document must be an object.' }] };
  }
  const rules = [];
  const rulesDir = path.join(resolved, 'rules');
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir).filter((entry) => /\.(ya?ml|json)$/i.test(entry)).sort()) {
      const item = authoring.parseAuthoringDocument(readFileSync(path.join(rulesDir, name), 'utf8'));
      if (!item.ok) return item;
      if (Array.isArray(item.value)) rules.push(...item.value);
      else rules.push(item.value);
    }
  }
  if (Array.isArray(value.rules)) rules.push(...value.rules);
  value.rules = rules;
  const planTemplates = value.planTemplates && typeof value.planTemplates === 'object' ? { ...value.planTemplates } : {};
  const plansDir = path.join(resolved, 'plans');
  if (existsSync(plansDir)) {
    for (const name of readdirSync(plansDir).filter((entry) => entry.endsWith('.json')).sort()) {
      planTemplates[name.replace(/\.json$/, '')] = JSON.parse(readFileSync(path.join(plansDir, name), 'utf8'));
    }
  }
  value.planTemplates = planTemplates;
  const fixtures = [];
  const fixturesDir = path.join(resolved, 'fixtures');
  if (existsSync(fixturesDir)) {
    for (const name of readdirSync(fixturesDir).filter((entry) => entry.endsWith('.json')).sort()) {
      fixtures.push(JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')));
    }
  }
  const interpreted = authoring.interpretDomainPack(value);
  if (!interpreted.ok) return interpreted;
  return { ok: true, pack: interpreted.pack, fixtures, diagnostics: interpreted.diagnostics };
}

function productionPath(file) {
  return `${file.replace(/\.(ya?ml|json)$/i, '')}.production.json`;
}

function writeNew(file, text) {
  const resolved = resolve(file);
  if (existsSync(resolved)) throw new Error(`Refusing to overwrite ${file}. Choose a new --out path.`);
  writeFileSync(resolved, text);
}

function fail(flags, diagnostics) {
  if (flags.json) console.log(JSON.stringify({ ok: false, diagnostics }, null, 2));
  else {
    for (const item of diagnostics) console.log(`${item.severity}  ${item.code}  ${item.path}  ${item.message}`);
  }
  process.exitCode = 1;
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`Missing --${name}`);
  return flags[name];
}

function resolve(file) {
  return path.resolve(process.cwd(), file);
}

function readBytes(file) {
  return readFileSync(resolve(file));
}

function readJson(file) {
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}

async function loadAuthoring() {
  const loaded = await loadFirst([
    path.resolve(__dirname, '../../core/dist/experimental/kar/authoring/index.js'),
    '@knolo/core/experimental/kar/authoring',
  ], (mod) => mod.runRuleProducer && mod.interpretDomainPack && mod.compileCegSource);
  if (!loaded) throw new Error('Could not load @knolo/core/experimental/kar/authoring. Build packages/core first.');
  return loaded;
}

async function loadCatalog() {
  const loaded = await loadFirst([
    path.resolve(__dirname, '../../core/dist/experimental/kar/authoring/catalog.js'),
  ], (mod) => mod.openEvidenceCatalog);
  if (!loaded) throw new Error('Could not load the CEG evidence catalog. Build packages/core first.');
  return loaded;
}

async function loadFirst(candidates, accept) {
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@') ? candidate : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (accept(loaded)) return loaded;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
