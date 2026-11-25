/**
 * knolo persona init | build | verify | eval
 *
 * A persona pack is a V5 Knowledge Image. Knolo core does not call a model.
 * The host owns the model. A receipt is an integrity check.
 * A KITE verdict describes the contract. It does not mean a claim is true.
 */
import crypto from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCoreModule } from './load-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTENSIONS = new Set(['.md', '.txt', '.json']);
const SKIP_FILES = new Set(['consent.json', 'fixtures.json', 'creator-private.pem']);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const ACTOR = 'knolo-persona';
const ALLOWED_USE = "A chatbot that speaks in this creator's voice.";
const DISCLOSURE = 'This chatbot is AI and is not the creator.';
const BOUNDARY_LINES = [
  'Do not discuss banned topics.',
  'Do not claim to be the human creator.',
  'Do not invent prices, availability, or offers.',
];
const CONTRACT = {
  format: 'knolo-kite-contract-1',
  question: 'Does this pack state its disclosure and hard boundaries?',
  obligations: [
    { id: 'disclosure', kind: 'evidence', term: 'chatbot' },
    { id: 'identity', kind: 'qualification', term: 'human creator' },
    { id: 'prices', kind: 'authority', term: 'invent prices' },
    { id: 'topics', kind: 'qualification', term: 'banned topics' },
  ],
};
const RULES = {
  format: 'knolo-kite-rules-1',
  proposition: 'The pack states its disclosure and hard boundaries.',
  support: [],
  oppose: [],
  require: ['disclosure', 'identity', 'prices', 'topics'],
  conflicts: [],
  completeness: [],
};

const USAGE = `Usage: knolo persona <init|build|verify|eval> [options]

  knolo persona init <name> [--dir <parent>]
  knolo persona build <dir> [--out <file>] [--json]
  knolo persona verify <image> [--withdrawn <id>] [--json]
  knolo persona eval <image> --fixtures <file> [--json]

Builds a persona pack on the current V5 image.
Knolo core does not call a model. The host owns the model.
A receipt is an integrity check. It does not mean a claim is proven.
SATISFIED means the evidence requirements were met.
A KITE verdict describes the contract. It does not mean the claim is true.
verify fails when a withdrawn source id is still in the image.
An opt-out rebuild drops that file and produces a new pin.`;

const RECEIPT_NOTE =
  'A receipt is an integrity check. It does not mean a claim is proven.';

export async function runPersonaCli(argv) {
  const { positionals, flags } = parseArgs(argv);
  const sub = positionals[0] ?? '';
  if (!sub || sub === 'help' || flags.help) {
    console.log(USAGE);
    return;
  }
  if (sub === 'init') return initPersona(positionals[1], flags);
  if (sub === 'build') return buildCommand(positionals[1], flags);
  if (sub === 'verify') return verifyCommand(positionals[1], flags);
  if (sub === 'eval') return evalCommand(positionals[1], flags);
  throw new Error(`Unknown persona command "${sub}".\n${USAGE}`);
}

/**
 * Mounts a local persona image, checks exemplars and KITE boundaries, then
 * calls the host chat endpoint only when those checks pass.
 * --evidence prints excerpts and does not call a model.
 */
