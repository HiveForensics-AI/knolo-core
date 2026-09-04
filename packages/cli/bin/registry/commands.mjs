import { copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { registryApiUrl, resolveRegistryUrl } from './config.mjs';
import { downloadBlobToTemp, installCachedArtifact, readArtifact } from './artifacts.mjs';
import { RegistryError } from './errors.mjs';
import { getJson } from './http.mjs';
import { cachePath, upsertLockfile, validateLockfileUpdate } from './lockfile.mjs';
import { validatePackManifest } from './manifest.mjs';
import { parsePackName, parsePackSpec } from './specs.mjs';
import { loadCredentials, promptForToken, removeCredentials, saveCredentials, validateToken } from './credentials.mjs';

const PACK_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export async function runHubSearch(args, { env = process.env, fetchImpl = globalThis.fetch, print = console.log } = {}) {
  const { query, flags } = parseSearchArgs(args);
  const registry = resolveRegistryUrl({ value: flags.registry, env });
  const url = registryApiUrl(registry, ['packs'], {
    q: query,
    format: flags.format,
    license: flags.license,
    official: flags.official ? 'true' : undefined,
    agents: flags.agents ? 'true' : undefined,
  });
  const body = await getJson(url, { fetchImpl });
  validatePacksResponse(body);

  if (flags.json) print(JSON.stringify(body, null, 2));
  else print(renderSearchTable(body.packs));

  return { registry, url: String(url), body };
}

export async function runHubInfo(args, { env = process.env, fetchImpl = globalThis.fetch, print = console.log } = {}) {
  const { positional, flags } = parseInfoArgs(args);
  const pack = parsePackName(positional[0]);
  const registry = resolveRegistryUrl({ value: flags.registry, env });
  const url = registryApiUrl(registry, ['packs', pack.publisher, pack.slug]);
  const body = await getJson(url, { fetchImpl });
  validatePackInfoResponse(body);

  if (flags.json) print(JSON.stringify(body, null, 2));
  else print(renderPackInfo(body));

  return { registry, url: String(url), body };
}

export async function runHubAdd(args, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  core,
  cwd = process.cwd(),
  homeDir,
  print = console.log,
  warn = console.error,
} = {}) {
  const { spec, flags } = parseAddArgs(args);
  if (!core) throw new Error('Could not load @knolo/core for Hub artifact validation.');
  const registry = resolveRegistryUrl({ value: flags.registry, env });
  const manifestUrl = registryApiUrl(registry, ['packs', spec.publisher, spec.slug, spec.version]);

  let manifest;
  let yanked = false;
  try {
    const body = await getJson(manifestUrl, { fetchImpl });
    manifest = validatePackManifest(body, { expectedName: spec.name, requestedVersion: spec.version });
  } catch (error) {
    if (error instanceof RegistryError && (error.status === 404 || error.code === 'not_found')) {
      throw new Error('pack version not found');
    }
    if (error instanceof RegistryError && (error.status === 410 || error.code === 'yanked')) {
      manifest = validatePackManifest(error.body, { expectedName: spec.name, requestedVersion: spec.version });
      yanked = true;
    } else {
      throw error;
    }
  }

  if (manifest.yanked) yanked = true;
  if (yanked && !flags.force) throw new Error('version yanked; use --force to download yanked bytes');
  if (yanked) warn(`warning: downloading yanked version ${manifest.name}@${manifest.version}`);
  if (!manifest.url) throw new Error('artifact bytes are not stored yet');
  if (!PACK_SHA256_PATTERN.test(manifest.sha256)) throw new Error('manifest sha256 is invalid');

  const artifactHome = homeDir || homedir();
  await validateLockfileUpdate({ cwd, registry, manifest, force: flags.force });
  const finalCachePath = cachePath(artifactHome, manifest.sha256);
  const tempDir = path.dirname(finalCachePath);
  const download = await downloadBlobToTemp(manifest.url, {
    tempDir,
    expectedSize: manifest.sizeBytes,
    fetchImpl,
  });
  let installed = false;
  try {
    if (download.sha256 !== manifest.sha256) {
      throw new Error(`artifact sha256 mismatch: expected ${manifest.sha256}, got ${download.sha256}`);
    }
    const bytes = await readArtifact(download.tempPath);
    const validation = await validateKnowledgeImage(core, bytes);
    if (manifest.format && String(manifest.format).toUpperCase() !== validation.format) {
      throw new Error(`artifact format mismatch: manifest=${manifest.format}, bytes=${validation.format}`);
    }
    if (manifest.stateRoot !== undefined && manifest.stateRoot !== validation.stateRoot) {
      throw new Error(`artifact stateRoot mismatch: expected ${manifest.stateRoot}, got ${validation.stateRoot || 'none'}`);
    }
    const cache = await installCachedArtifact(download.tempPath, finalCachePath);
    installed = true;
    const lock = await upsertLockfile({ cwd, registry, manifest, force: flags.force });
    let outputPath = cache;
    if (flags.out) {
      outputPath = await copyArtifact(cache, flags.out, cwd);
    }
    const result = { ...manifest, path: outputPath, lockfile: lock.path };
    if (flags.json) print(JSON.stringify(result, null, 2));
    else {
      print(`added ${manifest.name}@${manifest.version}`);
      print(`sha256 ${manifest.sha256}`);
      print(`url    ${manifest.url}`);
      print(`path   ${outputPath}`);
    }
    return result;
  } finally {
    if (!installed) await unlinkIfPresent(download.tempPath);
  }
}

