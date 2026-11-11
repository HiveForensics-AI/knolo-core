import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..'
);
const coreDist = path.join(repoRoot, 'packages/core/dist/index.js');

if (!existsSync(coreDist)) {
  const build = spawnSync(
    'npm',
    ['run', 'build', '--workspace', '@knolo/core'],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const destination = await mkdtemp(path.join(os.tmpdir(), 'knolo-skill-'));
const prepared = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'examples/google_adk_python/prepare-fixture.mjs'),
    destination,
  ],
  { cwd: repoRoot, encoding: 'utf8' }
);
if (prepared.status !== 0) {
  process.stderr.write(prepared.stderr ?? prepared.stdout ?? '');
  process.exit(prepared.status ?? 1);
}

const configPath = prepared.stdout.trim().split('\n').at(-1);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const imagePath = config.mounts[0].path;
const cli = path.join(repoRoot, 'packages/cli/bin/knolo.mjs');

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    process.stderr.write(result.stdout ?? '');
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const verified = JSON.parse(runCli(['verify', imagePath]));
if (verified.verified !== true) {
  throw new Error('verify did not accept the fixture image');
}

const receiptPath = path.join(destination, 'query-result.json');
const queried = JSON.parse(
  runCli([
    'v5',
    'query',
    imagePath,
    'FROM chunk SEARCH "refunds" LIMIT 5',
    '--json',
    '--receipt',
    receiptPath,
  ])
);
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const hit = queried.hits?.[0];
if (!hit?.objectId) throw new Error('query returned no object id');
if (queried.stateRoot !== verified.stateRoot) {
  throw new Error('query stateRoot does not match verify');
}
if (receipt.resultRoot !== queried.resultRoot) {
  throw new Error('receipt resultRoot does not match the query');
}
if (!String(hit.snippet).includes('refunds')) {
  throw new Error('query snippet did not include the fixture text');
}

process.stdout.write(
  `${JSON.stringify(
    {
      verified: verified.verified,
      stateRoot: queried.stateRoot,
      resultRoot: queried.resultRoot,
      objectId: hit.objectId,
      receipt: 'integrity-check',
    },
    null,
    2
  )}\n`
);