export async function answerPersona(
  argv,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    print = console.log,
    printError = console.error,
  } = {}
) {
  const flags = parseChatArgs(argv);
  if (flags.help) {
    print(chatUsage());
    return { exitCode: 0, modelCalled: false };
  }
  let inspected;
  try {
    const bytes = await readUserFile(flags.image, MAX_IMAGE_BYTES);
    inspected = await inspectPersona(bytes, {
      withdrawn: [],
      failWithdrawn: true,
      failUnmet: true,
    });
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return { exitCode: 1, modelCalled: false };
  }
  const prompt = flags.prompt ?? '';
  const banned = inspected.bannedTopics.find((topic) =>
    mentionsTopic(prompt, topic)
  );
  if (banned) {
    printError(`blocked banned topic: ${banned}`);
    return { exitCode: 1, modelCalled: false };
  }
  let exemplars;
  try {
    exemplars = retrieveExemplars(inspected, flags.situation, prompt).map(checkedExcerpt);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return { exitCode: 1, modelCalled: false };
  }
  if (exemplars.length === 0) {
    printError('missing evidence');
    return { exitCode: 1, modelCalled: false };
  }
  if (flags.evidence) {
    printEvidence(inspected, exemplars, print);
    return { exitCode: 0, modelCalled: false, exemplars };
  }
  const model = flags.model || env.KNOLO_MODEL;
  if (!model) {
    printError(
      'Set --model or KNOLO_MODEL. Use --evidence to print excerpts without a model.'
    );
    return { exitCode: 1, modelCalled: false };
  }
  const base = (flags.baseUrl || env.KNOLO_MODEL_BASE_URL || 'http://127.0.0.1:11434/v1').replace(
    /\/$/u,
    ''
  );
  const headers = { 'content-type': 'application/json' };
  const apiKey =
    typeof env.KNOLO_MODEL_API_KEY === 'string' ? env.KNOLO_MODEL_API_KEY.trim() : '';
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  let modelResponse;
  try {
    modelResponse = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt(inspected) },
          { role: 'user', content: userPrompt(prompt, inspected, exemplars) },
        ],
      }),
    });
  } catch {
    printError('Model endpoint is unavailable.');
    return { exitCode: 2, modelCalled: true };
  }
  const answer = await readModelAnswer(modelResponse);
  if (!answer) {
    printError('Model endpoint returned no reply.');
    return { exitCode: 2, modelCalled: true };
  }
  if (!answer.includes(inspected.disclosure)) {
    printError('refusing reply that omits the disclosure line');
    return { exitCode: 1, modelCalled: true };
  }
  const leaked = inspected.bannedTopics.find((topic) => mentionsTopic(answer, topic));
  if (leaked) {
    printError(`refusing reply that discusses banned topic: ${leaked}`);
    return { exitCode: 1, modelCalled: true };
  }
  print(answer);
  print('');
  print('Citations:');
  for (const excerpt of exemplars) print(`${excerpt.source} ${excerpt.digest}`);
  print(RECEIPT_NOTE);
  return { exitCode: 0, modelCalled: true, exemplars };
}

function chatUsage() {
  return `Usage: node examples/persona-chat/chat.mjs <image> --situation <id> --prompt <text> [--evidence] [--model <name>] [--base-url <url>]

The host owns the model. Knolo core does not call a model.
--evidence prints excerpts and does not call a model.
A missing exemplar or an unmet obligation does not call a model.
A reply that omits the disclosure line is refused.`;
}