export async function runHubLogin(args, {
  env = process.env,
  homeDir,
  input = process.stdin,
  output = process.stderr,
  print = console.log,
} = {}) {
  const { flags } = parseLoginArgs(args);
  const registry = resolveRegistryUrl({ value: flags.registry, env });
  print(`Create a token at ${registry}/dashboard/tokens (Sign in with GitHub).`);
  const token = (flags.token ?? await promptForToken({ input, output, forceStdin: flags.stdin })).trim();
  validateToken(token);
  const saved = await saveCredentials({ registry, token, env, homeDir });
  print(`logged in to ${saved.registry}`);
  print(`token ${saved.prefix}`);
  return saved;
}

export async function runHubWhoami(args, { env = process.env, homeDir, print = console.log } = {}) {
  if (args.length) throw new Error('Usage: knolo whoami');
  const credentials = await loadCredentials({ env, homeDir });
  print(`registry ${credentials.registry}`);
  print(`token    ${credentials.prefix}`);
  return { registry: credentials.registry, prefix: credentials.prefix };
}

export async function runHubLogout(args, { env = process.env, homeDir, print = console.log } = {}) {
  if (args.length) throw new Error('Usage: knolo logout');
  const result = await removeCredentials({ env, homeDir });
  print(result.removed ? 'logged out' : 'not logged in');
  return result;
}

export function runHubPublishStub() {
  throw new Error('Hub write APIs do not accept CLI tokens yet');
}

export function parseAddArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force' || arg === '--json') {
      flags[arg.slice(2)] = true;
      continue;
    }
    if (['--out', '--registry'].includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      flags[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown flag for add: ${arg}`);
    positional.push(arg);
  }
  if (positional.length !== 1) throw new Error('Usage: knolo add <publisher>/<slug>[@<version>] [--out <path>] [--force] [--json] [--registry <url>]');
  return { spec: parsePackSpec(positional[0]), flags };
}

export function parseLoginArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stdin') {
      flags.stdin = true;
      continue;
    }
    if (arg === '--token' || arg === '--registry') {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      flags[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown flag for login: ${arg}`);
    throw new Error('Usage: knolo login [--token kno_…] [--stdin] [--registry <url>]');
  }
  return { flags };
}

export function isHubAddInvocation(args) {
  if (!args[0] || args[0].startsWith('--')) return false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--out', '--registry'].includes(arg)) {
      i += 1;
      continue;
    }
    if (arg === '--force' || arg === '--json') continue;
    if (arg.startsWith('--')) return false;
    positional.push(arg);
  }
  if (positional.length !== 1) return false;
  try {
    parsePackSpec(positional[0]);
    return true;
  } catch {
    return false;
  }
}

