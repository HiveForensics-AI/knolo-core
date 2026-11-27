#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  evaluateEvidenceGateV1,
  explainEvidenceGateV1,
  verifyEvidenceGateV1,
} from '../dist/index.js';

function usage() {
  console.log(`Evidence Gate CLI

Usage:
  evidence-gate check --image <image.v5> --request <request.json> [--out <result.json>]
  evidence-gate explain --image <image.v5> --request <request.json> --result <result.json>

The request JSON contains principal, policy, and structured claims. The image
is supplied separately and is always verified from its bytes.`);
}

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (
      arg === '--image' ||
      arg === '--request' ||
      arg === '--result' ||
      arg === '--out'
    ) {
      const value = args[++i];
      if (!value) throw new Error(`${arg} requires a value.`);
      flags[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`--${name} is required.`);
  return path.resolve(process.cwd(), flags[name]);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readRequest(file, image) {
  const request = readJson(file);
  return { ...request, image };
}

function writeOrPrint(value, out) {
  const json = JSON.stringify(value, null, 2);
  if (out) writeFileSync(path.resolve(process.cwd(), out), `${json}\n`);
  else console.log(json);
}

export function runEvidenceGate(args) {
  const { positional, flags } = parseArgs(args);
  const command = positional[0];
  if (!command || command === 'help' || command === '--help')
    return { help: true };
  if (command !== 'check' && command !== 'explain')
    throw new Error(`Unknown command: ${command}.`);
  const image = Uint8Array.from(readFileSync(required(flags, 'image')));
  const request = readRequest(required(flags, 'request'), image);
  if (command === 'check') {
    return { value: evaluateEvidenceGateV1(request), out: flags.out };
  }
  const result = readJson(required(flags, 'result'));
  verifyEvidenceGateV1(result, request);
  return { value: explainEvidenceGateV1(result, request), out: flags.out };
}

async function main() {
  const output = runEvidenceGate(process.argv.slice(2));
  if (output.help) usage();
  else writeOrPrint(output.value, output.out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      `evidence-gate: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