async function initPersona(name, flags) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new Error(
      'PERSONA_NAME: use lowercase letters, digits, and single hyphens.'
    );
  }
  const parent = path.resolve(process.cwd(), flags.dir ?? '.');
  const dir = path.join(parent, name);
  try {
    await lstat(dir);
    throw new Error('persona directory already exists.');
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  await mkdir(path.join(dir, 'exemplars'), { recursive: true });
  const profile = {
    name,
    tone: 'warm and direct',
    typicalLength: 'two short sentences',
    emoji: 'rare',
    preferredSlang: [],
    avoidedSlang: [],
    catchphrases: ['glad you asked'],
    formality: 'casual',
    languages: ['en'],
  };
  const boundaries = {
    bannedTopics: ['payroll'],
    lines: BOUNDARY_LINES,
  };
  const consent = {
    format: 'knolo-persona-consent-1',
    allowedUse: ALLOWED_USE,
    training: false,
    publicKey: publicPem,
    withdrawn: [],
    sources: [
      { id: 'boundaries.json', owner: 'creator', role: 'boundaries' },
      { id: 'disclosure.txt', owner: 'creator', role: 'disclosure' },
      {
        id: 'exemplars/faq.md',
        owner: 'creator',
        role: 'exemplar',
        situation: 'faq',
      },
      {
        id: 'exemplars/greeting.md',
        owner: 'creator',
        role: 'exemplar',
        situation: 'greeting',
      },
      { id: 'persona.json', owner: 'creator', role: 'profile' },
    ],
  };
  const fixtures = {
    cases: [
      {
        situation: 'greeting',
        creator: 'Hey, glad you asked.',
        bot: `Hey, glad you asked. ${DISCLOSURE}`,
      },
      {
        situation: 'faq',
        creator: 'Glad you asked. The short answer stays on the pinned page.',
        bot: `Glad you asked. The short answer stays on the pinned page. ${DISCLOSURE}`,
      },
    ],
  };
  await writeFile(path.join(dir, 'persona.json'), pretty(profile), { mode: 0o644 });
  await writeFile(path.join(dir, 'disclosure.txt'), `${DISCLOSURE}\n`, { mode: 0o644 });
  await writeFile(path.join(dir, 'boundaries.json'), pretty(boundaries), { mode: 0o644 });
  await writeFile(
    path.join(dir, 'exemplars', 'greeting.md'),
    'Situation: greeting\n\nHey, glad you asked.\n',
    { mode: 0o644 }
  );
  await writeFile(
    path.join(dir, 'exemplars', 'faq.md'),
    'Situation: faq\n\nGlad you asked. The short answer stays on the pinned page.\n',
    { mode: 0o644 }
  );
  await writeFile(path.join(dir, 'consent.json'), pretty(consent), { mode: 0o644 });
  await writeFile(path.join(dir, 'fixtures.json'), pretty(fixtures), { mode: 0o644 });
  await writeFile(path.join(dir, 'creator-private.pem'), privatePem, { mode: 0o600 });
  if (flags.json) console.log(JSON.stringify({ ok: true, name }));
  else console.log(`wrote ${name}`);
}

async function buildCommand(dirArg, flags) {
  const dir = resolveDir(dirArg);
  const built = await buildPersonaPack(dir);
  const name = built.profile.name;
  const out = flags.out
    ? path.resolve(process.cwd(), flags.out)
    : path.join(dir, 'dist', `${name}.knolo`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, built.bytes);
  const body = {
    ok: true,
    name,
    stateRoot: built.stateRoot,
    sha256: sha256(built.bytes),
    out: flags.out ?? path.join('dist', `${name}.knolo`),
    note: RECEIPT_NOTE,
  };
  if (flags.json) console.log(JSON.stringify(body));
  else {
    console.log(`stateRoot ${built.stateRoot}`);
    console.log(`wrote ${body.out}`);
    console.log(RECEIPT_NOTE);
  }
}

async function verifyCommand(imageArg, flags) {
  const bytes = await readUserFile(imageArg, MAX_IMAGE_BYTES);
  const inspected = await inspectPersona(bytes, {
    withdrawn: flags.withdrawn,
    failWithdrawn: true,
    failUnmet: true,
  });
  const body = {
    ok: true,
    stateRoot: inspected.image.stateRoot,
    verdict: inspected.kite.verdict,
    unmet: inspected.kite.unmet.map((item) => item.id),
    note: RECEIPT_NOTE,
  };
  if (flags.json) console.log(JSON.stringify(body));
  else {
    console.log(`ok ${body.stateRoot}`);
    console.log(`verdict ${body.verdict}`);
    console.log(RECEIPT_NOTE);
    console.log(
      'A KITE verdict describes the contract. It does not mean the claim is true.'
    );
  }
}

