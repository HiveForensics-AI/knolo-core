/**
 * knolo skill
 *
 * Creates a Knolo skill pack: guidance plus an optional pinned V5 image.
 * The pack names no host and no home directory. A directory catalog stores
 * packs. It does not run a model and it does not answer questions.
 * SATISFIED means evidence requirements were met.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SKILL_PACK_FORMAT = 'knolo-skill-pack-v1';
export const MAX_KNOWLEDGE_FILES = 100;
export const MAX_KNOWLEDGE_BYTES = 1024 * 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTENSIONS = new Set(['.md', '.txt', '.json']);

const USAGE = `Usage: knolo skill <init|check|pack|publish|install> [options]

  knolo skill init <name> [--dir <parent>]
  knolo skill check [<dir>] [--query <text>] [--json]
  knolo skill pack [<dir>] [--out <dir>] [--json]
  knolo skill publish <pack> --hub <dir> [--json]
  knolo skill install <name> --hub <dir> --dir <path> [--json]
  knolo skill install --pack <pack> --dir <path> [--json]

A skill is guidance for the host agent. Knolo does not call a model.
check searches the skill's own knowledge and returns a receipt id.
A receipt is an integrity check. It does not mean a claim is proven.
SATISFIED means the evidence requirements were met.
publish copies a pack into a directory catalog. install checks the pin
before it writes, and it writes only into --dir.
The catalog stores packs. It does not answer questions.
This catalog is not https://hub.knolo.dev.`;

export async function runSkillCli(argv) {
  const { positionals, flags } = parseArgs(argv);
  const sub = positionals[0] ?? '';
  if (!sub || sub === 'help' || flags.help) {
    console.log(USAGE);
    return;
  }
  if (sub === 'init') return initSkill(positionals[1], flags);
  if (sub === 'check') return checkSkill(positionals[1], flags);
  if (sub === 'pack') return packSkill(positionals[1], flags);
  if (sub === 'publish') return publishSkill(positionals[1], flags);
  if (sub === 'install') return installSkill(positionals[1], flags);
  throw new Error(`Unknown skill command "${sub}".\n${USAGE}`);
}

export function skillNameError(name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    return 'SKILL_NAME: use lowercase letters, digits, and single hyphens.';
  }
  return null;
}

const ABSOLUTE_PATH =
  /(?:^|[\s`"'(])(?:~\/|\/(?:home|Users|opt|var|tmp)\/|[A-Za-z]:\\)/u;

function hostLayoutError(text) {
  if (ABSOLUTE_PATH.test(text)) {
    return 'SKILL_GUIDANCE: a skill pack cannot name a home directory or an absolute path.';
  }
  return null;
}

export function guidanceError(body) {
  const layout = hostLayoutError(body);
  if (layout) return layout;
  const patterns = [
    /\b(?:skip|ignore|omit|bypass)\b[^.\n]{0,48}\b(?:pin|receipt)\b/giu,
    /\bwithout (?:a |the )?(?:pin|receipt)\b/giu,
    /\b(?:do not|don't|never) (?:cite|include|return)\b[^.\n]{0,48}\breceipt\b/giu,
  ];
  for (const pattern of patterns) pattern.lastIndex = 0;
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const start = Math.max(0, match.index - 20);
      const prefix = body.slice(start, match.index).toLowerCase();
      const negated = /\b(?:not|never)\s*$/u.test(prefix);
      const tellsYouToDropTheReceipt = /\b(?:cite|include|return)\b/iu.test(
        match[0]
      );
      if (negated && !tellsYouToDropTheReceipt) continue;
      return `SKILL_GUIDANCE: the skill tells the agent to skip a pin or a receipt (${match[0]}).`;
    }
  }
  if (!/\breceipt\b/iu.test(body)) {
    return 'SKILL_GUIDANCE: the skill must tell the agent to cite a receipt.';
  }
  if (
    !/\bintegrity\b/iu.test(body) &&
    !/does not mean a claim is proven/iu.test(body)
  ) {
    return 'SKILL_GUIDANCE: the skill must say that a receipt is an integrity check.';
  }
  return null;
}

function initSkill(name, flags) {
  const nameError = skillNameError(name);
  if (nameError) throw new Error(nameError);
  const parent = path.resolve(process.cwd(), flags.dir ?? '.');
  const dir = path.join(parent, name);
  return prepareSkillDir(dir, name, flags);
}

async function prepareSkillDir(dir, name, flags) {
  try {
    await lstat(dir);
    throw new Error(`SKILL_NAME: ${dir} already exists.`);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.join(dir, 'knowledge'), { recursive: true });
  const skill = skillTemplate(name);
  await writeFile(path.join(dir, 'SKILL.md'), skill, { mode: 0o644 });
  const summary = { ok: true, name, dir };
  if (flags.json) console.log(JSON.stringify(summary));
  else console.log(`wrote ${dir}`);
}

function skillTemplate(name) {
  return `---
name: ${name}
description: Cite the pinned Knolo image for ${name} before answering.
---

# ${name}

The host owns the model. This skill does not call one.

1. Search the pinned image for this skill.
2. Include the receipt id in the reply.
3. A receipt is an integrity check. It does not mean a claim is proven. SATISFIED means the evidence requirements were met.
4. Do not skip the pin. Do not invent a passage.
`;
}

async function checkSkill(dirArg, flags) {
  const loaded = await loadSkillDir(dirArg);
  const report = await inspectSkill(loaded, flags.query);
  if (flags.json) console.log(JSON.stringify(report));
  else {
    console.log(`skill            ${report.name}`);
    console.log(`receipt          ${report.receiptId ?? 'none'}`);
    console.log(`hits             ${report.hits}`);
    if (report.stateRoot) console.log(`state root       ${report.stateRoot}`);
  }
}

async function packSkill(dirArg, flags) {
  const loaded = await loadSkillDir(dirArg);
  const built = await buildSkill(loaded, flags.query);
  const out = path.resolve(
    process.cwd(),
    flags.out ??
      path.join(loaded.dir, 'dist', `${loaded.parsed.name}.knolo-skill`)
  );
  try {
    await lstat(out);
    throw new Error(`SKILL_PACK: refusing to overwrite ${out}.`);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  await writePack(out, built);
  const summary = packSummary(built, out);
  if (flags.json) console.log(JSON.stringify(summary));
  else {
    console.log(`skill            ${summary.name}`);
    console.log(`wrote            ${out}`);
    console.log(`skill sha256     ${summary.skillSha256}`);
    if (summary.image) {
      console.log(`image sha256     ${summary.image.sha256}`);
      console.log(`state root       ${summary.image.stateRoot}`);
    }
  }
}

async function publishSkill(packArg, flags) {
  if (!flags.hub) throw new Error('Missing --hub');
  const packDir = path.resolve(process.cwd(), packArg ?? '');
  if (!packArg) throw new Error('SKILL_HUB: pass the pack directory.');
  const pack = await readVerifiedPack(packDir);
  const hub = path.resolve(process.cwd(), flags.hub);
  const dest = path.join(hub, pack.manifest.name);
  await rejectHostPath(dest);
  try {
    const existing = await readVerifiedPack(dest);
    if (
      existing.manifest.skillSha256 !== pack.manifest.skillSha256 ||
      !sameImage(existing.manifest.image, pack.manifest.image)
    ) {
      throw new Error(
        `SKILL_HUB: ${pack.manifest.name} is already in the catalog with a different pin.`
      );
    }
    const summary = {
      ok: true,
      name: pack.manifest.name,
      hub: dest,
      unchanged: true,
    };
    if (flags.json) console.log(JSON.stringify(summary));
    else console.log(`unchanged        ${dest}`);
    return;
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error;
  }
  await writePackFiles(dest, pack);
  const summary = {
    ok: true,
    name: pack.manifest.name,
    hub: dest,
    unchanged: false,
  };
  if (flags.json) console.log(JSON.stringify(summary));
  else console.log(`published        ${dest}`);
}

async function installSkill(nameArg, flags) {
  if (!flags.dir) throw new Error('Missing --dir');
  const destRoot = path.resolve(process.cwd(), flags.dir);
  let pack;
  if (flags.pack) {
    pack = await readVerifiedPack(path.resolve(process.cwd(), flags.pack));
  } else {
    if (!nameArg) throw new Error('SKILL_HUB: pass a skill name or --pack.');
    if (!flags.hub) throw new Error('Missing --hub');
    const nameError = skillNameError(nameArg);
    if (nameError) throw new Error(nameError);
    pack = await readVerifiedPack(
      path.join(path.resolve(process.cwd(), flags.hub), nameArg)
    );
    if (pack.manifest.name !== nameArg) {
      throw new Error(
        `SKILL_HUB: catalog entry ${nameArg} is a pack named ${pack.manifest.name}.`
      );
    }
  }
  const dest = path.join(destRoot, pack.manifest.name);
  await rejectHostPath(dest);
  try {
    await lstat(dest);
    throw new Error(`SKILL_PACK: refusing to overwrite ${dest}.`);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  await writePackFiles(dest, pack);
  const summary = { ok: true, name: pack.manifest.name, dir: dest };
  if (flags.json) console.log(JSON.stringify(summary));
  else console.log(`installed        ${dest}`);
}

async function loadSkillDir(dirArg) {
  const dir = path.resolve(process.cwd(), dirArg ?? '.');
  const raw = await readFile(path.join(dir, 'SKILL.md'));
  const parsed = parseSkill(raw.toString('utf8'));
  if (path.basename(dir) !== parsed.name) {
    throw new Error(
      `SKILL_NAME: directory ${path.basename(dir)} does not match frontmatter name ${parsed.name}.`
    );
  }
  return { dir, raw, parsed };
}

function parseSkill(text) {
  if (!text.startsWith('---\n')) {
    throw new Error(
      'SKILL_FRONTMATTER: SKILL.md must start with a frontmatter block.'
    );
  }
  const end = text.indexOf('\n---\n', 4);
  if (end < 0)
    throw new Error('SKILL_FRONTMATTER: SKILL.md frontmatter does not close.');
  const fields = {};
  for (const line of text.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const match = /^([a-z]+):[ ]*(.*)$/u.exec(line);
    if (!match) throw new Error(`SKILL_FRONTMATTER: cannot read "${line}".`);
    fields[match[1]] = match[2].trim();
  }
  const keys = Object.keys(fields).sort();
  if (keys.join(',') !== 'description,name') {
    throw new Error('SKILL_FRONTMATTER: use only name and description.');
  }
  const nameError = skillNameError(fields.name);
  if (nameError) throw new Error(nameError);
  if (!fields.description)
    throw new Error('SKILL_FRONTMATTER: description is empty.');
  const described = hostLayoutError(fields.description);
  if (described) throw new Error(described);
  const body = text.slice(end + '\n---\n'.length);
  const guidance = guidanceError(body);
  if (guidance) throw new Error(guidance);
  return { name: fields.name, description: fields.description, body };
}

async function inspectSkill(loaded, queryFlag) {
  const files = await listKnowledge(loaded.dir);
  if (files.length === 0) {
    return {
      ok: true,
      name: loaded.parsed.name,
      receiptId: null,
      hits: 0,
      stateRoot: null,
    };
  }
  const built = await buildFromFiles(loaded, files, queryFlag);
  if (built.hits < 1) {
    throw new Error(
      'SKILL_CHECK: the knowledge search returned no hits. Pass --query with words from the source.'
    );
  }
  return {
    ok: true,
    name: loaded.parsed.name,
    receiptId: built.receiptId,
    hits: built.hits,
    stateRoot: built.image.stateRoot,
  };
}

async function buildSkill(loaded, queryFlag) {
  const files = await listKnowledge(loaded.dir);
  return buildFromFiles(loaded, files, queryFlag);
}

async function buildFromFiles(loaded, files, queryFlag) {
  const policy = skillPolicy(loaded.parsed.name);
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`);
  let image = null;
  let hits = 0;
  let receiptId = null;
  if (files.length > 0) {
    const core = await loadCore();
    const objects = [];
    for (const file of files) {
      const bytes = await readFile(file.full);
      objects.push({
        kind: 'chunk',
        bytes,
        meta: { namespace: loaded.parsed.name, source: file.source },
      });
    }
    image = core.createKnowledgeImageV5({
      actor: 'knolo-skill',
      policy,
      objects,
    });
    const query = queryFlag ?? (await defaultQuery(files));
    assertQuery(query);
    const result = core.queryKnowledgeImageV5(
      image,
      `FROM chunk SEARCH ${JSON.stringify(query)} LIMIT 5`
    );
    hits = result.hits.length;
    if (hits < 1) {
      throw new Error(
        'SKILL_CHECK: the knowledge search returned no hits. Pass --query with words from the source.'
      );
    }
    receiptId = `sr_${createHash('sha256')
      .update(`${image.stateRoot}\n${result.resultRoot}`)
      .digest('hex')
      .slice(0, 24)}`;
  }
  const manifest = {
    format: SKILL_PACK_FORMAT,
    name: loaded.parsed.name,
    description: loaded.parsed.description,
    skillSha256: sha256(loaded.raw),
    policySha256: sha256(policyBytes),
    image: image
      ? { sha256: sha256(image.bytes), stateRoot: image.stateRoot }
      : null,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  assertNoHost(manifestBytes.toString('utf8'));
  assertNoHost(policyBytes.toString('utf8'));
  return {
    manifest,
    manifestBytes,
    skillBytes: loaded.raw,
    policyBytes,
    imageBytes: image ? Buffer.from(image.bytes) : null,
    image,
    hits,
    receiptId,
  };
}

function skillPolicy(name) {
  const principal = `skill:${name}`;
  return {
    version: 1,
    default: 'deny',
    rules: [
      { effect: 'allow', action: 'query', principal, kind: 'chunk' },
      { effect: 'allow', action: 'read', principal, kind: 'chunk' },
    ],
  };
}

async function listKnowledge(dir) {
  const root = path.join(dir, 'knowledge');
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('SKILL_CHECK: knowledge/ must be a real directory.');
  }
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        throw new Error(`SKILL_CHECK: refusing symlink ${entry.name}.`);
      }
      if (stat.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (stat.size > MAX_KNOWLEDGE_BYTES) {
        throw new Error(`SKILL_CHECK: ${entry.name} is larger than 1 MiB.`);
      }
      const source = path.relative(root, full).split(path.sep).join('/');
      files.push({ full, source });
    }
  }
  await walk(root);
  if (files.length > MAX_KNOWLEDGE_FILES) {
    throw new Error(
      `SKILL_CHECK: a skill can contain ${MAX_KNOWLEDGE_FILES} knowledge files.`
    );
  }
  files.sort((left, right) => compareText(left.source, right.source));
  return files;
}

async function defaultQuery(files) {
  const text = (await readFile(files[0].full)).toString('utf8');
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3)
    .slice(0, 3);
  if (words.length === 0) {
    throw new Error(
      'SKILL_CHECK: pass --query. The first knowledge file has no words.'
    );
  }
  return words.join(' ');
}

function assertQuery(query) {
  if (
    typeof query !== 'string' ||
    !/^[\p{L}\p{N} ]+$/u.test(query) ||
    !query.trim()
  ) {
    throw new Error('SKILL_CHECK: --query must be words separated by spaces.');
  }
}

async function writePack(out, built) {
  await writePackFiles(out, {
    manifestBytes: built.manifestBytes,
    skillBytes: built.skillBytes,
    policyBytes: built.policyBytes,
    imageBytes: built.imageBytes,
  });
}

async function writePackFiles(out, pack) {
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'manifest.json'), pack.manifestBytes, {
    mode: 0o644,
  });
  await writeFile(path.join(out, 'SKILL.md'), pack.skillBytes, { mode: 0o644 });
  await writeFile(path.join(out, 'policy.json'), pack.policyBytes, {
    mode: 0o644,
  });
  if (pack.imageBytes) {
    await writeFile(path.join(out, 'knowledge.v5'), pack.imageBytes, {
      mode: 0o644,
    });
  }
}

async function readVerifiedPack(packDir) {
  let manifestBytes;
  let skillBytes;
  let policyBytes;
  try {
    manifestBytes = await readFile(path.join(packDir, 'manifest.json'));
    skillBytes = await readFile(path.join(packDir, 'SKILL.md'));
    policyBytes = await readFile(path.join(packDir, 'policy.json'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const missing = new Error(`SKILL_HUB: no skill pack at ${packDir}.`);
      missing.code = 'ENOENT';
      throw missing;
    }
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('SKILL_PIN: manifest.json is not valid JSON.');
  }
  if (!manifest || manifest.format !== SKILL_PACK_FORMAT) {
    throw new Error('SKILL_PIN: manifest format is not a Knolo skill pack.');
  }
  const nameError = skillNameError(manifest.name);
  if (nameError) throw new Error(nameError);
  if (sha256(skillBytes) !== manifest.skillSha256) {
    throw new Error('SKILL_PIN: SKILL.md does not match its SHA-256 pin.');
  }
  if (sha256(policyBytes) !== manifest.policySha256) {
    throw new Error('SKILL_PIN: policy.json does not match its SHA-256 pin.');
  }
  const parsed = parseSkill(skillBytes.toString('utf8'));
  if (
    parsed.name !== manifest.name ||
    parsed.description !== manifest.description
  ) {
    throw new Error(
      'SKILL_PIN: SKILL.md does not match the manifest name and description.'
    );
  }
  const policy = parsePolicy(policyBytes);
  let imageBytes = null;
  if (manifest.image) {
    try {
      imageBytes = await readFile(path.join(packDir, 'knowledge.v5'));
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error('SKILL_PIN: knowledge.v5 is missing.');
      }
      throw error;
    }
    if (sha256(imageBytes) !== manifest.image.sha256) {
      throw new Error(
        'SKILL_PIN: knowledge.v5 does not match its SHA-256 pin.'
      );
    }
    const core = await loadCore();
    let opened;
    try {
      opened = core.mountKnowledgeImageV5(imageBytes);
    } catch {
      throw new Error('SKILL_PIN: knowledge.v5 is not a V5 Knowledge Image.');
    }
    if (opened.stateRoot !== manifest.image.stateRoot) {
      throw new Error('SKILL_PIN: knowledge.v5 does not match its state root.');
    }
    let policyRoot;
    try {
      policyRoot = core.knowledgePolicyRootV5(policy);
    } catch {
      throw new Error('SKILL_PIN: policy.json is not a V5 policy.');
    }
    if (opened.commit.policyRoot !== policyRoot) {
      throw new Error(
        'SKILL_PIN: policy.json does not match the image policy root.'
      );
    }
  } else {
    try {
      await lstat(path.join(packDir, 'knowledge.v5'));
      throw new Error(
        'SKILL_PIN: knowledge.v5 is present but the manifest has no image pin.'
      );
    } catch (error) {
      if (!(error && error.code === 'ENOENT')) throw error;
    }
  }
  assertNoHost(manifestBytes.toString('utf8'));
  return { manifest, manifestBytes, skillBytes, policyBytes, imageBytes };
}

function packSummary(built, out) {
  return {
    ok: true,
    name: built.manifest.name,
    out,
    skillSha256: built.manifest.skillSha256,
    image: built.manifest.image,
    receiptId: built.receiptId,
  };
}

function sameImage(left, right) {
  if (left === null || right === null) return left === right;
  return left.sha256 === right.sha256 && left.stateRoot === right.stateRoot;
}

function assertNoHost(text) {
  if (ABSOLUTE_PATH.test(text) || text.includes('managed-skills')) {
    throw new Error(
      'SKILL_PACK: the pack names a home directory or a host layout.'
    );
  }
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function rejectHostPath(target) {
  const home = process.env.HOME;
  if (home && (target === home || target.startsWith(`${home}${path.sep}`))) {
    // A user can install into a directory under their home. The pack itself
    // must not record that path. This check only rejects the home directory
    // as the catalog or install root.
    if (target === home) {
      throw new Error(
        'SKILL_PACK: pass a directory inside the destination, not the home directory itself.'
      );
    }
  }
}

function parsePolicy(policyBytes) {
  try {
    const policy = JSON.parse(policyBytes.toString('utf8'));
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new Error('not an object');
    }
    return policy;
  } catch {
    throw new Error('SKILL_PIN: policy.json is not valid JSON.');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadCore() {
  const candidates = [
    path.resolve(__dirname, '../../core/dist/index.js'),
    '@knolo/core',
  ];
  for (const candidate of candidates) {
    try {
      const href = candidate.startsWith('@')
        ? candidate
        : pathToFileURL(candidate).href;
      const loaded = await import(href);
      if (
        loaded.createKnowledgeImageV5 &&
        loaded.queryKnowledgeImageV5 &&
        loaded.mountKnowledgeImageV5 &&
        loaded.knowledgePolicyRootV5
      ) {
        return loaded;
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Could not load @knolo/core. Build packages/core first.');
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      flags[key] = value;
      index += 1;
    } else positionals.push(arg);
  }
  return { positionals, flags };
}
