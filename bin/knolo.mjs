#!/usr/bin/env node
// Robust CLI that works with ESM or CJS builds and odd resolution cases.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function tryImport(filePath) {
  // 1) ESM via file URL
  try {
    const url = pathToFileURL(filePath).href;
    return await import(url);
  } catch (_) {}
  // 2) CJS via require
  try {
    return require(filePath);
  } catch (_) {}
  return null;
}

function getBuildPack(mod) {
  if (!mod) return undefined;
  // Named export (ESM)
  if (typeof mod.buildPack === "function") return mod.buildPack;
  // CJS default export object: { buildPack } or function
  if (mod.default) {
    if (typeof mod.default === "function") return mod.default;
    if (typeof mod.default.buildPack === "function") return mod.default.buildPack;
  }
  // Some CJS setups export { buildPack } directly
  if (typeof mod === "function") return mod;
  if (typeof mod.buildPack === "function") return mod.buildPack;
  return undefined;
}

async function loadBuildPack() {
  const candidates = [
    path.resolve(__dirname, "../dist/index.js"),
    path.resolve(__dirname, "../dist/builder.js"),
    // Also try .cjs just in case someone built CJS
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

const buildPack = await loadBuildPack();

const inFile = process.argv[2];
const outFile = process.argv[3] || "knowledge.knolo";

if (!inFile) {
  console.log("Usage: knolo <input.json> [output.knolo]");
  process.exit(1);
}

const docs = JSON.parse(readFileSync(inFile, "utf8"));
if (!Array.isArray(docs)) {
  throw new Error("Input JSON must be an array of documents.");
}
for (const [i, d] of docs.entries()) {
  if (!d || typeof d.text !== "string") {
    throw new Error(`Invalid document at index ${i}: expected { text: string, id?: string, heading?: string }`);
  }
}
const bytes = await buildPack(docs);
writeFileSync(outFile, Buffer.from(bytes));
console.log(`wrote ${outFile}`);