async function evalCommand(imageArg, flags) {
  if (!flags.fixtures) throw new Error(`Missing --fixtures.\n${USAGE}`);
  const bytes = await readUserFile(imageArg, MAX_IMAGE_BYTES);
  const inspected = await inspectPersona(bytes, {
    withdrawn: [],
    failWithdrawn: true,
    failUnmet: true,
  });
  const fixtures = JSON.parse(
    (await readUserFile(flags.fixtures, MAX_FILE_BYTES)).toString('utf8')
  );
  const result = scoreFixtures(inspected, fixtures);
  const body = {
    ok: true,
    score: result.score,
    stateRoot: inspected.image.stateRoot,
    receiptId: result.receiptId,
    excerpts: result.excerpts,
    note: RECEIPT_NOTE,
  };
  if (flags.json) console.log(JSON.stringify(body));
  else {
    console.log(`score ${result.score.toFixed(4)}`);
    console.log(`stateRoot ${body.stateRoot}`);
    console.log(`receipt ${body.receiptId}`);
    console.log(`excerpts ${body.excerpts.join(' ')}`);
    console.log(RECEIPT_NOTE);
  }
}

export async function buildPersonaPack(dir, { checkObligations = true } = {}) {
  const files = await listPackFiles(dir);
  const consentFile = JSON.parse(
    (await readUserFile(path.join(dir, 'consent.json'), MAX_FILE_BYTES)).toString('utf8')
  );
  const profile = JSON.parse(
    (await readFile(path.join(dir, 'persona.json'))).toString('utf8')
  );
  if (!profile || typeof profile.name !== 'string' || !NAME.test(profile.name)) {
    throw new Error(
      'PERSONA_NAME: use lowercase letters, digits, and single hyphens.'
    );
  }
  validateConsent(consentFile, files);
  const signed = await signConsent(dir, consentFile);
  const byId = new Map(signed.sources.map((source) => [source.id, source]));
  const objects = [];
  for (const file of files) {
    const entry = byId.get(file.source);
    const bytes = await readFile(file.full);
    const meta = {
      namespace: profile.name,
      persona: profile.name,
      source: file.source,
      role: entry.role,
    };
    if (typeof entry.situation === 'string' && entry.situation) {
      meta.situation = entry.situation;
    }
    objects.push({ kind: 'chunk', bytes, meta });
  }
  // KITE searches chunk text. Contract, rules, and consent stay metadata so
  // their own terms cannot satisfy the obligations.
  objects.push(metadataObject(profile.name, 'kite-contract', 'contract', CONTRACT));
  objects.push(metadataObject(profile.name, 'kite-rules', 'rules', RULES));
  objects.push(metadataObject(profile.name, 'consent.json', 'consent', signed));
  const core = await loadCore();
  const image = core.createKnowledgeImageV5({
    actor: ACTOR,
    policy: personaPolicy(profile.name),
    objects,
  });
  if (checkObligations) {
    await inspectPersona(image.bytes, {
      withdrawn: [],
      failWithdrawn: false,
      failUnmet: true,
    });
  }
  return {
    bytes: Buffer.from(image.bytes),
    stateRoot: image.stateRoot,
    profile,
  };
}

async function inspectPersona(bytes, { withdrawn, failWithdrawn, failUnmet }) {
  const core = await loadCore();
  const kite = await loadKite();
  const image = core.mountKnowledgeImageV5(bytes);
  const consentObject = objectByRole(image, 'consent');
  const contractObject = objectByRole(image, 'contract');
  const rulesObject = objectByRole(image, 'rules');
  const consent = JSON.parse(Buffer.from(consentObject.bytes).toString('utf8'));
  assertSignature(consent);
  const contract = JSON.parse(Buffer.from(contractObject.bytes).toString('utf8'));
  const rules = JSON.parse(Buffer.from(rulesObject.bytes).toString('utf8'));
  const extra = Array.isArray(withdrawn) ? withdrawn : [];
  const withdrawnIds = new Set([...(consent.withdrawn ?? []), ...extra]);
  if (failWithdrawn) {
    for (const object of image.objects) {
      const source = object.meta?.source;
      if (typeof source === 'string' && withdrawnIds.has(source)) {
        throw new Error(`withdrawn source is still present: ${source}`);
      }
    }
  }
  const session = kite.createKiteSession({
    image: image.bytes,
    contract,
    rules,
  });
  const result = await kite.evaluateKiteSession(session);
  if (failUnmet && result.unmet.length > 0) {
    throw new Error(
      `unmet obligations: ${result.unmet.map((item) => item.id).join(', ')}`
    );
  }
  const verified = await kite.verifyKiteCertificate({
    image: image.bytes,
    contract,
    rules,
    certificate: result.certificate,
  });
  if (!verified.ok) throw new Error(`${verified.code}: ${verified.message}`);
  const disclosure = textOfRole(image, 'disclosure').trim();
  const profile = JSON.parse(textOfRole(image, 'profile'));
  const boundaries = JSON.parse(textOfRole(image, 'boundaries'));
  return {
    image,
    query: core.queryKnowledgeImageV5,
    disclosure,
    profile,
    bannedTopics: Array.isArray(boundaries.bannedTopics) ? boundaries.bannedTopics : [],
    kite: result,
  };
}

