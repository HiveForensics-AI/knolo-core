import { createHash } from 'node:crypto';
import {
  normalizeRegistryUrl,
  registryApiUrl,
  resolveRegistryUrl,
} from './config.mjs';
import { normalizeCategories } from './categories.mjs';
import { loadCredentials } from './credentials.mjs';
import { RegistryError, RegistryNetworkError } from './errors.mjs';
import { postJson } from './http.mjs';

export const DEFAULT_MODEL_BASE_URL = 'http://127.0.0.1:11434/v1';
export const ASK_SYSTEM_PROMPT =
  'Answer only from the excerpts and any skill instructions in the prompt. Cite each knowledge claim with publisher/slug@version and the object id. Cite a skill as publisher/name. Do not use outside knowledge.';

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function excerptDigest(excerpt) {
  return createHash('sha256').update(excerpt, 'utf8').digest('hex');
}

export function citation(hit) {
  return `${hit.publisher}/${hit.slug}@${hit.version} ${hit.objectId}`;
}

export function normalizeModelBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Model base URL must be an HTTP(S) URL.');
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Invalid model base URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Model base URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('Model base URL must not include credentials.');
  }
  url.search = '';
  url.hash = '';
  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname === '/' ? '' : pathname}`;
}

export function chatCompletionsUrl(baseUrl) {
  return `${normalizeModelBaseUrl(baseUrl)}/chat/completions`;
}

export function parseAskArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--evidence') {
      flags.evidence = true;
      continue;
    }
    if (arg === '--all') {
      flags.all = true;
      continue;
    }
    if (arg === '--category') {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Missing value for --category');
      }
      flags.categories = [...(flags.categories ?? []), value];
      continue;
    }
    if (['--model', '--base-url', '--limit', '--hub', '--registry'].includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      if (arg === '--hub' || arg === '--registry') flags.hub = value;
      else flags[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown flag for ask: ${arg}`);
    positional.push(arg);
  }

  const question = positional.join(' ').trim();
  if (!question) {
    throw new Error(
      'Usage: knolo ask "<question>" [--category <id>] [--all] [--model <name>] [--base-url <url>] [--limit <n>] [--evidence] [--hub <url>]'
    );
  }
  if (flags.all && flags.categories) {
    throw new Error('Use either --all or --category, not both.');
  }
  if (!flags.all && !flags.categories) {
    throw new Error('Pick one category with --category, or pass --all to search the entire hub.');
  }
  if (flags.categories) {
    flags.categories = normalizeCategories(flags.categories, { min: 1, max: 8 });
  }
  if (flags.limit !== undefined) {
    if (!/^[1-9]\d*$/.test(flags.limit)) {
      throw new Error('--limit must be an integer from 1 to 20.');
    }
    const limit = Number(flags.limit);
    if (limit < 1 || limit > 20) {
      throw new Error('--limit must be an integer from 1 to 20.');
    }
    flags.limit = limit;
  }
  return { question, flags };
}

function modelName(flags, env) {
  const name = flags.model || env.KNOLO_MODEL;
  return typeof name === 'string' && name.trim() ? name.trim() : '';
}

function modelBase(flags, env) {
  return normalizeModelBaseUrl(
    flags['base-url'] || env.KNOLO_MODEL_BASE_URL || DEFAULT_MODEL_BASE_URL
  );
}

async function hubToken(registry, { env, homeDir }) {
  try {
    const credentials = await loadCredentials({ env, homeDir });
    if (normalizeRegistryUrl(credentials.registry) !== normalizeRegistryUrl(registry)) {
      return undefined;
    }
    return credentials.token;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Not logged in')) {
      return undefined;
    }
    throw error;
  }
}

function asHit(value) {
  if (!value || typeof value !== 'object') return null;
  const hit = value;
  if (typeof hit.publisher !== 'string' || !hit.publisher.trim()) return null;
  if (typeof hit.slug !== 'string' || !hit.slug.trim()) return null;
  if (typeof hit.version !== 'string' || !hit.version.trim()) return null;
  if (typeof hit.objectId !== 'string' || !hit.objectId.trim()) return null;
  if (typeof hit.excerpt !== 'string' || !hit.excerpt) return null;
  if (typeof hit.excerptSha256 !== 'string' || !SHA256_HEX.test(hit.excerptSha256.toLowerCase())) {
    return null;
  }
  if (excerptDigest(hit.excerpt) !== hit.excerptSha256.toLowerCase()) return null;
  return {
    publisher: hit.publisher,
    slug: hit.slug,
    version: hit.version,
    objectId: hit.objectId,
    heading: typeof hit.heading === 'string' ? hit.heading : '',
    excerpt: hit.excerpt,
    excerptSha256: hit.excerptSha256.toLowerCase(),
  };
}

export function verifiedHits(hits) {
  if (!Array.isArray(hits)) return [];
  return hits.map(asHit).filter((hit) => hit !== null);
}

