#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const CONFIG_FILE = 'knolo.config.json';
const DEFAULT_CONFIG = {
  version: 1,
  sources: [{ name: 'docs', path: './docs' }],
  output: { path: './dist/knowledge.knolo' },
  query: { topK: 5 },
};
const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SUBCOMMANDS = new Set(['init', 'add', 'build', 'query', 'dev']);

function createError(message) {
  return new Error(message);
}

async function tryImport(filePath) {
  try {
    if (filePath.startsWith('.') || filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
      return await import(pathToFileURL(filePath).href);
    }
    return await import(filePath);
  } catch {}
  try {
    return require(filePath);
  } catch {}
  return null;
}

async function loadCore() {
  const candidates = ['@knolo/core', path.resolve(__dirname, '../../core/dist/index.js')];
  for (const candidate of candidates) {
    const mod = await tryImport(candidate);
    if (mod?.buildPack && mod?.mountPack && mod?.query) return mod;
    if (mod?.default?.buildPack && mod?.default?.mountPack && mod?.default?.query) return mod.default;
  }
  throw createError('Could not load @knolo/core. Build packages/core first (npm run build --workspace @knolo/core).');
}

function printRootHelp() {
  console.log(`KnoLo CLI

Usage:
  knolo <command> [options]
  knolo <input.json> [output.knolo] [--agents ./agents] [--embeddings embeddings.json --model-id model]

Commands:
  init                    Initialize knolo.config.json and starter docs
  add <name> <path>       Add or update a source entry in config
  build                   Build a .knolo pack from configured sources
  query <question>        Query a built pack and print top hits
  dev                     Watch config/sources and rebuild on change

Global options:
  --debug                 Print stack traces for errors
  -h, --help              Show help

Run "knolo <command> --help" for command details.`);
}

function printCommandHelp(command) {
  const help = {
    init: 'Usage: knolo init',
    add: 'Usage: knolo add <name> <path>',
    build: 'Usage: knolo build',
    query: 'Usage: knolo query <question> [--pack <path>] [--k <number>] [--json]',
    dev: 'Usage: knolo dev',
  };
  console.log(help[command] ?? 'Unknown command.');
}

function parseArgv(argv) {
  const args = [...argv];
  const global = { debug: false };
  while (args[0] === '--debug') {
    global.debug = true;
    args.shift();
  }
  if (args[0] === '--help' || args[0] === '-h') return { global, command: 'help', commandArgs: [] };
  return { global, command: args[0] || 'help', commandArgs: args.slice(1) };
}