function objectByRole(image, role) {
  const found = image.objects.find(
    (object) => object.meta && object.meta.role === role
  );
  if (!found) throw new Error(`PERSONA_PACK: missing ${role}.`);
  return found;
}

function textOfRole(image, role) {
  const found = image.objects.find(
    (object) => object.kind === 'chunk' && object.meta && object.meta.role === role
  );
  if (!found) throw new Error(`PERSONA_PACK: missing ${role}.`);
  return Buffer.from(found.bytes).toString('utf8');
}

function metadataObject(name, source, role, value) {
  return {
    kind: 'metadata',
    bytes: Buffer.from(`${canonical(value)}\n`),
    meta: { namespace: name, persona: name, source, role },
  };
}

function personaPolicy(name) {
  const principal = `persona:${name}`;
  return {
    version: 1,
    default: 'deny',
    rules: [
      { effect: 'allow', action: 'query', principal, kind: 'chunk' },
      { effect: 'allow', action: 'read', principal, kind: 'chunk' },
      { effect: 'allow', action: 'query', principal, kind: 'metadata' },
      { effect: 'allow', action: 'read', principal, kind: 'metadata' },
    ],
  };
}

function validateConsent(consent, files) {
  if (!consent || consent.format !== 'knolo-persona-consent-1') {
    throw new Error('PERSONA_PACK: consent format is not knolo-persona-consent-1.');
  }
  if (consent.training !== false) {
    throw new Error('PERSONA_PACK: a persona pack cannot train or fine-tune a model.');
  }
  if (typeof consent.allowedUse !== 'string' || !consent.allowedUse.trim()) {
    throw new Error('PERSONA_PACK: consent needs an allowed use.');
  }
  if (typeof consent.publicKey !== 'string' || !consent.publicKey.includes('PUBLIC KEY')) {
    throw new Error('invalid creator signature');
  }
  if (!Array.isArray(consent.withdrawn) || !Array.isArray(consent.sources)) {
    throw new Error('PERSONA_PACK: consent needs sources and withdrawn.');
  }
  const byId = new Map();
  for (const source of consent.sources) {
    if (!source || typeof source.id !== 'string' || typeof source.role !== 'string') {
      throw new Error('PERSONA_PACK: a consent source needs an id and a role.');
    }
    if (byId.has(source.id)) {
      throw new Error(`PERSONA_PACK: duplicate consent source ${source.id}.`);
    }
    byId.set(source.id, source);
    if (source.owner === 'third-party' || source.role === 'correspondence') {
      if (!validConsentRecord(source.consentRecord)) {
        throw new Error(
          `third-party correspondence without a consent record: ${source.id}`
        );
      }
    }
  }
  for (const file of files) {
    if (!byId.has(file.source)) throw new Error(`missing consent record: ${file.source}`);
  }
  for (const source of consent.sources) {
    if (!files.some((file) => file.source === source.id)) {
      throw new Error(`PERSONA_PACK: consent lists missing source ${source.id}.`);
    }
  }
}

function validConsentRecord(record) {
  return Boolean(
    record &&
      typeof record === 'object' &&
      typeof record.party === 'string' &&
      record.party.trim() &&
      typeof record.allows === 'string' &&
      record.allows.trim()
  );
}

