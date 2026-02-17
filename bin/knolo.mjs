#!/usr/bin/env node
// Robust CLI that works with ESM or CJS builds and odd resolution cases.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function tryImport(filePath) {
  try {
    const url = pathToFileURL(filePath).href;
    return await import(url);
  } catch (_) {}
  try {
    return require(filePath);
  } catch (_) {}
  return null;
}

function getBuildPack(mod) {
  if (!mod) return undefined;
  if (typeof mod.buildPack === "function") return mod.buildPack;
  if (mod.default) {
    if (typeof mod.default === "function") return mod.default;
    if (typeof mod.default.buildPack === "function") return mod.default.buildPack;
  }
  if (typeof mod === "function") return mod;
  if (typeof mod.buildPack === "function") return mod.buildPack;
  return undefined;
}

async function loadBuildPack() {
  const candidates = [
    path.resolve(__dirname, "../dist/index.js"),
    path.resolve(__dirname, "../dist/builder.js"),
    path.resolve(__dirname, "../dist/index.cjs"),
    path.resolve(__dirname, "../dist/builder.cjs"),
  ];
  for (const p of candidates) {
    const mod = await tryImport(p);
    const buildPack = getBuildPack(mod);
    if (buildPack) return buildPack;
  }
  throw new Error("Could not locate a buildPack function in dist/");
}

function validateCliDocs(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('Input JSON must be an array of docs: [{ "text": "...", "id"?: "...", "heading"?: "..." }]');
  }
  for (let i = 0; i < raw.length; i++) {
    const doc = raw[i];
    if (!doc || typeof doc !== "object") {
      throw new Error(`Invalid doc at index ${i}: expected an object.`);
    }
    if (typeof doc.text !== "string" || !doc.text.trim()) {
      throw new Error(`Invalid doc at index ${i}: "text" must be a non-empty string.`);
    }
  }
  return raw;
}

function parseArgs(argv) {
  const positional = [];
  const flags = { embeddingsPath: undefined, modelId: undefined };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--embeddings") {
      flags.embeddingsPath = argv[++i];
      continue;
    }
    if (arg === "--model-id") {
      flags.modelId = argv[++i];
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    throw new Error(`Unknown flag: ${arg}`);
  }
  return { positional, flags };
}

function loadEmbeddingsFromJson(filePath, expectedCount) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  const vectors = Array.isArray(parsed?.embeddings) ? parsed.embeddings : parsed;
  if (!Array.isArray(vectors)) {
    throw new Error('Embeddings JSON must be either an array of vectors or { "embeddings": [...] }.');
  }
  if (vectors.length !== expectedCount) {
    throw new Error(`Embeddings length mismatch: expected ${expectedCount}, got ${vectors.length}.`);
  }

  const first = vectors[0];
  if (!Array.isArray(first) || first.length === 0) {
    throw new Error("Embeddings must contain non-empty numeric vectors.");
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
  console.log("Usage: knolo <input.json> [output.knolo] [--embeddings embeddings.json --model-id model-name]");
}

const buildPack = await loadBuildPack();
const { positional, flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printUsage();
  process.exit(0);
}

const inFile = positional[0];
const outFile = positional[1] || "knowledge.knolo";

if (!inFile) {
  printUsage();
  process.exit(1);
}

try {
  const rawText = readFileSync(inFile, "utf8");
  const parsed = JSON.parse(rawText);
  const docs = validateCliDocs(parsed);

  let options;
  if (flags.embeddingsPath || flags.modelId) {
    if (!flags.embeddingsPath || !flags.modelId) {
      throw new Error("Both --embeddings and --model-id are required when enabling semantic build output.");
    }
    const embeddings = loadEmbeddingsFromJson(flags.embeddingsPath, docs.length);
    options = {
      semantic: {
        enabled: true,
        modelId: flags.modelId,
        embeddings,
        quantization: { type: "int8_l2norm", perVectorScale: true },
      },
    };
  }

  const bytes = await buildPack(docs, options);
  writeFileSync(outFile, Buffer.from(bytes));
  console.log(`wrote ${outFile}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`knolo: ${message}`);
  process.exit(1);
}
