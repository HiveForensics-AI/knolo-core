/**
 * knolo compose / knolo attest
 *
 * Offline composition and attestation. This file does not fetch Hub.
 * `used` means a query or a KAR evaluation ran. It is not a truth verdict.
 * Hub `attested: true` is a listing flag and is not an attestation root.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KAR_CLI_MAX_IMAGE_BYTES, readBounded, readBoundedJson } from './kar-limits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPOSE_USAGE = `Usage:
  knolo compose create --members members.json --out composition/ [--host knowledge.knolo] [--host-knowledge-root <digest>] [--availability material|digest] [--policy policy.json]
  knolo compose verify <composition/> [--require-material] [--member alias=path]... [--host knowledge.knolo]
  knolo compose excerpt --image knowledge.knolo --object <id> [--object <id>] --out excerpt.json
  knolo compose query --composition composition/ --eql "..." [--question "..."] [--json]

Members use composition-members-1. Paths stay in that file and in bundle.json. They are not part of compositionRoot.
availability material requires bytes. digest commits to digests only.
A composition does not change the host image. statement used is not SATISFIED and is not a claim verdict.
Hub attested: true is unrelated.`;

const ATTEST_USAGE = `Usage:
  knolo attest create --composition composition/composition.json --subject composition --statement mount|used|cited --out attestation.json [--alias <alias>] [--kar-root <digest> --knowledge-root <digest> --state-root <digest>] [--sign-key key.json --principal <id> --key-id <id> --issued-at <ms> --expires-at <ms> --keyring keyring.json]
  knolo attest verify <attestation.json> [--composition composition.json] [--public-key key.json] [--keyring keyring.json] [--now <ms>] [--content-only]
  knolo verify-attestation <attestation.json> [same verify flags]

statement used means a query or KAR evaluation ran. It does not mean the claim is true or false.
Hub attested: true is a listing flag, not this attestation root.
Signing requires caller-supplied issued-at and expires-at. The CLI does not read the clock.`;

export async function runComposeCli(command, args) {
  if (command === 'verify-attestation') return attestVerify(parseFlags(args));
  if (command === 'attest') {
    const sub = args[0];
    if (sub === 'create') return attestCreate(parseFlags(args.slice(1)));
    if (sub === 'verify') return attestVerify(parseFlags(args.slice(1)));
    throw new Error(`Unknown attest command.\n${ATTEST_USAGE}`);
  }
  if (command !== 'compose') throw new Error(`Unknown command ${command}`);
  const sub = args[0];
  if (sub === 'create') return composeCreate(parseFlags(args.slice(1)));
  if (sub === 'verify') return composeVerify(parseFlags(args.slice(1)));
  if (sub === 'excerpt') return composeExcerpt(parseFlags(args.slice(1)));
  if (sub === 'query') return composeQuery(parseFlags(args.slice(1)));
  throw new Error(`Unknown compose command.\n${COMPOSE_USAGE}`);
}

async function composeCreate(flags) {
  const api = await loadComposition();
  const out = resolve(required(flags, 'out'));
  if (existsSync(path.join(out, 'composition.json'))) throw new Error(`Refusing to overwrite ${path.join(out, 'composition.json')}`);
  const availability = flags.availability ?? 'material';
  if (availability !== 'material' && availability !== 'digest') throw new Error('--availability must be material or digest.');
  const membersFile = readBoundedJson(required(flags, 'members'));
  if (!membersFile || membersFile.format !== 'composition-members-1' || membersFile.version !== 1 || !Array.isArray(membersFile.members)) {
    throw new Error('members file must be composition-members-1.');
  }
  const host = readHost(flags, availability);
  const prepared = membersFile.members.map((entry) => readMember(entry, availability));
  try {
    bindSidecars(api, host, prepared);
  } catch (error) {
    return failClosed(error);
  }
  const domainPackRoot = prepared.some((item) => item.kind === 'domain-pack' && item.files) ? await domainResolver() : undefined;
  let created;
  try {
    created = api.createCompositionRecord({
      ...(host.input ? { host: host.input } : {}),
      members: prepared.map((item) => item.input),
      availability,
      ...(flags.policy ? { policy: readBoundedJson(flags.policy) } : {}),
      ...(domainPackRoot ? { domainPackRoot } : {}),
      karBinder: api.karCompositionBinder,
    });
  } catch (error) {
    return failClosed(error);
  }
  const verdict = api.verifyCompositionRecord(created.record, {
    ...(host.bytes ? { hostBytes: host.bytes } : {}),
    members: materialMap(prepared),
    ...(domainPackRoot ? { domainPackRoot } : {}),
    karBinder: api.karCompositionBinder,
  });
  if (!verdict.ok) {
    console.log(verdict.code);
    process.exitCode = 1;
    return;
  }
  const files = [];
  const bundleMembers = [];
  if (host.bytes) {
    files.push({ path: 'host.knolo', bytes: host.bytes });
  }
  for (const item of prepared) collectMemberFiles(item, files, bundleMembers, created.record);
  const recordText = `${JSON.stringify(created.record, null, 2)}\n`;
  files.push({ path: 'composition.json', bytes: Buffer.from(recordText) });
  const bundle = {
    format: 'composition-bundle-1',
    version: 1,
    compositionRoot: created.compositionRoot,
    ...(host.bytes ? { host: { path: 'host.knolo', sha256: digest(host.bytes) } } : {}),
    members: bundleMembers,
    files: files.map((file) => ({ path: file.path, sha256: digest(file.bytes) })).sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
  mkdirSync(out, { recursive: true });
  for (const file of files) {
    if (file.path === 'composition.json') continue;
    const target = safeJoin(out, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
  writeFileSync(path.join(out, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  writeFileSync(path.join(out, 'composition.json'), recordText);
  if (flags.json) console.log(JSON.stringify({ compositionRoot: created.compositionRoot, availability }, null, 2));
  else console.log(`${created.compositionRoot}\n${out}`);
}

async function composeVerify(flags) {
  const directory = flags._[0];
  if (!directory) throw new Error(`Missing composition directory.\n${COMPOSE_USAGE}`);
  try {
    return await verifyDirectory(flags, directory);
  } catch (error) {
    return failClosed(error);
  }
}

async function verifyDirectory(flags, directory) {
  const api = await loadComposition();
  const dir = resolve(directory);
  const record = readBoundedJson(path.join(dir, 'composition.json'));
  const bundle = existsSync(path.join(dir, 'bundle.json')) ? readBoundedJson(path.join(dir, 'bundle.json')) : null;
  const overrides = new Map();
  for (const pair of flags.member ?? []) {
    const split = pair.indexOf('=');
    if (split <= 0) throw new Error('--member must be alias=path.');
    overrides.set(pair.slice(0, split), pair.slice(split + 1));
  }
  const hostBytes = flags.host ? readBounded(flags.host, KAR_CLI_MAX_IMAGE_BYTES) : bundle?.host ? readBundleFile(dir, bundle, bundle.host.path) : undefined;
  const members = {};
  const parsed = api.parseCompositionRecord(record);
  for (const member of parsed.members) {
    const loaded = loadMemberBytes(dir, bundle, member, overrides);
    if (loaded) members[member.alias] = loaded;
  }
  const needsDomain = Object.values(members).some((item) => item && 'files' in item);
  const domainPackRoot = needsDomain ? await domainResolver() : undefined;
  const verdict = api.verifyCompositionRecord(record, {
    ...(hostBytes ? { hostBytes } : {}),
    members,
    requireMaterial: flags['require-material'] === true,
    ...(domainPackRoot ? { domainPackRoot } : {}),
    karBinder: api.karCompositionBinder,
  });
  if (!verdict.ok) {
    console.log(verdict.code);
    process.exitCode = 1;
    return;
  }
  console.log(verdict.availability === 'digest' ? 'VERIFIED digest-bound' : 'VERIFIED');
}

async function composeExcerpt(flags) {
  const api = await loadComposition();
  const out = resolve(required(flags, 'out'));
  if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
  const image = readBounded(required(flags, 'image'), KAR_CLI_MAX_IMAGE_BYTES);
  const objectIds = flags.object ?? [];
  if (objectIds.length === 0) throw new Error('excerpt requires at least one --object.');
  let created;
  try {
    created = api.createBoundedExcerpt({ image, objectIds });
  } catch (error) {
    return failClosed(error);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(created.excerpt, null, 2)}\n`);
  console.log(created.excerptRoot);
}

async function composeQuery(flags) {
  const api = await loadComposition();
  const directory = required(flags, 'composition');
  const dir = resolve(directory);
  const record = readBoundedJson(path.join(dir, 'composition.json'));
  const bundle = existsSync(path.join(dir, 'bundle.json')) ? readBoundedJson(path.join(dir, 'bundle.json')) : null;
  const parsed = api.parseCompositionRecord(record);
  const hostBytes = bundle?.host ? readBundleFile(dir, bundle, bundle.host.path) : undefined;
  const members = {};
  for (const member of parsed.members) {
    const loaded = loadMemberBytes(dir, bundle, member, new Map());
    if (loaded) members[member.alias] = loaded;
  }
  let session;
  try {
    session = api.openComposedSession(record, {
      ...(hostBytes ? { hostBytes } : {}),
      members,
      ...(Object.values(members).some((item) => item && 'files' in item) ? { domainPackRoot: await domainResolver() } : {}),
      karBinder: api.karCompositionBinder,
    });
  } catch (error) {
    return failClosed(error);
  }
  let result;
  try {
    result = api.queryComposedSession(session, {
      ...(flags.eql ? { eql: flags.eql } : {}),
      ...(flags.question ? { question: flags.question } : {}),
      ...(flags['require-queryable'] ? { requireQueryable: true } : {}),
      ...(flags['require-policy'] ? { requirePolicy: true, policy: readBoundedJson(required(flags, 'policy')), principal: required(flags, 'principal') } : {}),
    });
  } catch (error) {
    return failClosed(error);
  }
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const row of result.results) {
    console.log(`${row.alias} ${row.kind} ${row.status}`);
    if (row.planRoot) console.log(`planRoot ${row.planRoot}`);
    if (row.resultRoot) console.log(`resultRoot ${row.resultRoot}`);
    if (row.hits) console.log(`hits ${row.hits.length}`);
  }
}

async function attestCreate(flags) {
  const api = await loadComposition();
  const out = resolve(required(flags, 'out'));
  if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
  const parsed = api.assertCompositionRoot(readBoundedJson(compositionPath(required(flags, 'composition'))));
  const statement = required(flags, 'statement');
  const subject = subjectFrom(parsed, flags);
  let attestation;
  try {
    attestation = api.createCompositionAttestation({ record: parsed, subject, statement }).attestation;
    if (flags['sign-key']) attestation = await signAttestation(api, attestation, flags);
  } catch (error) {
    return failClosed(error);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(attestation, null, 2)}\n`);
  console.log(attestation.attestationRoot);
}

async function attestVerify(flags) {
  const api = await loadComposition();
  const file = flags._[0];
  if (!file) throw new Error(`Missing attestation file.\n${ATTEST_USAGE}`);
  const attestation = readBoundedJson(file);
  if (flags.composition) {
    let record;
    try {
      record = api.assertCompositionRoot(readBoundedJson(compositionPath(flags.composition)));
    } catch (error) {
      return failClosed(error);
    }
    if (attestation.compositionRoot !== record.compositionRoot) {
      console.log('ATTESTATION_MISMATCH');
      process.exitCode = 1;
      return;
    }
  }
  const verdict = await api.verifyCompositionAttestation(attestation, {
    ...(flags.now !== undefined ? { now: Number(flags.now) } : {}),
    checkSignature: flags['content-only'] ? false : true,
    ...(flags['public-key'] ? { publicKey: loadPublicKey(flags['public-key']) } : {}),
    ...(flags.keyring ? { keyring: loadKeyring(flags.keyring) } : {}),
  });
  if (!verdict.ok) {
    console.log(verdict.code);
    process.exitCode = 1;
    return;
  }
  if (verdict.signature === 'content-only') console.log('VERIFIED content-only');
  else console.log('VERIFIED');
}

function bindSidecars(api, host, prepared) {
  for (const member of prepared) {
    if (member.kind !== 'kar-sidecar' || !member.bytes) continue;
    const imageBytes = member.input.bindsTo === 'host' ? host.bytes : prepared.find((item) => item.alias === member.input.bindsTo)?.bytes;
    if (!imageBytes) {
      const error = new Error(`${member.alias} binds to an image without bytes.`);
      error.code = 'COMPOSITION_KAR_UNBOUND';
      throw error;
    }
    const bound = api.karCompositionBinder(imageBytes, member.bytes);
    member.input.knowledgeRoot = bound.knowledgeRoot;
    member.input.semanticRoot = bound.semanticRoot;
    if (member.input.bindsTo === 'host') {
      host.input.knowledgeRoot = bound.knowledgeRoot;
    } else {
      const image = prepared.find((item) => item.alias === member.input.bindsTo);
      if (image && image.input.knowledgeRoot === undefined) image.input.knowledgeRoot = bound.knowledgeRoot;
    }
  }
}

function readHost(flags, availability) {
  if (!flags.host) return { input: { kind: 'none' } };
  if (availability === 'digest' && flags['host-state-root']) {
    return {
      input: {
        kind: 'v5-image',
        stateRoot: flags['host-state-root'],
        objectRoot: required(flags, 'host-object-root'),
        commitDigest: required(flags, 'host-commit-digest'),
        ...(flags['host-knowledge-root'] ? { knowledgeRoot: flags['host-knowledge-root'] } : {}),
      },
    };
  }
  const bytes = readBounded(flags.host, KAR_CLI_MAX_IMAGE_BYTES);
  return {
    bytes,
    input: {
      kind: 'v5-image',
      bytes,
      ...(flags['host-knowledge-root'] ? { knowledgeRoot: flags['host-knowledge-root'] } : {}),
    },
  };
}

function readMember(entry, availability) {
  if (!entry || typeof entry.alias !== 'string' || typeof entry.kind !== 'string') throw new Error('Each member needs alias and kind.');
  const input = { alias: entry.alias, kind: entry.kind };
  if (availability === 'digest' && !entry.path) return { alias: entry.alias, kind: entry.kind, input: { ...input, ...digestFields(entry) } };
  if (!entry.path) throw new Error(`Member ${entry.alias} needs path.`);
  if (entry.kind === 'domain-pack') {
    const files = readDomainFiles(entry.path);
    return { alias: entry.alias, kind: entry.kind, files, input: { ...input, files } };
  }
  if (entry.kind === 'excerpt') {
    const excerpt = readBoundedJson(entry.path);
    const parentBytes = entry.parent ? readBounded(entry.parent, KAR_CLI_MAX_IMAGE_BYTES) : undefined;
    return {
      alias: entry.alias,
      kind: entry.kind,
      excerpt,
      parentBytes,
      input: {
        ...input,
        excerptRoot: excerpt.excerptRoot,
        parentStateRoot: excerpt.parent?.stateRoot,
        parentObjectRoot: excerpt.parent?.objectRoot,
        parentCommitDigest: excerpt.parent?.commitDigest,
        inclusion: excerpt.inclusion,
      },
    };
  }
  if (entry.kind === 'composition') {
    const directory = resolve(entry.path);
    const directoryRecord = existsSync(path.join(directory, 'composition.json'));
    const nestedPath = directoryRecord ? path.join(directory, 'composition.json') : directory;
    const nested = readBoundedJson(nestedPath);
    const hostFile = directoryRecord ? path.join(directory, 'host.knolo') : undefined;
    const hostBytes = hostFile && existsSync(hostFile) ? readBounded(hostFile, KAR_CLI_MAX_IMAGE_BYTES) : undefined;
    return { alias: entry.alias, kind: entry.kind, record: nested, hostBytes, input: { ...input, record: nested } };
  }
  const bytes = readBounded(entry.path, KAR_CLI_MAX_IMAGE_BYTES);
  const extra = {};
  if (entry.kind === 'kar-sidecar') extra.bindsTo = entry.bindsTo;
  if (entry.knowledgeRoot) extra.knowledgeRoot = entry.knowledgeRoot;
  return { alias: entry.alias, kind: entry.kind, bytes, input: { ...input, bytes, ...extra } };
}

function digestFields(entry) {
  const copy = { ...entry };
  delete copy.path;
  delete copy.parent;
  return copy;
}

function materialMap(prepared) {
  const members = {};
  for (const item of prepared) {
    if (item.bytes) members[item.alias] = { bytes: item.bytes };
    else if (item.files) members[item.alias] = { files: item.files };
    else if (item.record) members[item.alias] = { record: item.record, ...(item.hostBytes ? { hostBytes: item.hostBytes } : {}) };
    else if (item.kind === 'excerpt') members[item.alias] = { excerpt: item.excerpt, ...(item.parentBytes ? { parentBytes: item.parentBytes } : {}) };
  }
  return members;
}

function collectMemberFiles(item, files, bundleMembers, record) {
  const declared = record.members.find((member) => member.alias === item.alias);
  if (item.bytes) {
    const relative = item.kind === 'kar-sidecar' ? `members/${item.alias}.kar.json` : `members/${item.alias}.knolo`;
    files.push({ path: relative, bytes: item.bytes });
    bundleMembers.push({ alias: item.alias, kind: item.kind, path: relative, sha256: digest(item.bytes) });
    return;
  }
  if (item.files) {
    for (const file of item.files) {
      files.push({ path: `members/${item.alias}/${file.path}`, bytes: file.bytes });
    }
    bundleMembers.push({ alias: item.alias, kind: item.kind, path: `members/${item.alias}`, ...(declared?.filesRoot ? { sha256: declared.filesRoot } : {}) });
    return;
  }
  if (item.excerpt) {
    const relative = `excerpts/${item.alias}.json`;
    const bytes = Buffer.from(`${JSON.stringify(item.excerpt, null, 2)}\n`);
    files.push({ path: relative, bytes });
    bundleMembers.push({ alias: item.alias, kind: item.kind, path: relative, sha256: digest(bytes) });
    if (item.parentBytes) {
      const parent = `excerpts/${item.alias}.parent.knolo`;
      files.push({ path: parent, bytes: item.parentBytes });
    }
    return;
  }
  if (item.record) {
    const relative = `members/${item.alias}/composition.json`;
    const bytes = Buffer.from(`${JSON.stringify(item.record, null, 2)}\n`);
    files.push({ path: relative, bytes });
    bundleMembers.push({ alias: item.alias, kind: item.kind, path: relative, sha256: digest(bytes) });
    if (item.hostBytes) files.push({ path: `members/${item.alias}/host.knolo`, bytes: item.hostBytes });
  }
}

function loadMemberBytes(dir, bundle, member, overrides) {
  const override = overrides.get(member.alias);
  if (override) return bytesForKind(member, readBounded(override, KAR_CLI_MAX_IMAGE_BYTES), override);
  const listed = bundle?.members?.find((item) => item.alias === member.alias);
  if (!listed) {
    if (member.kind === 'v5-image' || member.kind === 'v4-pack' || member.kind === 'kar-sidecar') {
      const cached = cacheFile(member.sha256);
      if (cached) return { bytes: cached };
    }
    return undefined;
  }
  if (member.kind === 'domain-pack') {
    const prefix = `${listed.path.replace(/\/$/, '')}/`;
    const files = (bundle.files ?? [])
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => ({ path: file.path.slice(prefix.length), bytes: readBundleFile(dir, bundle, file.path) }));
    return { files };
  }
  if (member.kind === 'composition') {
    const record = readBoundedJson(safeJoin(dir, listed.path));
    const directory = listed.path.split('/').slice(0, -1).join('/');
    const hostPath = directory ? `${directory}/host.knolo` : 'host.knolo';
    const hostFile = (bundle.files ?? []).find((file) => file.path === hostPath);
    return { record, ...(hostFile ? { hostBytes: readBundleFile(dir, bundle, hostPath) } : {}) };
  }
  if (member.kind === 'excerpt') {
    const excerpt = JSON.parse(readBundleFile(dir, bundle, listed.path).toString('utf8'));
    const parentPath = `excerpts/${member.alias}.parent.knolo`;
    const parentFile = (bundle.files ?? []).find((file) => file.path === parentPath);
    return { excerpt, ...(parentFile ? { parentBytes: readBundleFile(dir, bundle, parentPath) } : {}) };
  }
  return { bytes: readBundleFile(dir, bundle, listed.path) };
}

function bytesForKind(member, bytes, file) {
  if (member.kind === 'domain-pack') return { files: readDomainFiles(file) };
  if (member.kind === 'composition') return { record: readBoundedJson(file) };
  if (member.kind === 'excerpt') return { excerpt: readBoundedJson(file) };
  return { bytes };
}

function readBundleFile(dir, bundle, relative) {
  const file = (bundle.files ?? []).find((item) => item.path === relative);
  const bytes = readFileSync(safeJoin(dir, relative));
  if (file && digest(bytes) !== file.sha256) {
    const error = new Error(`${relative} does not match bundle.json.`);
    error.code = 'COMPOSITION_DIGEST_MISMATCH';
    throw error;
  }
  return bytes;
}

function cacheFile(sha) {
  if (typeof sha !== 'string' || !sha.startsWith('sha256-')) return undefined;
  const file = path.join(homedir(), '.knolo', 'cache', 'sha256', `${sha.slice('sha256-'.length)}.knolo`);
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  return digest(bytes) === sha ? bytes : undefined;
}

function readDomainFiles(directory) {
  const root = resolve(directory);
  const files = [{ path: 'domain.yaml', bytes: readBounded(path.join(root, 'domain.yaml'), KAR_CLI_MAX_IMAGE_BYTES) }];
  collectDomain(files, root, 'rules', (name) => /\.(ya?ml|json)$/i.test(name));
  collectDomain(files, root, 'plans', (name) => name.endsWith('.json'));
  collectDomain(files, root, 'fixtures', (name) => name.endsWith('.json'));
  return files;
}

function collectDomain(files, root, folder, accept) {
  const dir = path.join(root, folder);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter(accept).sort()) {
    files.push({ path: `${folder}/${name}`, bytes: readBounded(path.join(dir, name), KAR_CLI_MAX_IMAGE_BYTES) });
  }
}

async function domainResolver() {
  const authoring = await loadAuthoring();
  const { loadDomainDirectory } = await import('./kar-produce.mjs');
  return (files) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'knolo-domain-'));
    try {
      for (const file of files) {
        const target = safeJoin(dir, file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.bytes);
      }
      const loaded = loadDomainDirectory(authoring, dir);
      if (!loaded.ok) return null;
      return { id: loaded.pack.id, version: String(loaded.pack.version), root: authoring.domainPackRoot(loaded.pack) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function subjectFrom(record, flags) {
  const kind = required(flags, 'subject');
  if (kind === 'composition') return { kind, compositionRoot: record.compositionRoot };
  if (kind === 'v5-image') {
    const member = memberByAlias(record, flags.alias);
    const image = member?.kind === 'v5-image' ? member : record.host.kind === 'v5-image' ? record.host : null;
    if (!image) throw new Error('--subject v5-image needs --alias or a host image.');
    return { kind, stateRoot: image.stateRoot, objectRoot: image.objectRoot, commitDigest: image.commitDigest };
  }
  if (kind === 'excerpt') {
    const member = memberByAlias(record, required(flags, 'alias'));
    if (!member || member.kind !== 'excerpt') throw new Error('--alias is not an excerpt.');
    return { kind, excerptRoot: member.excerptRoot };
  }
  if (kind === 'kar-result') {
    return {
      kind,
      karRoot: required(flags, 'kar-root'),
      knowledgeRoot: required(flags, 'knowledge-root'),
      stateRoot: required(flags, 'state-root'),
    };
  }
  throw new Error('--subject must be composition, v5-image, excerpt, or kar-result.');
}

async function signAttestation(api, attestation, flags) {
  const key = readBoundedJson(flags['sign-key']);
  const principal = flags.principal ?? key.principal;
  const keyId = flags['key-id'] ?? key.keyId;
  const issuedAt = Number(flags['issued-at'] ?? key.issuedAt);
  const expiresAt = Number(flags['expires-at'] ?? key.expiresAt);
  if (!principal || !keyId) throw new Error('Signing requires --principal and --key-id.');
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) {
    throw new Error('Signing requires --issued-at and --expires-at as unix milliseconds. The CLI does not read the clock.');
  }
  const privateKey = decodeBase64(key.privateKey ?? key.seed);
  let keyringRoot = typeof key.keyringRoot === 'string' ? key.keyringRoot : undefined;
  if (flags.keyring) {
    const computed = (await loadAuthorityRoot())(loadKeyring(flags.keyring));
    if (keyringRoot && keyringRoot !== computed) throw new Error('Signing key keyringRoot does not match --keyring.');
    keyringRoot = computed;
  }
  const envelope = {
    format: 'composition-signature-1',
    version: 1,
    attestationRoot: attestation.attestationRoot,
    algorithm: 'Ed25519',
    principal,
    keyId,
    issuedAt,
    expiresAt,
    ...(keyringRoot ? { keyringRoot } : {}),
  };
  const payload = api.attestationSignaturePayload(envelope);
  const cryptoKey = privateKey.length === 32
    ? await crypto.subtle.importKey('raw', privateKey, { name: 'Ed25519' }, false, ['sign'])
    : await crypto.subtle.importKey('pkcs8', privateKey, { name: 'Ed25519' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, cryptoKey, payload));
  return api.withCompositionSignature(attestation, {
    principal,
    keyId,
    issuedAt,
    expiresAt,
    signature,
    ...(envelope.keyringRoot ? { keyringRoot: envelope.keyringRoot } : {}),
  });
}

function loadPublicKey(file) {
  const json = readBoundedJson(file);
  const encoded = json && typeof json === 'object' ? json.publicKey ?? json.key : json;
  if (typeof encoded !== 'string') throw new Error('Public key file must contain a base64 publicKey.');
  return decodeBase64(encoded);
}

function loadKeyring(file) {
  const json = readBoundedJson(file);
  if (!json || !Array.isArray(json.keys)) throw new Error('Keyring must contain keys.');
  return {
    version: json.version,
    sequence: json.sequence,
    keys: json.keys.map((key) => ({ ...key, publicKey: typeof key.publicKey === 'string' ? decodeBase64(key.publicKey) : Uint8Array.from(key.publicKey) })),
    rotations: json.rotations ?? [],
  };
}

function memberByAlias(record, alias) {
  if (!alias) return undefined;
  return record.members.find((member) => member.alias === alias);
}

function compositionPath(file) {
  const resolved = resolve(file);
  return existsSync(path.join(resolved, 'composition.json')) ? path.join(resolved, 'composition.json') : resolved;
}

function digest(bytes) {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Expected base64.');
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function safeJoin(root, relative) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.startsWith('/') || relative.includes('\\')) {
    throw new Error(`Unsafe path ${relative}`);
  }
  if (relative.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) throw new Error(`Unsafe path ${relative}`);
  const resolved = path.resolve(root, relative);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error(`Unsafe path ${relative}`);
  return resolved;
}

function failClosed(error) {
  if (error && error.name === 'KarError') {
    console.log('COMPOSITION_KAR_UNBOUND');
    console.log(error.message);
    process.exitCode = 1;
    return;
  }
  if (error && typeof error.code === 'string') {
    console.log(error.code);
    console.log(error.message);
    process.exitCode = 1;
    return;
  }
  throw error;
}

function parseFlags(args) {
  const flags = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' || arg === '--require-material' || arg === '--content-only' || arg === '--require-queryable' || arg === '--require-policy') {
      flags[arg.slice(2)] = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      index += 1;
      if (key === 'member' || key === 'object') {
        flags[key] = flags[key] ?? [];
        flags[key].push(value);
      } else flags[key] = value;
      continue;
    }
    flags._.push(arg);
  }
  return flags;
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`Missing --${name}`);
  return flags[name];
}

function resolve(file) {
  return path.resolve(process.cwd(), file);
}

async function loadAuthorityRoot() {
  const candidates = [
    path.resolve(__dirname, '../../core/dist/knowledge_key_rotation_v5.js'),
    '@knolo/core',
  ];
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@') ? candidate : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (loaded.authorityKeyringRootV1) return loaded.authorityKeyringRootV1;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Could not load authorityKeyringRootV1. Build packages/core first.');
}

async function loadComposition() {
  const candidates = [
    path.resolve(__dirname, '../../core/dist/composition/index.js'),
    '@knolo/core/composition',
  ];
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@') ? candidate : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (loaded.createCompositionRecord && loaded.verifyCompositionRecord && loaded.karCompositionBinder) return loaded;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Could not load @knolo/core/composition. Build packages/core first.');
}

async function loadAuthoring() {
  const candidates = [
    path.resolve(__dirname, '../../core/dist/experimental/kar/authoring/index.js'),
    '@knolo/core/experimental/kar/authoring',
  ];
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@') ? candidate : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (loaded.domainPackRoot && loaded.parseAuthoringDocument && loaded.interpretDomainPack) return loaded;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Could not load @knolo/core/kar/authoring. Build packages/core first.');
}