function readConfig(configPath = path.resolve(process.cwd(), CONFIG_FILE)) {
  if (!existsSync(configPath)) {
    throw createError(`Missing config file at ${path.relative(process.cwd(), configPath)}. Run "knolo init" first.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw createError(`Invalid JSON in ${CONFIG_FILE}: ${error.message}`);
  }
  validateConfig(parsed);
  return parsed;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw createError(`${CONFIG_FILE} must be a JSON object.`);
  if (config.version !== 1) throw createError(`${CONFIG_FILE} must include "version": 1.`);
  if (!Array.isArray(config.sources)) throw createError(`${CONFIG_FILE} must include a "sources" array.`);
  for (const [i, s] of config.sources.entries()) {
    if (!s?.name || typeof s.name !== 'string') throw createError(`sources[${i}].name must be a string.`);
    if (!s?.path || typeof s.path !== 'string') throw createError(`sources[${i}].path must be a string.`);
  }
  if (!config.output?.path || typeof config.output.path !== 'string') {
    throw createError(`${CONFIG_FILE} must include output.path.`);
  }
}

function writeConfig(config) {
  writeFileSync(path.resolve(process.cwd(), CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
}

async function cmdInit() {
  const cwd = process.cwd();
  const configPath = path.join(cwd, CONFIG_FILE);
  const docsDir = path.join(cwd, 'docs');
  const samplePath = path.join(docsDir, 'hello.md');

  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    console.log(`✔ created ${CONFIG_FILE}`);
  } else {
    console.log(`• kept existing ${CONFIG_FILE}`);
  }

  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
    console.log('✔ created docs/');
  } else {
    console.log('• kept existing docs/');
  }

  const visibleEntries = readdirSync(docsDir).filter((name) => !name.startsWith('.'));
  if (visibleEntries.length === 0 && !existsSync(samplePath)) {
    writeFileSync(samplePath, '# Hello from KnoLo\n\nThis is a starter document for KnoLo CLI demos.\n', 'utf8');
    console.log('✔ created docs/hello.md');
  } else {
    console.log('• did not create sample doc because docs/ is not empty');
  }
}

async function cmdAdd(args) {
  const [name, sourcePath] = args;
  if (!name || !sourcePath) throw createError('Usage: knolo add <name> <path>');

  const resolved = path.resolve(process.cwd(), sourcePath);
  if (!existsSync(resolved)) throw createError(`Source path does not exist: ${sourcePath}`);

  const config = readConfig();
  const normalized = sourcePath.startsWith('.') || path.isAbsolute(sourcePath) ? sourcePath : `./${sourcePath}`;
  const existing = config.sources.find((s) => s.name === name);
  if (existing) {
    existing.path = normalized;
    console.log(`✔ updated source "${name}" -> ${normalized}`);
  } else {
    config.sources.push({ name, path: normalized });
    console.log(`✔ added source "${name}" -> ${normalized}`);
  }
  writeConfig(config);
  console.log(`✔ wrote ${CONFIG_FILE}`);
}

async function walkDir(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walkDir(full)));
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

async function collectSourceFiles(sources) {
  const files = [];
  for (const source of sources) {
    const resolved = path.resolve(process.cwd(), source.path);
    if (!existsSync(resolved)) throw createError(`Configured source "${source.name}" not found at ${source.path}.`);
    const stats = await fs.lstat(resolved);
    if (stats.isSymbolicLink()) continue;
    if (stats.isFile()) {
      if (SUPPORTED_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
        files.push({ sourceName: source.name, absolutePath: resolved });
      }
    } else if (stats.isDirectory()) {
      for (const file of await walkDir(resolved)) files.push({ sourceName: source.name, absolutePath: file });
    } else {
      throw createError(`Configured source "${source.name}" must be a file or directory.`);
    }
  }
  files.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));
  return files;
}

async function buildFromConfig(core, { silent = false } = {}) {
  const start = Date.now();
  const config = readConfig();
  const files = await collectSourceFiles(config.sources);
  if (files.length === 0) throw createError('No supported files found (.md, .txt, .json).');

  const docs = files.map((f) => {
    const rel = path.relative(process.cwd(), f.absolutePath).replace(/\\/g, '/');
    return {
      id: rel,
      heading: path.basename(rel),
      namespace: f.sourceName,
      text: readFileSync(f.absolutePath, 'utf8'),
    };
  });

  const bytes = await core.buildPack(docs);
  const outPath = path.resolve(process.cwd(), config.output.path);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(bytes));

  if (!silent) {
    console.log(`✔ indexed ${files.length} files`);
    console.log(`✔ wrote ${path.relative(process.cwd(), outPath)}`);
    console.log(`✔ build completed in ${Date.now() - start}ms`);
  }
  return { config, outPath };
}

async function cmdBuild(core) {
  await buildFromConfig(core);
}

function parseQueryArgs(args) {
  const opts = { json: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--pack') opts.pack = args[++i];
    else if (arg === '--k') opts.k = args[++i];
    else if (arg.startsWith('--')) throw createError(`Unknown flag for query: ${arg}`);
    else positional.push(arg);
  }
  return { positional, opts };
}

async function cmdQuery(core, args) {
  const { positional, opts } = parseQueryArgs(args);
  const question = positional.join(' ').trim();
  if (!question) throw createError('Usage: knolo query <question> [--pack <path>] [--k <number>] [--json]');

  const config = existsSync(path.resolve(process.cwd(), CONFIG_FILE)) ? readConfig() : DEFAULT_CONFIG;
  const packPath = path.resolve(process.cwd(), opts.pack || config.output.path);
  if (!existsSync(packPath)) throw createError(`Pack file not found at ${path.relative(process.cwd(), packPath)}.`);

  const topK = opts.k !== undefined ? Number(opts.k) : (config.query?.topK ?? 5);
  if (!Number.isInteger(topK) || topK <= 0) throw createError('--k must be a positive integer.');

  const kb = await core.mountPack({ src: packPath });
  const hits = core.query(kb, question, { topK }).map((hit) => ({
    title: kb.headings?.[hit.blockId] || hit.source || `Block ${hit.blockId}`,
    source: hit.source || kb.docIds?.[hit.blockId] || 'unknown',
    score: Number(hit.score.toFixed(4)),
    snippet: hit.text.replace(/\s+/g, ' ').slice(0, 200),
  }));

  if (opts.json) {
    const patch = core.makeContextPatch(
      hits.map((h, i) => ({ blockId: i, score: h.score, text: h.snippet, source: h.source })),
      { budget: 'small' }
    );
    console.log(JSON.stringify({ question, packPath, topK, hits, contextPatch: patch }, null, 2));
    return;
  }

  if (!hits.length) {
    console.log('No hits found.');
    return;
  }
  console.log(`Top ${hits.length} hit(s):`);
  hits.forEach((hit, i) => {
    console.log(`\n${i + 1}. ${hit.title}`);
    console.log(`   source: ${hit.source}`);
    console.log(`   score: ${hit.score}`);
    console.log(`   snippet: ${hit.snippet}`);
  });
}

function listDirectoriesRecursively(root) {
  const dirs = [root];
  for (let i = 0; i < dirs.length; i++) {
    let entries = [];
    try {
      entries = readdirSync(dirs[i], { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      dirs.push(path.join(dirs[i], entry.name));
    }
  }
  return dirs;
}

async function cmdDev(core) {
  await buildFromConfig(core);
  console.log('Watching for changes... (Ctrl+C to stop)');

  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        console.log('\n↻ change detected, rebuilding...');
        await buildFromConfig(core);
      } catch (error) {
        console.error(`✖ rebuild failed: ${error.message}`);
      }
    }, 250);
  };

  const closers = [];
  const configWatcher = watch(path.resolve(process.cwd(), CONFIG_FILE), schedule);
  closers.push(() => configWatcher.close());

  const config = readConfig();
  for (const source of config.sources) {
    const resolved = path.resolve(process.cwd(), source.path);
    if (!existsSync(resolved)) continue;
    const stats = statSync(resolved);
    if (stats.isFile()) {
      const w = watch(resolved, schedule);
      closers.push(() => w.close());
    } else if (stats.isDirectory()) {
      for (const dir of listDirectoriesRecursively(resolved)) {
        const w = watch(dir, schedule);
        closers.push(() => w.close());
      }
    }
  }

  process.on('SIGINT', () => {
    for (const close of closers) close();
    process.exit(0);
  });

  await new Promise(() => {});
}

function parseScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseSimpleYaml(content) {
  const lines = content
    .split(/\n/)
    .map((line) => line.replace(/\r$/, ''))
    .map((line) => line.replace(/\t/g, '  ').replace(/\s+#.*$/, ''));

  const root = {};
  const stack = [{ indent: -1, value: root }];

  const nextMeaningfulLine = (from) => {
    for (let i = from + 1; i < lines.length; i++) {
      if (lines[i].trim()) return lines[i].trim();
    }
    return '';
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;

    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) {
        throw createError('YAML array item found under non-array parent.');
      }

      const body = line.slice(2).trim();
      const pair = body.match(/^([^:]+):(.*)$/);
      if (!pair) {
        parent.push(parseScalar(body));
        continue;
      }

      const obj = {};
      const key = pair[1].trim();
      const rhs = pair[2].trim();
      if (rhs) {
        obj[key] = parseScalar(rhs);
      } else {
        const next = nextMeaningfulLine(i);
        obj[key] = next.startsWith('- ') ? [] : {};
        stack.push({ indent, value: obj[key] });
      }
      parent.push(obj);
      continue;
    }

    const pair = line.match(/^([^:]+):(.*)$/);
    if (!pair) {
      throw createError(`Unsupported YAML line: ${line}`);
    }

    const key = pair[1].trim();
    const rhs = pair[2].trim();
    if (Array.isArray(parent)) {
      const obj = {};
      parent.push(obj);
      if (rhs) {
        obj[key] = parseScalar(rhs);
      } else {
        const next = nextMeaningfulLine(i);
        obj[key] = next.startsWith('- ') ? [] : {};
        stack.push({ indent, value: obj[key] });
      }
      continue;
    }

    if (rhs) {
      parent[key] = parseScalar(rhs);
    } else {
      const next = nextMeaningfulLine(i);
      parent[key] = next.startsWith('- ') ? [] : {};
      stack.push({ indent, value: parent[key] });
    }
  }

  return root;
}

function parseAgentFileContent(content, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return JSON.parse(content);
  if (ext === '.yaml' || ext === '.yml') return parseSimpleYaml(content);
  throw createError(`Unsupported agent file extension: ${filePath}`);
}

function loadAgentsFromDir(agentsDir, core) {
  const entries = readdirSync(path.resolve(agentsDir), { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => ['.json', '.yaml', '.yml'].includes(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const loaded = entries.map((file) => {
    const full = path.join(path.resolve(agentsDir), file);
    const parsed = parseAgentFileContent(readFileSync(full, 'utf8'), full);
    const agent = parsed?.agent && typeof parsed.agent === 'object' ? parsed.agent : parsed;
    if (typeof core.validateAgentDefinition === 'function') core.validateAgentDefinition(agent);
    return { file, agent };
  });

  const dupes = new Map();
  for (const item of loaded) {
    const id = String(item.agent?.id ?? '');
    if (!dupes.has(id)) dupes.set(id, []);
    dupes.get(id).push(item.file);
  }
  for (const [id, files] of dupes.entries()) {
    if (files.length > 1) {
      throw createError(`Duplicate agent id "${id}" found in files: ${files.sort((a, b) => a.localeCompare(b)).join(', ')}`);
    }
  }

  const agents = loaded.map((x) => x.agent).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const registry = { version: 1, agents };
  if (typeof core.validateAgentRegistry === 'function') core.validateAgentRegistry(registry);
  return registry;
}

function loadEmbeddingsFromJson(filePath, expectedCount) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  const vectors = Array.isArray(parsed?.embeddings) ? parsed.embeddings : parsed;
  if (!Array.isArray(vectors)) throw createError('Embeddings JSON must be an array or { embeddings: [...] }.');
  if (vectors.length !== expectedCount) throw createError(`Embeddings length mismatch: expected ${expectedCount}, got ${vectors.length}.`);
  return vectors.map((entry, i) => {
    if (!Array.isArray(entry)) throw createError(`Embeddings[${i}] must be an array.`);
    const vec = new Float32Array(entry.length);
    for (let d = 0; d < entry.length; d++) {
      if (!Number.isFinite(entry[d])) throw createError(`Embeddings[${i}][${d}] must be numeric.`);
      vec[d] = entry[d];
    }
    return vec;
  });
}

function parseDirectModeArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--embeddings') flags.embeddingsPath = args[++i];
    else if (arg === '--model-id') flags.modelId = args[++i];
    else if (arg === '--agents') flags.agentsDir = args[++i];
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) throw createError(`Unknown flag: ${arg}`);
    else positional.push(arg);
  }
  return { positional, flags };
}

async function runDirectMode(core, firstArg, restArgs) {
  const { positional, flags } = parseDirectModeArgs([firstArg, ...restArgs]);
  if (flags.help) {
    console.log('Usage: knolo <input.json> [output.knolo] [--agents ./agents] [--embeddings embeddings.json --model-id model]');
    return;
  }

  const inFile = positional[0];
  const outFile = positional[1] || 'knowledge.knolo';
  if (!inFile) throw createError('Usage: knolo <input.json> [output.knolo]');

  const docs = JSON.parse(readFileSync(path.resolve(process.cwd(), inFile), 'utf8'));
  if (!Array.isArray(docs)) throw createError('Input JSON must be an array of docs.');

  const options = {};
  if (flags.embeddingsPath || flags.modelId) {
    if (!flags.embeddingsPath || !flags.modelId) throw createError('Both --embeddings and --model-id are required together.');
    options.semantic = {
      enabled: true,
      modelId: flags.modelId,
      embeddings: loadEmbeddingsFromJson(flags.embeddingsPath, docs.length),
      quantization: { type: 'int8_l2norm', perVectorScale: true },
    };
  }
  if (flags.agentsDir) {
    options.agents = loadAgentsFromDir(flags.agentsDir, core);
  }

  const bytes = await core.buildPack(docs, options);
  writeFileSync(path.resolve(process.cwd(), outFile), Buffer.from(bytes));
  console.log(`✔ wrote ${outFile}`);
}

async function main() {
  const { global, command, commandArgs } = parseArgv(process.argv.slice(2));
  try {
    if (command === 'help') return printRootHelp();

    const core = await loadCore();

    if (SUBCOMMANDS.has(command)) {
      if (commandArgs.includes('--help') || commandArgs.includes('-h')) return printCommandHelp(command);
      if (command === 'init') return await cmdInit();
      if (command === 'add') return await cmdAdd(commandArgs);
      if (command === 'build') return await cmdBuild(core);
      if (command === 'query') return await cmdQuery(core, commandArgs);
      if (command === 'dev') return await cmdDev(core);
    }

    if (command.startsWith('-')) throw createError(`Unknown option: ${command}`);
    return await runDirectMode(core, command, commandArgs);
  } catch (error) {
    console.error(`knolo: ${error instanceof Error ? error.message : String(error)}`);
    if (global.debug && error instanceof Error && error.stack) console.error(error.stack);
    process.exit(1);
  }
}

await main();
