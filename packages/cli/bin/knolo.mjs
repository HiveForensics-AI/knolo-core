#!/usr/bin/env node
// Robust CLI that works with ESM or CJS builds and odd resolution cases.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function parseScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const quoted = value.match(/^("|')(.*)\1$/);
  if (quoted) return quoted[2];
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
        throw new Error('YAML array item found under non-array parent.');
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
      throw new Error(`Unsupported YAML line: ${line}`);
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

async function tryImport(filePath) {
  const isPathLike = filePath.startsWith('.') || filePath.startsWith('/') || /^[A-Za-z]:[\/]/.test(filePath);
  if (isPathLike) {
    try {
      const url = pathToFileURL(filePath).href;
      return await import(url);
    } catch (_) {}
  } else {
    try {
      return await import(filePath);
    } catch (_) {}
  }
  try {
    return require(filePath);
  } catch (_) {}
  return null;
}

function pickBuildExports(mod) {
  if (!mod) return null;
  const root = mod.default && typeof mod.default === 'object' ? mod.default : mod;
  const buildPack =
    typeof mod.buildPack === 'function'
      ? mod.buildPack
      : typeof root.buildPack === 'function'
        ? root.buildPack
        : typeof root === 'function'
          ? root
          : undefined;
  const validateAgentDefinition =
    typeof mod.validateAgentDefinition === 'function'
      ? mod.validateAgentDefinition
      : root.validateAgentDefinition;
  const validateAgentRegistry =
    typeof mod.validateAgentRegistry === 'function'
      ? mod.validateAgentRegistry
      : root.validateAgentRegistry;

  if (!buildPack) return null;
  return { buildPack, validateAgentDefinition, validateAgentRegistry };
}

async function loadBuildExports() {
  const pkg = await tryImport('@knolo/core');
  const pkgExports = pickBuildExports(pkg);
  if (pkgExports) return pkgExports;

  const candidates = [
    path.resolve(__dirname, '../../core/dist/index.js'),
    path.resolve(__dirname, '../../core/dist/builder.js'),
    path.resolve(__dirname, '../../core/dist/index.cjs'),
    path.resolve(__dirname, '../../core/dist/builder.cjs'),
  ];
  for (const p of candidates) {
    const mod = await tryImport(p);
    const exports = pickBuildExports(mod);
    if (exports) return exports;
  }
  throw new Error('Could not locate a buildPack function in @knolo/core or packages/core/dist');
}

function validateCliDocs(raw) {
  if (!Array.isArray(raw)) {
    throw new Error(
      'Input JSON must be an array of docs: [{ "text": "...", "id"?: "...", "heading"?: "..." }]'
    );
  }
  for (let i = 0; i < raw.length; i++) {
    const doc = raw[i];
    if (!doc || typeof doc !== 'object') {
      throw new Error(`Invalid doc at index ${i}: expected an object.`);
    }
    if (typeof doc.text !== 'string' || !doc.text.trim()) {
      throw new Error(`Invalid doc at index ${i}: "text" must be a non-empty string.`);
    }
  }
  return raw;
}

function parseArgs(argv) {
  const positional = [];
  const flags = { embeddingsPath: undefined, modelId: undefined, agentsDir: undefined };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (arg === '--embeddings') {
      flags.embeddingsPath = argv[++i];
      continue;
    }
    if (arg === '--model-id') {
      flags.modelId = argv[++i];
      continue;
    }
    if (arg === '--agents') {
      flags.agentsDir = argv[++i];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    throw new Error(`Unknown flag: ${arg}`);
  }
  return { positional, flags };
}

function parseAgentFileContent(content, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return JSON.parse(content);
  if (ext === '.yaml' || ext === '.yml') return parseSimpleYaml(content);
  throw new Error(`Unsupported agent file extension: ${filePath}`);
}

