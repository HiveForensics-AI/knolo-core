#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(exampleDir, '../..');
const cliPath = path.join(repoRoot, 'packages/cli/bin/knolo.mjs');
const outPath = path.join(exampleDir, 'dist/knowledge.knolo');

if (!existsSync(cliPath)) {
  console.error(`knolo CLI not found at ${cliPath}`);
  process.exit(1);
}

console.log('[build-sample-pack] Building @knolo/core');
execFileSync('npm', ['run', 'build', '--workspace', '@knolo/core'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('[build-sample-pack] Building dist/knowledge.knolo');
execFileSync(process.execPath, [cliPath, 'build'], {
  cwd: exampleDir,
  stdio: 'inherit',
});

if (!existsSync(outPath)) {
  console.error(`Expected pack output at ${outPath}`);
  process.exit(1);
}

console.log('[build-sample-pack] OK');
