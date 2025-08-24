#!/usr/bin/env node

// Simple CLI wrapper around the KnoLo pack builder. Reads an input JSON
// containing an array of documents with `heading` and `text` fields and
// writes a `.knolo` binary pack. Requires that the compiled `dist` files
// exist (run `npm run build` before using). This script uses ESM syntax.

import { readFileSync, writeFileSync } from 'node:fs';
import { buildPack } from '../dist/builder.js';

async function main() {
  const [,, inputFile, outputFile = 'knowledge.knolo'] = process.argv;
  if (!inputFile) {
    console.log('Usage: knolo <input.json> [output.knolo]');
    process.exit(1);
  }
  const json = JSON.parse(readFileSync(inputFile, 'utf8'));
  if (!Array.isArray(json)) {
    console.error('Input JSON must be an array of objects');
    process.exit(1);
  }
  const bytes = await buildPack(json);
  writeFileSync(outputFile, Buffer.from(bytes));
  console.log(`wrote ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});