async function signConsent(dir, consent) {
  const keyPath = path.join(dir, 'creator-private.pem');
  let pem;
  try {
    const stat = await lstat(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
      throw new Error('missing creator signature');
    }
    pem = await readFile(keyPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('missing creator signature');
    if (error instanceof Error && error.message === 'missing creator signature') throw error;
    throw error;
  }
  const signed = normalizeConsent(consent);
  const digest = crypto.createHash('sha256').update(canonical(signed)).digest();
  let signature;
  try {
    signature = crypto.sign(null, digest, pem.toString('utf8'));
  } catch {
    throw new Error('invalid creator signature');
  }
  if (!signatureValid(digest, signed.publicKey, signature)) {
    throw new Error('invalid creator signature');
  }
  return { ...signed, signature: signature.toString('base64') };
}

function assertSignature(stored) {
  if (!stored || typeof stored.signature !== 'string') {
    throw new Error('invalid creator signature');
  }
  const signature = Buffer.from(stored.signature, 'base64');
  const body = normalizeConsent(stored);
  const digest = crypto.createHash('sha256').update(canonical(body)).digest();
  if (!signatureValid(digest, body.publicKey, signature)) {
    throw new Error('invalid creator signature');
  }
}

function signatureValid(digest, publicKey, signature) {
  try {
    return crypto.verify(null, digest, publicKey, signature) === true;
  } catch {
    return false;
  }
}

function normalizeConsent(consent) {
  const body = JSON.parse(JSON.stringify(consent));
  delete body.signature;
  body.sources = [...body.sources].sort((left, right) => compareText(left.id, right.id));
  body.withdrawn = [...new Set(body.withdrawn)].sort(compareText);
  return body;
}

function retrieveExemplars(inspected, situation, prompt) {
  const query = situation || queryWords(prompt);
  if (!query) return [];
  return filterExemplars(
    inspected,
    `FROM chunk SEARCH ${JSON.stringify(query)} LIMIT 20`,
    situation
  );
}

function filterExemplars(inspected, expression, situation) {
  const result = inspected.query(inspected.image, expression);
  const found = new Set(result.hits.map((hit) => hit.objectId));
  return inspected.image.objects.filter(
    (object) =>
      found.has(object.id) &&
      object.kind === 'chunk' &&
      object.meta?.role === 'exemplar' &&
      (!situation || object.meta.situation === situation)
  );
}

function queryWords(prompt) {
  return prompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3)
    .slice(0, 3)
    .join(' ');
}

function checkedExcerpt(object) {
  const bytes = Buffer.from(object.bytes);
  const digest = `sha256-${sha256(bytes)}`;
  const excerpt = bytes.toString('utf8');
  const again = `sha256-${sha256(Buffer.from(excerpt, 'utf8'))}`;
  if (again !== digest) throw new Error('excerpt hash mismatch');
  return {
    id: object.id,
    source: object.meta.source,
    situation: object.meta.situation,
    excerpt,
    digest,
  };
}