export function parseSearchArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' || arg === '--official' || arg === '--agents') {
      flags[arg.slice(2)] = true;
      continue;
    }
    if (['--format', '--license', '--registry'].includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      flags[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown flag for search: ${arg}`);
    positional.push(arg);
  }

  const query = positional.join(' ').trim();
  if (!query) throw new Error('Usage: knolo search <query> [--format V4|V5] [--license <id>] [--official] [--agents] [--json] [--registry <url>]');
  if (flags.format && !['V4', 'V5'].includes(String(flags.format).toUpperCase())) {
    throw new Error('--format must be V4 or V5.');
  }
  if (flags.format) flags.format = String(flags.format).toUpperCase();
  return { query, flags };
}

export function parseInfoArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--registry') {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error('Missing value for --registry');
      flags.registry = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown flag for info: ${arg}`);
    positional.push(arg);
  }
  if (positional.length !== 1) throw new Error('Usage: knolo info <publisher>/<slug> [--json] [--registry <url>]');
  return { positional, flags };
}

function validatePacksResponse(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.packs)) {
    throw new Error('Registry returned an invalid packs response.');
  }
}

function validatePackInfoResponse(body) {
  if (!body || typeof body !== 'object' || typeof body.name !== 'string' || !body.pack || typeof body.pack !== 'object') {
    throw new Error('Registry returned an invalid pack response.');
  }
}

async function validateKnowledgeImage(core, bytes) {
  if (core.isKnowledgeImageV5?.(bytes)) {
    try {
      const verification = core.verifyKnowledgeImageV5(bytes);
      return { format: 'V5', stateRoot: verification.stateRoot };
    } catch (error) {
      throw new Error(`invalid V5 Knowledge Image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (core.isPackV4?.(buffer)) {
    try {
      await core.mountPack({ src: bytes });
      return { format: 'V4' };
    } catch (error) {
      throw new Error(`invalid V4 Knowledge Image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error('not a Knowledge Image');
}

async function copyArtifact(sourcePath, outputPath, cwd) {
  const targetPath = path.resolve(cwd, outputPath);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await copyFile(sourcePath, tempPath);
    await rename(tempPath, targetPath);
  } finally {
    await unlinkIfPresent(tempPath);
  }
  return targetPath;
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function renderSearchTable(packs) {
  if (!packs.length) return 'No packs found.';

  const rows = packs.map((pack) => [
    pack.id || pack.name || `${pack.publisher || ''}/${pack.slug || ''}`,
    pack.version ?? '',
    pack.format ?? '',
    pack.license ?? '',
    pack.pulls ?? 0,
    pack.description ?? '',
  ].map((value) => String(value)));
  const widths = [24, 9, 6, 11, 8];
  const header = ['NAME', 'VERSION', 'FORMAT', 'LICENSE', 'PULLS', 'DESCRIPTION'];
  const formatRow = (row) => [
    pad(truncate(row[0], widths[0]), widths[0]),
    pad(truncate(row[1], widths[1]), widths[1]),
    pad(truncate(row[2], widths[2]), widths[2]),
    pad(truncate(row[3], widths[3]), widths[3]),
    pad(truncate(row[4], widths[4]), widths[4]),
    truncate(row[5], 72),
  ].join('  ').trimEnd();

  return [formatRow(header), ...rows.map(formatRow)].join('\n');
}

export function renderPackInfo(body) {
  const pack = body.pack || {};
  const latest = body.latest || {};
  const lines = [
    `name        ${body.name}`,
    `description ${body.description || pack.description || ''}`,
    `publisher   ${body.publisher || pack.publisher || ''}`,
    `slug        ${body.slug || pack.slug || ''}`,
    `format      ${pack.format || ''}`,
    `version     ${pack.version || latest.version || ''}`,
    `license     ${pack.license || latest.license || ''}`,
    `sizeBytes   ${pack.sizeBytes ?? latest.sizeBytes ?? 0}`,
    `docs        ${pack.docs ?? 0}`,
    `blocks      ${pack.blocks ?? 0}`,
    `namespaces  ${Array.isArray(pack.namespaces) ? pack.namespaces.join(', ') : ''}`,
    `pulls       ${pack.pulls ?? 0}`,
    `stars       ${pack.stars ?? 0}`,
    `topics      ${Array.isArray(pack.topics) ? pack.topics.join(', ') : ''}`,
    `latest      ${latest.version || ''}`,
    `sha256      ${latest.sha256 || pack.sha256 || ''}`,
    `url         ${latest.url || pack.blobUrl || ''}`,
  ];
  return lines.join('\n');
}

function truncate(value, width) {
  if (value.length <= width) return value;
  if (width <= 1) return '…'.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

function pad(value, width) {
  return value.padEnd(width, ' ');
}
