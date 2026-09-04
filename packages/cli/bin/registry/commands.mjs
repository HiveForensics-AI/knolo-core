import { chmod, copyFile, lstat, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { registryApiUrl, resolveRegistryUrl } from './config.mjs';
import { downloadBlobToTemp, MAX_ARTIFACT_BYTES, readArtifact, stageCachedArtifact } from './artifacts.mjs';
import { RegistryError } from './errors.mjs';
import { getJson, postJson, putBytes } from './http.mjs';
import { cachePath, stageLockfileUpdate, validateLockfileUpdate } from './lockfile.mjs';
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
  const stagedFiles = [];
  try {
    if (download.sha256 !== manifest.sha256) {
      throw new Error(`artifact sha256 mismatch: expected ${manifest.sha256}, got ${download.sha256}`);
    }
    const bytes = await readArtifact(download.tempPath);
    const validation = await validateKnowledgeImage(core, bytes);
    if (manifest.format && String(manifest.format).toUpperCase() !== validation.format) {
      throw new Error(`artifact format mismatch: manifest=${manifest.format}, bytes=${validation.format}`);
    }
    if (validation.format === 'V5' && !manifest.stateRoot) {
      throw new Error('V5 artifact requires manifest stateRoot.');
    }
    if (manifest.stateRoot !== undefined && manifest.stateRoot !== validation.stateRoot) {
      throw new Error(`artifact stateRoot mismatch: expected ${manifest.stateRoot}, got ${validation.stateRoot || 'none'}`);
    }
    const stagedCachePath = await stageCachedArtifact(download.tempPath, finalCachePath);
    stagedFiles.push({ targetPath: finalCachePath, tempPath: stagedCachePath });
    let outputPath = finalCachePath;
    if (flags.out) {
      const stagedOutput = await stageArtifactCopy(download.tempPath, flags.out, cwd);
      stagedFiles.push(stagedOutput);
      outputPath = stagedOutput.targetPath;
    }
    const stagedLock = await stageLockfileUpdate({ cwd, registry, manifest, force: flags.force });
    stagedFiles.push({ targetPath: stagedLock.path, tempPath: stagedLock.tempPath });
    await commitStagedFiles(stagedFiles);
    const lock = { path: stagedLock.path, entry: stagedLock.entry };
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
    await unlinkIfPresent(download.tempPath);
    await Promise.all(stagedFiles.map(({ tempPath }) => unlinkIfPresent(tempPath)));
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
  print('Authorization: Bearer kno_…');
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

export async function runHubPublish(args, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  cwd = process.cwd(),
  homeDir,
  print = console.log,
  sleep = wait,
  pollIntervalMs = 1000,
  maxPollAttempts = 120,
} = {}) {
  const { packPath, flags } = parsePublishArgs(args);
  const credentials = await loadCredentials({ env, homeDir });
  const registry = resolveRegistryUrl({ value: flags.registry || credentials.registry, env });
  const authHeaders = authorizationHeaders(credentials.token);

  // This request is deliberately first: it proves the stored dashboard token
  // is a Hub Bearer credential before any upload or publish mutation starts.
  const account = await getJson(registryApiUrl(registry, ['account']), { fetchImpl, headers: authHeaders });
  const accountPublisher = extractPublisherHandle(account);
  if (flags.publisher && accountPublisher && flags.publisher !== accountPublisher) {
    throw new Error(`Token is scoped to publisher ${accountPublisher}, not ${flags.publisher}.`);
  }
  const publisher = flags.publisher || accountPublisher;

  const packFile = path.resolve(cwd, packPath);
  const bytes = await readFile(packFile);
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error('Artifact exceeds Hub’s 250 MB limit.');
  const sha256 = createSha256(bytes);

  const uploadToken = await postJson(hubApiUrl(registry, ['upload', 'token']), {
    sha256,
    contentLength: bytes.length,
  }, { fetchImpl, headers: authHeaders });
  const upload = validateUploadTokenResponse(uploadToken, sha256);
  assertPublicBlobUrl(upload.url, 'upload');
  const uploaded = await putBytes(upload.url, bytes, {
    fetchImpl,
    headers: { 'content-length': String(bytes.length) },
  });
  assertPublicBlobUrl(uploaded.url, 'uploaded artifact');

  const completed = await postJson(hubApiUrl(registry, ['upload', 'complete']), {
    sha256,
    url: upload.url,
    sizeBytes: bytes.length,
    pathname: upload.pathname,
  }, { fetchImpl, headers: authHeaders });
  const blobUrl = extractBlobUrl(completed) || upload.url;
  assertPublicBlobUrl(blobUrl, 'completed upload');

  const verifyResponse = await postJson(registryApiUrl(registry, ['publish', 'verify']), { sha256 }, {
    fetchImpl,
    headers: authHeaders,
  });
  const jobId = extractId(verifyResponse, ['jobId', 'id', 'job']);
  if (!jobId) throw new Error('Hub verify response did not include a publish job id.');
  const job = await waitForPublishJob(registry, jobId, {
    fetchImpl,
    headers: authHeaders,
    sleep,
    pollIntervalMs,
    maxPollAttempts,
  });

  const draftPayload = {
    sha256,
    slug: flags.slug,
    version: flags.version,
    license: flags.license,
    attested: true,
    ...(flags.readme !== undefined ? { readme: flags.readme } : {}),
    ...(flags.sources !== undefined ? { sources: flags.sources } : {}),
    ...(flags.intendedUse !== undefined ? { intendedUse: flags.intendedUse } : {}),
  };
  const draftResponse = await postJson(registryApiUrl(registry, ['publish', 'drafts']), draftPayload, {
    fetchImpl,
    headers: authHeaders,
  });
  const draftId = extractId(draftResponse, ['draftId', 'id', 'draft']);
  if (!draftId) throw new Error('Hub draft response did not include a draft id.');

  const releaseResponse = await postJson(registryApiUrl(registry, ['publish', 'drafts', draftId, 'release']), undefined, {
    fetchImpl,
    headers: authHeaders,
  });
  const name = `${publisher ? `${publisher}/` : ''}${flags.slug}`;
  const result = {
    registry,
    ...(publisher ? { publisher } : {}),
    name,
    slug: flags.slug,
    version: flags.version,
    sha256,
    sizeBytes: bytes.length,
    pathname: upload.pathname,
    url: blobUrl,
    jobId: String(jobId),
    draftId: String(draftId),
    verification: job,
    release: releaseResponse,
  };

  if (flags.json) print(JSON.stringify(result, null, 2));
  else {
    print(`published ${name}@${flags.version}`);
    print(`sha256    ${sha256}`);
    print(`url       ${blobUrl}`);
    print(`job       ${jobId}`);
  }
  return result;
}

export async function runHubYank(args, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  homeDir,
  print = console.log,
} = {}) {
  const { spec, flags } = parseYankArgs(args);
  const credentials = await loadCredentials({ env, homeDir });
  const registry = resolveRegistryUrl({ value: flags.registry || credentials.registry, env });
  const response = await postJson(registryApiUrl(registry, ['packs', spec.publisher, spec.slug, spec.version, 'yank']), undefined, {
    fetchImpl,
    headers: authorizationHeaders(credentials.token),
  });
  const result = {
    registry,
    name: spec.name,
    version: spec.version,
    response,
  };
  if (flags.json) print(JSON.stringify(result, null, 2));
  else print(`yanked ${spec.name}@${spec.version}`);
  return result;
}