function scoreFixtures(inspected, fixtures) {
  if (!fixtures || !Array.isArray(fixtures.cases) || fixtures.cases.length === 0) {
    throw new Error('PERSONA_EVAL: fixtures need cases.');
  }
  const catchphrases = Array.isArray(inspected.profile.catchphrases)
    ? inspected.profile.catchphrases
    : [];
  const scores = fixtures.cases.map((item) => {
    if (typeof item.creator !== 'string' || typeof item.bot !== 'string') {
      throw new Error('PERSONA_EVAL: each case needs creator and bot text.');
    }
    const length = lengthScore(item.creator, item.bot);
    const emoji = emojiScore(item.creator, item.bot);
    const greeting = edgeScore(item.creator, item.bot);
    const phrase = catchphraseScore(catchphrases, item.bot);
    const banned = inspected.bannedTopics.some((topic) => mentionsTopic(item.bot, topic))
      ? 0
      : 1;
    return (length + emoji + greeting + phrase + banned) / 5;
  });
  const score = round4(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  const excerpts = [];
  for (const item of fixtures.cases) {
    if (typeof item.situation !== 'string') continue;
    for (const object of filterExemplars(
      inspected,
      `FROM chunk SEARCH ${JSON.stringify(item.situation)} LIMIT 20`,
      item.situation
    )) {
      if (!excerpts.includes(object.id)) excerpts.push(object.id);
    }
  }
  excerpts.sort(compareText);
  const receiptId = `pr_${sha256(
    `${inspected.image.stateRoot}\n${excerpts.join(',')}\n${score.toFixed(4)}`
  ).slice(0, 24)}`;
  return { score, excerpts, receiptId };
}

function lengthScore(creator, bot) {
  const left = wordCount(creator);
  const right = wordCount(bot);
  if (left === 0 && right === 0) return 1;
  return Math.min(left, right) / Math.max(left, right);
}

function emojiScore(creator, bot) {
  return 1 - Math.min(1, Math.abs(emojiRate(creator) - emojiRate(bot)));
}

function edgeScore(creator, bot) {
  const greeting = edgeMatch(creator, bot, ['hey', 'hi', 'hello'], true);
  const signoff = edgeMatch(creator, bot, ['thanks', 'thank', 'bye', 'cheers'], false);
  return (greeting + signoff) / 2;
}

function edgeMatch(creator, bot, words, atStart) {
  const left = hasEdge(creator, words, atStart);
  const right = hasEdge(bot, words, atStart);
  return left === right ? 1 : 0;
}

function hasEdge(text, words, atStart) {
  const parts = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const word = atStart ? parts[0] : parts[parts.length - 1];
  return words.includes(word);
}

function catchphraseScore(phrases, bot) {
  if (phrases.length === 0) return 1;
  const haystack = bot.toLowerCase();
  const hits = phrases.filter(
    (phrase) => typeof phrase === 'string' && phrase && haystack.includes(phrase.toLowerCase())
  );
  return hits.length / phrases.length;
}

function wordCount(text) {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
}

function emojiRate(text) {
  const matches = text.match(/\p{Extended_Pictographic}/gu);
  return (matches ? matches.length : 0) / Math.max(text.length, 1);
}

function mentionsTopic(text, topic) {
  if (typeof topic !== 'string' || !topic.trim()) return false;
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function printEvidence(inspected, exemplars, print) {
  print(inspected.disclosure);
  print(`stateRoot ${inspected.image.stateRoot}`);
  for (const excerpt of exemplars) {
    print(`${excerpt.source} ${excerpt.digest}`);
    print(excerpt.excerpt.trim());
  }
  print(RECEIPT_NOTE);
}

function systemPrompt(inspected) {
  return [
    'Speak only from the verified excerpts and the persona profile.',
    `Include this disclosure line exactly: ${inspected.disclosure}`,
    'Do not invent prices, availability, or offers.',
    'Do not claim to be the human creator.',
    'The host owns the model. Knolo core does not call a model.',
  ].join('\n');
}

function userPrompt(prompt, inspected, exemplars) {
  return [
    `Profile: ${JSON.stringify(inspected.profile)}`,
    'Excerpts:',
    ...exemplars.map((excerpt) => `${excerpt.source}\n${excerpt.excerpt}`),
    `Question: ${prompt}`,
  ].join('\n');
}

async function readModelAnswer(modelResponse) {
  let modelBody;
  try {
    const text =
      typeof modelResponse?.text === 'function' ? await modelResponse.text() : '';
    modelBody = text ? JSON.parse(text) : undefined;
  } catch {
    modelBody = undefined;
  }
  const content = modelBody?.choices?.[0]?.message?.content;
  if (!modelResponse?.ok || typeof content !== 'string') return '';
  return content.trim();
}

async function listPackFiles(dir) {
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('PERSONA_PACK: expected a persona directory.');
  }
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const full = path.join(current, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        throw new Error(`PERSONA_PACK: refusing symlink ${entry.name}.`);
      }
      if (stat.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      const source = path.relative(dir, full).split(path.sep).join('/');
      if (SKIP_FILES.has(source)) continue;
      if (!EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`PERSONA_PACK: ${source} is larger than 1 MiB.`);
      }
      files.push({ full, source });
    }
  }
  await walk(dir);
  files.sort((left, right) => compareText(left.source, right.source));
  return files;
}

