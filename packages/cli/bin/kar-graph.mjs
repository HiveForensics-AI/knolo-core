import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const decoder = new TextDecoder();

const GRAPH_USAGE = `Usage: knolo kar graph <command> [options]

Author, compile, and review a Committed Evidence Graph. Retrieval stays kar-1-research-1.

  knolo kar graph lint knowledge.ceg.yaml [--image knowledge.knolo] [--plan plan.json]
  knolo kar graph review knowledge.ceg.yaml [--image knowledge.knolo]
  knolo kar graph build --image knowledge.knolo --source knowledge.ceg.yaml --out knowledge.kar.json [--plan plan.json]
  knolo kar graph validate --image knowledge.knolo --graph knowledge.kar.json [--build knowledge.kar.build.json]
  knolo kar graph inspect knowledge.kar.json [--image knowledge.knolo] [--plan plan.json]
  knolo kar graph diff old.kar.json new.kar.json
  knolo kar graph check --image knowledge.knolo --graph knowledge.kar.json
  knolo kar graph rebuild --image knowledge.knolo --source knowledge.ceg.yaml --previous old.kar.json --out new.kar.json
  knolo kar graph import claim-graph --image knowledge.knolo --out imported.ceg.yaml [--claim claim.json] [--block-map map.json]
  knolo kar graph import json --input ontology.json --mapping mapping.json --out knowledge.ceg.yaml

  --json              Print machine-readable output
`;

const PACKAGE_USAGE = `Usage: knolo kar package --image knowledge.knolo --graph knowledge.kar.json --out dist/my-knowledge-kar/
       knolo kar package verify dist/my-knowledge-kar/

The directory is the distribution. The manifest pairs one Knowledge Image with one CEG.
`;

export async function runKarAuthoring(command, positionals, flags) {
  if (command === 'package') return runPackage(positionals, flags);
  return runGraph(positionals, flags);
}

async function runGraph(positionals, flags) {
  const sub = positionals[0] ?? '';
  if (!sub || sub === 'help') {
    console.log(GRAPH_USAGE.trim());
    return;
  }
  const authoring = await loadAuthoring();
  if (sub === 'lint') return lintCommand(authoring, positionals, flags);
  if (sub === 'review') return reviewCommand(authoring, positionals, flags);
  if (sub === 'build') return buildCommand(authoring, flags, false);
  if (sub === 'rebuild') return buildCommand(authoring, flags, true);
  if (sub === 'validate') return validateCommand(authoring, flags);
  if (sub === 'inspect') return inspectCommand(authoring, positionals, flags);
  if (sub === 'diff') return diffCommand(authoring, positionals, flags);
  if (sub === 'check') return checkCommand(authoring, flags);
  if (sub === 'import') return importCommand(authoring, positionals, flags);
  throw new Error(`Unknown kar graph command "${sub}".\n${GRAPH_USAGE}`);
}

async function runPackage(positionals, flags) {
  const sub = positionals[0] ?? '';
  if (sub === 'help') {
    console.log(PACKAGE_USAGE.trim());
    return;
  }
  const authoring = await loadAuthoring();
  if (sub === 'verify') return verifyPackage(authoring, positionals[1]);
  if (sub) throw new Error(`Unknown kar package command "${sub}".\n${PACKAGE_USAGE}`);
  return packageCommand(authoring, flags);
}

async function lintCommand(authoring, positionals, flags) {
  const parsed = readSource(authoring, positionals[1] ?? flags.source);
  if (!parsed.ok) return fail(flags, parsed.diagnostics);
  const catalog = await maybeCatalog(authoring, flags.image);
  if (catalog && !catalog.ok) return fail(flags, catalog.diagnostics);
  const diagnostics = authoring.lintCegSource(parsed.source, {
    catalog: catalog ? catalog.catalog : undefined,
    plan: flags.plan ? readJson(flags.plan) : undefined,
  });
  const errors = diagnostics.filter((item) => item.severity === 'error');
  if (flags.json) {
    console.log(JSON.stringify({ ok: errors.length === 0, diagnostics }, null, 2));
  } else if (diagnostics.length === 0) {
    console.log('CEG LINT\n\nno findings');
  } else {
    console.log('CEG LINT\n');
    printDiagnostics(diagnostics);
  }
  if (errors.length > 0) process.exitCode = 1;
}