export function parsePublishArgs(args) {
  const positional = [];
  const flags = {};
  const valueFlags = new Map([
    ['--slug', 'slug'],
    ['--version', 'version'],
    ['--license', 'license'],
    ['--publisher', 'publisher'],
    ['--readme', 'readme'],
    ['--sources', 'sources'],
    ['--intended-use', 'intendedUse'],
    ['--registry', 'registry'],
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      flags[valueFlags.get(arg)] = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown flag for publish: ${arg}`);
    positional.push(arg);
  }

  if (positional.length !== 1 || !flags.slug || !flags.version || !flags.license) {
    throw new Error('Usage: knolo publish <pack.knolo> --slug <slug> --version <version> --license <SPDX> [--publisher <handle>] [--readme <text>] [--sources <text>] [--intended-use <text>] [--json] [--registry <url>]');
  }
  if (!/^[a-z0-9-]+$/.test(flags.slug)) throw new Error('Publish slug must contain lowercase letters, numbers, and hyphens.');
  if (!flags.version.trim() || flags.version.includes('@')) throw new Error('Publish version must be a non-empty version without @.');
  if (!flags.license.trim()) throw new Error('Publish license is required.');
  if (flags.publisher && !/^[a-z0-9-]+$/.test(flags.publisher)) throw new Error('Publish publisher must contain lowercase letters, numbers, and hyphens.');
  return { packPath: positional[0], flags };
}

export function parseYankArgs(args) {
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
    if (arg.startsWith('--')) throw new Error(`Unknown flag for yank: ${arg}`);
    positional.push(arg);
  }
  if (positional.length !== 1) throw new Error('Usage: knolo yank <publisher>/<slug>@<version> [--json] [--registry <url>]');
  const spec = parsePackSpec(positional[0]);
  if (spec.version === 'latest') throw new Error('Yank requires an exact version: <publisher>/<slug>@<version>.');
  return { spec, flags };
}

function authorizationHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function hubApiUrl(registry, segments) {
  const url = new URL(registry);
  url.pathname = `/api/${segments.map((segment) => encodeURIComponent(String(segment))).join('/')}`;
  return url;
}

function createSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function extractPublisherHandle(account) {
  const candidates = [
    account?.publisherHandle,
    account?.publisher?.handle,
    account?.publisher?.slug,
    account?.handle,
    account?.account?.publisherHandle,
    account?.account?.publisher?.handle,
    account?.user?.publisherHandle,
    account?.publishers?.[0]?.handle,
    account?.publishers?.[0]?.slug,
    typeof account?.publisher === 'string' ? account.publisher : undefined,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim();
}

function validateUploadTokenResponse(body, sha256) {
  const upload = body?.upload && typeof body.upload === 'object' ? body.upload : body;
  if (!upload || typeof upload !== 'object' || typeof upload.url !== 'string' || !upload.url) {
    if (upload?.clientToken || body?.clientToken) {
      throw new Error('Hub returned a Blob client token; this CLI requires an upload.url for direct public-Blob PUT.');
    }
    throw new Error('Hub upload token response is missing upload.url.');
  }
  const pathname = upload.pathname || body?.pathname;
  if (typeof pathname !== 'string' || !pathname) throw new Error('Hub upload token response is missing upload.pathname.');
  const expectedPathname = `sha256/${sha256}.knolo`;
  if (pathname !== expectedPathname) {
    throw new Error(`Hub upload pathname is not locked to ${expectedPathname}.`);
  }
  return { url: upload.url, pathname };
}

function extractBlobUrl(body) {
  const candidates = [
    body?.url,
    body?.publicUrl,
    body?.blobUrl,
    body?.artifact?.url,
    body?.artifact?.publicUrl,
    body?.upload?.url,
    body?.upload?.publicUrl,
    body?.pack?.url,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim();
}

function assertPublicBlobUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Hub ${label} URL is invalid.`);
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error(`Hub ${label} URL must use HTTPS.`);
  if (hostname.includes('.private.') || hostname.startsWith('private.')) {
    throw new Error(`Refusing private Blob URL for ${label}; Hub verification requires a public Blob URL.`);
  }
  return url;
}

function extractId(body, keys) {
  for (const key of keys) {
    const value = body?.[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (value && typeof value === 'object') {
      if (typeof value.id === 'string' && value.id) return value.id;
      if (typeof value.id === 'number' && Number.isSafeInteger(value.id)) return value.id;
      if (typeof value.jobId === 'string' && value.jobId) return value.jobId;
      if (typeof value.draftId === 'string' && value.draftId) return value.draftId;
    }
  }
  return undefined;
}

async function waitForPublishJob(registry, jobId, {
  fetchImpl,
  headers,
  sleep: sleepImpl = wait,
  pollIntervalMs = 1000,
  maxPollAttempts = 120,
} = {}) {
  if (!Number.isSafeInteger(maxPollAttempts) || maxPollAttempts < 1) throw new Error('maxPollAttempts must be a positive integer.');
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) throw new Error('pollIntervalMs must be a non-negative number.');

  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    if (attempt > 0 && pollIntervalMs > 0) await sleepImpl(pollIntervalMs);
    const body = await getJson(registryApiUrl(registry, ['publish', 'jobs', jobId]), { fetchImpl, headers });
    const job = body?.job && typeof body.job === 'object' ? body.job : body;
    const status = String(job?.status || job?.state || '').toLowerCase();
    if (['passed', 'pass', 'complete', 'completed', 'succeeded', 'success'].includes(status)) return job;
    if (['failed', 'failure', 'error', 'rejected'].includes(status)) {
      const detail = job?.error || job?.message || body?.error;
      throw new Error(`Hub publish verification failed${detail ? `: ${detail}` : '.'}`);
    }
  }

  throw new Error(`Timed out waiting for Hub publish verification job ${jobId}.`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function stageArtifactCopy(sourcePath, outputPath, cwd) {
  const targetPath = path.resolve(cwd, outputPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await copyFile(sourcePath, tempPath);
    await chmod(tempPath, 0o644);
    return { targetPath, tempPath };
  } catch (error) {
    await unlinkIfPresent(tempPath);
    throw error;
  }
}

async function commitStagedFiles(entries) {
  const targets = new Set();
  const records = entries.map((entry) => {
    if (targets.has(entry.targetPath)) throw new Error(`Install paths must be unique: ${entry.targetPath}`);
    targets.add(entry.targetPath);
    return {
      ...entry,
      backupPath: `${entry.targetPath}.backup-${process.pid}-${randomUUID()}`,
      hadOriginal: false,
      committed: false,
    };
  });

  try {
    for (const record of records) {
      const existing = await statIfPresent(record.targetPath);
      if (existing?.isDirectory()) throw new Error(`Cannot replace directory at ${record.targetPath}.`);
    }

    for (const record of records) {
      if (await pathExists(record.targetPath)) {
        record.hadOriginal = true;
        await rename(record.targetPath, record.backupPath);
      }
      await rename(record.tempPath, record.targetPath);
      record.committed = true;
    }

  } catch (error) {
    for (const record of [...records].reverse()) {
      if (record.committed) await unlinkIfPresent(record.targetPath);
      if (record.hadOriginal && await pathExists(record.backupPath)) {
        await unlinkIfPresent(record.targetPath);
        await rename(record.backupPath, record.targetPath);
      }
    }
    throw error;
  }

  for (const record of records) {
    if (record.hadOriginal) await unlinkIfPresent(record.backupPath).catch(() => {});
  }
}

async function statIfPresent(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function pathExists(filePath) {
  return Boolean(await statIfPresent(filePath));
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
