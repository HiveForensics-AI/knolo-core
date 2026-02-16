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

const buildPack = await loadBuildPack();

const inFile = process.argv[2];
const outFile = process.argv[3] || "knowledge.knolo";

if (!inFile) {
  console.log("Usage: knolo <input.json> [output.knolo]");
  process.exit(1);
}

try {
  const rawText = readFileSync(inFile, "utf8");
  const parsed = JSON.parse(rawText);
  const docs = validateCliDocs(parsed);
  const bytes = await buildPack(docs);
  writeFileSync(outFile, Buffer.from(bytes));
  console.log(`wrote ${outFile}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`knolo: ${message}`);
  process.exit(1);
}
