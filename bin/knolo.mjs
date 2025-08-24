#!/usr/bin/env node

// Simple CLI wrapper around the KnoLo pack builder. Reads an input JSON
// containing an array of documents with `heading` and `text` fields and
// writes a `.knolo` binary pack. Requires that the compiled `dist` files
// exist (run `npm run build` before using). This script uses ESM syntax.
// Robust CLI that works with ESM or CJS builds.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadBuildPack() {
  // Prefer the package index first
  const candidates = [
    path.resolve(__dirname, "../dist/index.js"),
    path.resolve(__dirname, "../dist/builder.js"),
  ];
  for (const p of candidates) {
    try {
      const m = await import(p);
      const buildPack =
        m.buildPack ??
        (m.default && (m.default.buildPack || m.default)); // CJS default export
      if (typeof buildPack === "function") return buildPack;
    } catch (_) {
      // try the next candidate
    }
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
const bytes = await buildPack(docs);
writeFileSync(outFile, Buffer.from(bytes));
console.log(`wrote ${outFile}`);