async function reviewCommand(authoring, positionals, flags) {
  const parsed = readSource(authoring, positionals[1] ?? flags.source);
  if (!parsed.ok) return fail(flags, parsed.diagnostics);
  const catalog = await maybeCatalog(authoring, flags.image);
  if (catalog && !catalog.ok) return fail(flags, catalog.diagnostics);
  const review = authoring.reviewCegSource(parsed.source, catalog ? catalog.catalog : undefined);
  if (flags.json) console.log(JSON.stringify(review, null, 2));
  else console.log(authoring.renderCegReview(review));
  if (review.diagnostics.some((item) => item.severity === 'error')) process.exitCode = 1;
}

async function buildCommand(authoring, flags, rebuild) {
  const parsed = readSource(authoring, required(flags, 'source'));
  if (!parsed.ok) return fail(flags, parsed.diagnostics);
  const image = readBytes(required(flags, 'image'));
  const out = required(flags, 'out');
  const plan = flags.plan ? readJson(flags.plan) : undefined;
  const compiled = authoring.compileCegSource({ source: parsed.source, image, plan });
  if (!compiled.ok) return fail(flags, compiled.diagnostics);
  const buildFile = buildPathFor(out);
  writeFileSync(resolve(out), compiled.bytes);
  writeFileSync(resolve(buildFile), authoring.serializeCegBuild(compiled.buildInfo));
  let diff = null;
  if (rebuild) {
    if (!flags.previous) throw new Error('Missing --previous');
    diff = authoring.diffCegGraphs(readJson(flags.previous), compiled.sidecar);
  }
  const warnings = compiled.diagnostics.filter((item) => item.severity === 'warning');
  const report = {
    ok: true,
    stateRoot: compiled.sidecar.stateRoot,
    knowledgeRoot: compiled.sidecar.knowledgeRoot,
    semanticRoot: compiled.semanticRoot,
    objectRoot: compiled.sidecar.objectRoot,
    commitDigest: compiled.sidecar.commitDigest,
    nodes: compiled.sidecar.graph.nodes.length,
    relations: compiled.sidecar.graph.relations.length,
    bindings: compiled.sidecar.graph.bindings.length,
    warnings,
    output: out,
    build: buildFile,
    diff,
  };
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines = [
    rebuild ? 'CEG REBUILT' : 'CEG COMPILED',
    '',
    `Knowledge state root  ${report.stateRoot}`,
    `Knowledge root        ${report.knowledgeRoot}`,
    `Semantic root         ${report.semanticRoot}`,
    `Nodes                 ${report.nodes}`,
    `Relations             ${report.relations}`,
    `Bindings              ${report.bindings}`,
    `Warnings              ${warnings.length}`,
    `Output file           ${out}`,
    `Build record          ${buildFile}`,
  ];
  if (warnings.length > 0) {
    lines.push('');
    for (const item of warnings) lines.push(`${item.code}  ${item.message}`);
  }
  if (diff) {
    lines.push('');
    lines.push(...diffLines(diff));
  }
  console.log(lines.join('\n'));
}

async function validateCommand(authoring, flags) {
  const image = readBytes(required(flags, 'image'));
  const graph = readJson(required(flags, 'graph'));
  const checked = flags.build
    ? authoring.validateCegBuild({ image, graph, build: readJson(flags.build) })
    : authoring.checkCegFreshness({ image, graph });
  if (!checked.ok) return fail(flags, checked.diagnostics);
  const quality = authoring.inspectCegQuality(graph);
  if (!quality.ok) return fail(flags, quality.diagnostics);
  const report = {
    ok: true,
    semanticRoot: checked.semanticRoot,
    nodes: quality.quality.nodeCount,
    relations: quality.quality.relationCount,
    bindings: quality.quality.bindingCount,
  };
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log([
      'CEG VALID',
      '',
      `Semantic root  ${report.semanticRoot}`,
      `Nodes          ${report.nodes}`,
      `Relations      ${report.relations}`,
      `Bindings       ${report.bindings}`,
    ].join('\n'));
  }
}