function asSkill(value) {
  if (!value || typeof value !== 'object') return null;
  const skill = value;
  if (typeof skill.publisher !== 'string' || !skill.publisher.trim()) return null;
  if (typeof skill.name !== 'string' || !skill.name.trim()) return null;
  if (typeof skill.excerpt !== 'string' || !skill.excerpt) return null;
  if (typeof skill.excerptSha256 !== 'string' || !SHA256_HEX.test(skill.excerptSha256.toLowerCase())) {
    return null;
  }
  if (excerptDigest(skill.excerpt) !== skill.excerptSha256.toLowerCase()) return null;
  if (typeof skill.skillSha256 !== 'string' || !SHA256_HEX.test(skill.skillSha256.toLowerCase())) {
    return null;
  }
  return {
    publisher: skill.publisher,
    name: skill.name,
    description: typeof skill.description === 'string' ? skill.description : '',
    excerpt: skill.excerpt,
    excerptSha256: skill.excerptSha256.toLowerCase(),
    skillSha256: skill.skillSha256.toLowerCase(),
  };
}

export function verifiedSkills(skills) {
  if (!Array.isArray(skills)) return [];
  return skills.map(asSkill).filter((skill) => skill !== null);
}

function printEvidence(skills, hits, print) {
  for (const skill of skills) {
    print(`${skill.publisher}/${skill.name}`);
    if (skill.description) print(skill.description);
    print(skill.excerpt);
    print(skill.excerptSha256);
    print('');
  }
  for (const hit of hits) {
    print(citation(hit));
    if (hit.heading) print(hit.heading);
    print(hit.excerpt);
    print(hit.excerptSha256);
    print('');
  }
}

function answerText(body) {
  const content = body?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

/**
 * Queries Hub, checks excerpt hashes, then asks the user's chat endpoint.
 * The model key is sent only to that endpoint. Hub never receives it.
 */
export async function runHubAsk(
  args,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    homeDir,
    print = console.log,
    printError = console.error,
  } = {}
) {
  const { question, flags } = parseAskArgs(args);
  const model = modelName(flags, env);
  if (!flags.evidence && !model) {
    throw new Error(
      'Set --model or KNOLO_MODEL. Use --evidence to print Hub excerpts without a model.'
    );
  }

  const registry = resolveRegistryUrl({ value: flags.hub, env });
  const url = registryApiUrl(registry, ['knowledge', 'query']);
  const token = await hubToken(registry, { env, homeDir });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const body = { q: question };
  if (flags.limit !== undefined) body.limit = flags.limit;
  if (flags.categories) body.categories = flags.categories;

  let response;
  try {
    response = await postJson(url, body, { fetchImpl, headers });
  } catch (error) {
    // A 402 plan_limit is a RegistryError. Do not call the model.
    const message = error instanceof RegistryNetworkError || error instanceof RegistryError
      ? error.message
      : 'Could not query Hub.';
    printError(message);
    return { exitCode: 1, registry, calls: 1 };
  }

  const hits = verifiedHits(response?.hits);
  const skills = verifiedSkills(response?.skills);
  if (!hits.length && !skills.length) {
    printError('Hub has no matching evidence.');
    return { exitCode: 1, registry, calls: 1 };
  }

  if (flags.evidence) {
    printEvidence(skills, hits, print);
    return { exitCode: 0, registry, hits, skills, calls: 1 };
  }

  const baseUrl = modelBase(flags, env);
  const endpoint = chatCompletionsUrl(baseUrl);
  const apiKey = typeof env.KNOLO_MODEL_API_KEY === 'string' ? env.KNOLO_MODEL_API_KEY.trim() : '';
  const modelHeaders = { 'content-type': 'application/json' };
  if (apiKey) modelHeaders.authorization = `Bearer ${apiKey}`;
  const promptParts = [`Question: ${question}`, ''];
  if (skills.length) {
    promptParts.push(
      'Skills:',
      ...skills.map((skill) => `Skill: ${skill.publisher}/${skill.name}\n${skill.description}\n${skill.excerpt}`),
      ''
    );
  }
  if (hits.length) {
    promptParts.push(
      'Excerpts:',
      ...hits.map((hit) => `Source: ${citation(hit)}\nHeading: ${hit.heading}\n${hit.excerpt}`)
    );
  }
  const prompt = promptParts.join('\n');

  let modelResponse;
  try {
    modelResponse = await fetchImpl(endpoint, {
      method: 'POST',
      headers: modelHeaders,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ASK_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });
  } catch {
    printError('Model endpoint is unavailable. Excerpts follow.');
    printEvidence(skills, hits, print);
    return { exitCode: 2, registry, hits, skills, calls: 2 };
  }

  let modelBody;
  try {
    const text = typeof modelResponse?.text === 'function' ? await modelResponse.text() : '';
    modelBody = text ? JSON.parse(text) : undefined;
  } catch {
    modelBody = undefined;
  }

  const answer = modelResponse?.ok ? answerText(modelBody) : '';
  if (!answer) {
    const status = typeof modelResponse?.status === 'number' ? modelResponse.status : 'error';
    printError(`Model endpoint returned HTTP ${status}. Excerpts follow.`);
    printEvidence(skills, hits, print);
    return { exitCode: 2, registry, hits, skills, calls: 2 };
  }

  print(answer);
  print('');
  print('Citations:');
  for (const skill of skills) print(`${skill.publisher}/${skill.name}`);
  for (const hit of hits) print(citation(hit));
  return { exitCode: 0, registry, hits, skills, calls: 2 };
}
