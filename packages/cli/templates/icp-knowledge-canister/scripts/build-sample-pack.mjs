#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const knoloBin = process.env.KNOLO_BIN || 'knolo';
const outPath = path.join(projectDir, 'dist/knowledge.knolo');

console.log('[build-sample-pack] Building dist/knowledge.knolo');
execFileSync(knoloBin, ['icp', 'build-pack', './knowledge', '--out', './dist/knowledge.knolo'], {
  cwd: projectDir,
  stdio: 'inherit',
});

if (!existsSync(outPath)) {
  console.error(`Expected pack output at ${outPath}`);
  process.exit(1);
}

console.log('[build-sample-pack] OK');