function normalizeAgentFromFile(parsed, filePath) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid agent definition in ${filePath}: expected object.`);
  }
  if ('agent' in parsed && parsed.agent && typeof parsed.agent === 'object') {
    return parsed.agent;
  }
  return parsed;
}

function loadAgentsFromDir(agentsDir, validators = {}) {
  const { validateAgentDefinition, validateAgentRegistry } = validators;
  const dirPath = path.resolve(agentsDir);
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read agents directory ${agentsDir}: ${message}`);
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ['.json', '.yaml', '.yml'].includes(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const loaded = [];
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    try {
      const content = readFileSync(fullPath, 'utf8');
      const parsed = parseAgentFileContent(content, fullPath);
      const agent = normalizeAgentFromFile(parsed, fullPath);
      if (typeof validateAgentDefinition === 'function') {
        validateAgentDefinition(agent);
      }
      loaded.push({ file, agent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load agent file ${fullPath}: ${message}`);
    }
  }

  const duplicateById = new Map();
  for (const item of loaded) {
    const key = String(item.agent?.id ?? '');
    if (!duplicateById.has(key)) duplicateById.set(key, []);
    duplicateById.get(key).push(item.file);
  }
  for (const [id, fileNames] of duplicateById.entries()) {
    if (fileNames.length > 1) {
      throw new Error(
        `Duplicate agent id "${id}" found in files: ${fileNames.sort((a, b) => a.localeCompare(b)).join(', ')}`
      );
    }
  }

  const agents = loaded
    .map((item) => item.agent)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const registry = { version: 1, agents };

  if (typeof validateAgentRegistry === 'function') {
    validateAgentRegistry(registry);
  }

  return registry;
}

function loadEmbeddingsFromJson(filePath, expectedCount) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  const vectors = Array.isArray(parsed?.embeddings) ? parsed.embeddings : parsed;
  if (!Array.isArray(vectors)) {
    throw new Error('Embeddings JSON must be either an array of vectors or { "embeddings": [...] }.');
  }
  if (vectors.length !== expectedCount) {
    throw new Error(`Embeddings length mismatch: expected ${expectedCount}, got ${vectors.length}.`);
  }

  const first = vectors[0];
  if (!Array.isArray(first) || first.length === 0) {
    throw new Error('Embeddings must contain non-empty numeric vectors.');
  }
  const dims = first.length;

  return vectors.map((entry, i) => {
    if (!Array.isArray(entry)) {
      throw new Error(`Embeddings[${i}] must be an array of numbers.`);
    }
    if (entry.length !== dims) {
      throw new Error(`Embeddings[${i}] has dims ${entry.length}, expected ${dims}.`);
    }
    const vec = new Float32Array(dims);
    for (let d = 0; d < dims; d++) {
      const value = entry[d];
      if (!Number.isFinite(value)) {
        throw new Error(`Embeddings[${i}][${d}] must be a finite number.`);
      }
      vec[d] = value;
    }
    return vec;
  });
}

function printUsage() {
  console.log(
    'Usage: knolo <input.json> [output.knolo] [--agents ./agents] [--embeddings embeddings.json --model-id model-name]'
  );
}

const { buildPack, validateAgentDefinition, validateAgentRegistry } = await loadBuildExports();
const { positional, flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printUsage();
  process.exit(0);
}

const inFile = positional[0];
const outFile = positional[1] || 'knowledge.knolo';

if (!inFile) {
  printUsage();
  process.exit(1);
}

try {
  const rawText = readFileSync(inFile, 'utf8');
  const parsed = JSON.parse(rawText);
  const docs = validateCliDocs(parsed);

  const options = {};

  if (flags.embeddingsPath || flags.modelId) {
    if (!flags.embeddingsPath || !flags.modelId) {
      throw new Error('Both --embeddings and --model-id are required when enabling semantic build output.');
    }
    const embeddings = loadEmbeddingsFromJson(flags.embeddingsPath, docs.length);
    options.semantic = {
      enabled: true,
      modelId: flags.modelId,
      embeddings,
      quantization: { type: 'int8_l2norm', perVectorScale: true },
    };
  }

  if (flags.agentsDir) {
    let dirStats;
    try {
      dirStats = statSync(flags.agentsDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Unable to access --agents path ${flags.agentsDir}: ${message}`);
    }
    if (!dirStats.isDirectory()) {
      throw new Error(`--agents path must be a directory: ${flags.agentsDir}`);
    }

    options.agents = loadAgentsFromDir(flags.agentsDir, {
      validateAgentDefinition,
      validateAgentRegistry,
    });
  }

  const bytes = await buildPack(docs, options);
  writeFileSync(outFile, Buffer.from(bytes));
  console.log(`wrote ${outFile}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`knolo: ${message}`);
  process.exit(1);
}