function canonical(value) {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return JSON.stringify(value);
  if (kind === 'number') {
    if (!Number.isFinite(value)) throw new Error('PERSONA_PACK: value is not canonical.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  if (kind === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareText);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('PERSONA_PACK: value is not canonical.');
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function resolveDir(dirArg) {
  if (!dirArg) throw new Error(`Missing persona directory.\n${USAGE}`);
  return path.resolve(process.cwd(), dirArg);
}

async function readUserFile(file, maxBytes) {
  if (!file) throw new Error('PERSONA_PACK: missing file.');
  const resolved = path.resolve(process.cwd(), file);
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PERSONA_PACK: expected a file.');
  if (stat.size > maxBytes) throw new Error('PERSONA_PACK: file is larger than the limit.');
  return readFile(resolved);
}

function parseArgs(argv) {
  const positionals = [];
  const flags = { withdrawn: [], json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--dir') flags.dir = takeValue(argv, ++index, '--dir');
    else if (arg === '--out') flags.out = takeValue(argv, ++index, '--out');
    else if (arg === '--fixtures') flags.fixtures = takeValue(argv, ++index, '--fixtures');
    else if (arg === '--withdrawn') flags.withdrawn.push(takeValue(argv, ++index, '--withdrawn'));
    else if (arg.startsWith('--')) throw new Error(`Unknown persona option "${arg}".\n${USAGE}`);
    else positionals.push(arg);
  }
  return { positionals, flags };
}

function parseChatArgs(argv) {
  const flags = { help: false, evidence: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--evidence') flags.evidence = true;
    else if (arg === '--situation') flags.situation = takeValue(argv, ++index, '--situation');
    else if (arg === '--prompt') flags.prompt = takeValue(argv, ++index, '--prompt');
    else if (arg === '--model') flags.model = takeValue(argv, ++index, '--model');
    else if (arg === '--base-url') flags.baseUrl = takeValue(argv, ++index, '--base-url');
    else if (arg.startsWith('--')) throw new Error(`Unknown persona option "${arg}".`);
    else positionals.push(arg);
  }
  flags.image = positionals[0];
  if (!flags.help && !flags.image) throw new Error(`Missing persona image.\n${chatUsage()}`);
  return flags;
}

function takeValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.\n${USAGE}`);
  return value;
}

function coreReady(loaded) {
  return Boolean(
    loaded?.createKnowledgeImageV5 &&
      loaded.queryKnowledgeImageV5 &&
      loaded.mountKnowledgeImageV5
  );
}

let corePromise;

function loadCore() {
  corePromise ??= loadCoreModule(
    [path.resolve(__dirname, '../../core/dist/index.js'), '@knolo/core'],
    coreReady
  ).catch((error) => {
    corePromise = undefined;
    const detail = error instanceof Error ? error.message : 'module did not export the Knowledge Image API';
    throw new Error(`Could not load @knolo/core. Build packages/core first. (${detail})`);
  });
  return corePromise;
}

function kiteReady(loaded) {
  return Boolean(
    loaded?.createKiteSession && loaded?.evaluateKiteSession && loaded?.verifyKiteCertificate
  );
}

async function loadKite() {
  const candidate = path.resolve(__dirname, '../../core/dist/kite/index.js');
  try {
    const loaded = await import(pathToFileURL(candidate).href);
    if (kiteReady(loaded)) return loaded;
  } catch {
    // An installed package does not have the checkout dist path.
  }
  try {
    const loaded = await import('@knolo/core/kite');
    if (kiteReady(loaded)) return loaded;
  } catch {
    // The package fallback is absent until core is installed.
  }
  throw new Error('Could not load @knolo/core/kite. Build packages/core first.');
}
