#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const api = await import(
  pathToFileURL(path.join(packageRoot, 'dist/index.js')).href
);
const core = await import('@knolo/core');
const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'build') await build(args);
  else if (command === 'inspect') await inspect(args);
  else if (command === 'verify') await verify(args);
  else if (command === 'query') await query(args);
  else if (command === 'compare') await compare(args);
  else if (command === 'evaluate') await evaluate(args);
  else usage(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function build(args) {
  const [inputPath, outputPath] = requirePaths(
    args,
    'build <input.json> <output.knolo>'
  );
  const input = normalizeInput(
    JSON.parse(await fs.readFile(inputPath, 'utf8'))
  );
  const result = api.buildReflexImageV1(input);
  await fs.writeFile(outputPath, result.image.bytes);
  print({
    outputPath,
    bytes: result.image.bytes.length,
    stateRoot: result.image.stateRoot,
    behaviorRoot: result.behaviorRoot,
  });
}

async function inspect(args) {
  const [imagePath] = requirePaths(args, 'inspect <image.knolo>');
  const bytes = new Uint8Array(await fs.readFile(imagePath));
  const image = core.openKnowledgeImageV5(bytes).materialize();
  print({
    bytes: bytes.length,
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    objects: image.objects.length,
    events: image.events.length,
    segments: image.segments.length,
  });
}

async function verify(args) {
  const [imagePath] = requirePaths(args, 'verify <image.knolo>');
  const bytes = new Uint8Array(await fs.readFile(imagePath));
  print(api.verifyReflexImageV1(bytes));
}

async function query(args) {
  const [imagePath, namespace, ...queryParts] = requirePaths(
    args,
    'query <image.knolo> <namespace> <query>'
  );
  const session = await api.openReflexSessionV1(
    new Uint8Array(await fs.readFile(imagePath)),
    { namespace }
  );
  print(api.selectReflexContextV1(session, queryParts.join(' ')));
}

async function compare(args) {
  const [imagePath, namespace, tasksPath] = requirePaths(
    args,
    'compare <image.knolo> <namespace> <tasks.json> --mock-pass'
  );
  if (!args.includes('--mock-pass') && !args.includes('--mock-fail')) {
    throw new Error(
      'compare requires explicit --mock-pass or --mock-fail for the local smoke adapter.'
    );
  }
  const session = await api.openReflexSessionV1(
    new Uint8Array(await fs.readFile(imagePath)),
    { namespace }
  );
  const tasks = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
  const failure = args.includes('--mock-fail');
  const model = {
    modelId: 'mock',
    revision: failure ? 'mock-fail-v1' : 'mock-pass-v1',
    run: async () => ({ failure }),
  };
  print(
    await api.compareReflexVariantsV1(tasks, [
      { id: 'no-pack', model },
      { id: 'reflex', session, model },
    ])
  );
}

async function evaluate(args) {
  const [imagePath, namespace, tasksPath] = requirePaths(
    args,
    'evaluate <image.knolo> <namespace> <tasks.json> --mock-pass'
  );
  if (!args.includes('--mock-pass'))
    throw new Error(
      'evaluate requires explicit --mock-pass for the local smoke adapter.'
    );
  const session = await api.openReflexSessionV1(
    new Uint8Array(await fs.readFile(imagePath)),
    { namespace }
  );
  const tasks = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
  const report = await api.evaluateReflexPolicyV1(session, tasks, {
    modelId: 'mock',
    revision: 'mock-pass-v1',
    run: async () => ({ failure: false }),
  });
  print(report);
}

function normalizeInput(input) {
  return {
    ...input,
    sources: (input.sources ?? []).map((source) => ({
      ...source,
      bytes: source.bytes
        ? Uint8Array.from(Buffer.from(source.bytes, 'base64'))
        : new TextEncoder().encode(source.text ?? ''),
    })),
  };
}

function requirePaths(args, syntax) {
  const required = syntax.match(/<[^>]+>/g)?.length ?? 0;
  const paths = args.filter((arg) => !arg.startsWith('--'));
  if (paths.length < required) usage(1, `Usage: reflex ${syntax}`);
  return paths;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}
function usage(
  code,
  message = 'Usage: reflex <build|inspect|query|evaluate> ...'
) {
  console.error(message);
  process.exit(code);
}