async function inspectCommand(authoring, positionals, flags) {
  const file = positionals[1] ?? flags.graph;
  if (!file) throw new Error('Missing graph path');
  const graph = readJson(file);
  const quality = authoring.inspectCegQuality(graph);
  if (!quality.ok) return fail(flags, quality.diagnostics);
  const committed = graph.graph ?? graph;
  const bindings = Array.isArray(committed.bindings) ? committed.bindings : [];
  const relations = Array.isArray(committed.relations) ? committed.relations : [];
  const authorities = [];
  for (const binding of bindings) {
    if (Number.isInteger(binding.authority)) authorities.push(binding.authority);
  }
  const froms = bindings.map((binding) => binding.validFrom).filter((value) => typeof value === 'string').sort();
  const untils = bindings.map((binding) => binding.validUntil).filter((value) => typeof value === 'string').sort();
  const requirements = [...new Set(bindings.flatMap((binding) => binding.requirements ?? []))].sort();
  const symbols = [...new Set(relations.map((relation) => relation.relation))].sort();
  let freshness = null;
  if (flags.image) {
    freshness = authoring.checkCegFreshness({ image: readBytes(flags.image), graph });
  }
  let readiness = null;
  if (flags.plan) {
    readiness = authoring.inspectKarReadiness(graph, [readJson(flags.plan)]);
  }
  const report = {
    producer: committed.provenance?.producer ?? null,
    knowledgeRoot: quality.quality ? committed.knowledgeRoot : null,
    semanticRoot: quality.quality.semanticRoot,
    nodes: quality.quality.nodeCount,
    relations: quality.quality.relationCount,
    bindings: quality.quality.bindingCount,
    relationSymbols: symbols,
    requirements,
    authority: authorityRange(authorities),
    validity: { from: froms[0] ?? null, until: untils[untils.length - 1] ?? null },
    components: quality.quality.componentCount,
    largestComponent: quality.quality.largestComponent,
    unboundNodes: quality.quality.unboundNodes,
    image: freshness,
    readiness: readiness && readiness.ok ? readiness.readiness : readiness,
  };
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else {
    const lines = [
      'CEG INSPECT',
      '',
      `producer             ${report.producer ?? '(none)'}`,
      `knowledgeRoot        ${committed.knowledgeRoot ?? '(none)'}`,
      `semanticRoot         ${report.semanticRoot}`,
      `node count           ${report.nodes}`,
      `relation count       ${report.relations}`,
      `binding count        ${report.bindings}`,
      `relation symbols     ${symbols.join(', ') || '(none)'}`,
      `requirements         ${requirements.join(', ') || '(none)'}`,
      `authority range      ${report.authority ? `${report.authority.min}..${report.authority.max}` : '(none)'}`,
      `validity range       ${report.validity.from || report.validity.until ? `${report.validity.from ?? ''}..${report.validity.until ?? ''}` : '(none)'}`,
      `connected components ${report.components}`,
      `largest component    ${report.largestComponent}`,
      `unbound nodes        ${report.unboundNodes}`,
    ];
    if (freshness) {
      lines.push(`image binding        ${freshness.ok ? 'bound' : freshness.diagnostics.map((item) => item.code).join(', ')}`);
    }
    console.log(lines.join('\n'));
  }
  if (freshness && !freshness.ok) process.exitCode = 1;
}

function diffCommand(authoring, positionals, flags) {
  const before = positionals[1] ?? flags.old;
  const after = positionals[2] ?? flags.new;
  if (!before || !after) throw new Error('Usage: knolo kar graph diff <old.kar.json> <new.kar.json>');
  const diff = authoring.diffCegGraphs(readJson(before), readJson(after));
  if (!diff.ok) return fail(flags, diff.diagnostics);
  if (flags.json) console.log(JSON.stringify(diff, null, 2));
  else console.log(['CEG DIFF', '', ...diffLines(diff)].join('\n'));
}

function checkCommand(authoring, flags) {
  const checked = authoring.checkCegFreshness({
    image: readBytes(required(flags, 'image')),
    graph: readJson(required(flags, 'graph')),
  });
  if (!checked.ok) return fail(flags, checked.diagnostics);
  const report = { ok: true, semanticRoot: checked.semanticRoot };
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(`CEG BOUND\n\nSemantic root  ${checked.semanticRoot}`);
}

function importCommand(authoring, positionals, flags) {
  const kind = positionals[1];
  const out = required(flags, 'out');
  if (kind === 'claim-graph') return importClaim(authoring, flags, out);
  if (kind === 'json') return importJson(authoring, flags, out);
  throw new Error('Usage: knolo kar graph import <claim-graph|json> ...');
}

function importClaim(authoring, flags, out) {
  const image = readBytes(required(flags, 'image'));
  const claim = flags.claim
    ? readJson(flags.claim)
    : authoring.readImageClaimGraph(image);
  const graph = flags.claim ? { ok: true, claim } : claim;
  if (!graph.ok) return fail(flags, graph.diagnostics);
  const blockEvidence = flags['block-map'] ? readJson(flags['block-map']) : undefined;
  const imported = authoring.importClaimGraph(graph.claim, blockEvidence ? { blockEvidence } : {});
  if (!imported.ok) return fail(flags, imported.diagnostics);
  writeSource(authoring, out, imported.source);
  finishImport(flags, out, imported.diagnostics);
}

function importJson(authoring, flags, out) {
  const imported = authoring.importJsonGraph(readJson(required(flags, 'input')), readJson(required(flags, 'mapping')));
  if (!imported.ok) return fail(flags, imported.diagnostics);
  writeSource(authoring, out, imported.source);
  finishImport(flags, out, imported.diagnostics);
}

function finishImport(flags, out, diagnostics) {
  if (flags.json) console.log(JSON.stringify({ ok: true, output: out, diagnostics }, null, 2));
  else {
    console.log(`CEG IMPORTED\n\nOutput file  ${out}`);
    if (diagnostics.length > 0) {
      console.log('');
      printDiagnostics(diagnostics);
    }
  }
}

function packageCommand(authoring, flags) {
  const image = readBytes(required(flags, 'image'));
  const graphFile = required(flags, 'graph');
  const graphBytes = readBytes(graphFile);
  const graph = JSON.parse(decoder.decode(graphBytes));
  const packed = authoring.buildDistributionFiles({ image, graphBytes, graph });
  if (!packed.ok) return fail(flags, packed.diagnostics);
  const out = resolve(required(flags, 'out'));
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of Object.entries(packed.files)) {
    writeFileSync(path.join(out, name), bytes);
  }
  const report = { ok: true, output: out, manifest: packed.manifest };
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log([
      'KAR PACKAGED',
      '',
      `Output directory  ${out}`,
      `Semantic root     ${packed.manifest.kar.semanticRoot}`,
      `Knowledge root    ${packed.manifest.image.knowledgeRoot}`,
      `Image sha256      ${packed.manifest.image.sha256}`,
      `CEG sha256        ${packed.manifest.kar.sha256}`,
    ].join('\n'));
  }
}

function verifyPackage(authoring, directory) {
  if (!directory) throw new Error('Usage: knolo kar package verify <directory>');
  const dir = resolve(directory);
  const image = readBytes(path.join(dir, 'knowledge.knolo'));
  const graphBytes = readBytes(path.join(dir, 'knowledge.kar.json'));
  const manifest = readJson(path.join(dir, 'kar-manifest.json'));
  const graph = JSON.parse(decoder.decode(graphBytes));
  const loaded = authoring.loadKarBundle({ image, graph, manifest, graphBytes });
  if (!loaded.ok) return fail({ json: false }, loaded.diagnostics);
  console.log(`KAR BUNDLE VERIFIED\n\nSemantic root  ${loaded.semanticRoot}`);
}

function authorityRange(values) {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function diffLines(diff) {
  if (!diff.ok) return diff.diagnostics.map((item) => `${item.code}  ${item.message}`);
  return [
    `old SemanticRoot       ${diff.semanticRoot.before}`,
    `new SemanticRoot       ${diff.semanticRoot.after}`,
    `nodes added            ${diff.nodes.added.length}`,
    `nodes removed          ${diff.nodes.removed.length}`,
    `relations added        ${diff.relations.added.length}`,
    `relations removed      ${diff.relations.removed.length}`,
    `bindings added         ${diff.bindings.added.length}`,
    `bindings removed       ${diff.bindings.removed.length}`,
    `authority changes      ${diff.authority.length}`,
    `validity changes       ${diff.validity.length}`,
    `requirement changes    ${diff.requirements.length}`,
  ];
}

function writeSource(authoring, file, source) {
  const text = file.endsWith('.json') ? authoring.emitCegSourceJson(source) : authoring.emitCegSourceYaml(source);
  writeFileSync(resolve(file), text);
}

function readSource(authoring, file) {
  if (!file) throw new Error('Missing CEG source path');
  return authoring.parseCegSource(readFileSync(resolve(file), 'utf8'));
}

async function maybeCatalog(authoring, image) {
  if (!image) return null;
  const opened = authoring.openEvidenceCatalog
    ? authoring.openEvidenceCatalog(readBytes(image))
    : null;
  if (opened) return opened;
  const catalog = await loadCatalog();
  return catalog.openEvidenceCatalog(readBytes(image));
}

function fail(flags, diagnostics) {
  if (flags.json) console.log(JSON.stringify({ ok: false, diagnostics }, null, 2));
  else printDiagnostics(diagnostics);
  process.exitCode = 1;
}

function printDiagnostics(diagnostics) {
  for (const item of diagnostics) {
    console.log(`${item.severity}  ${item.code}  ${item.path}  ${item.message}`);
  }
}

function buildPathFor(out) {
  if (out.endsWith('.json')) return `${out.slice(0, -'.json'.length)}.build.json`;
  return `${out}.build.json`;
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
  ], (mod) => mod.compileCegSource && mod.parseCegSource);
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
