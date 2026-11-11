import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { defaultBoxConfig, type BoxConfig } from './config.js';
import { isDeniedInitPath } from './deny.js';
import { BoxError } from './errors.js';

export const WORKFLOW_CANDIDATES = [
  'agent-data/workflows',
  'sand-data/workflows',
] as const;

export const MANAGED_CANDIDATES = [
  'agent-data/managed-skills/skills',
  'sand-data/managed-skills/skills',
] as const;

export const MEMORY_CANDIDATES = [
  'memory-v2',
  'agent-data/memory-v2',
  'sand-data/memory-v2',
] as const;

export const TRANSCRIPT_CANDIDATES = [
  'sessions',
  'agent-data/sessions',
  'sand-data/sessions',
] as const;

const AGENT_ID = /^[a-zA-Z0-9_.-]+$/u;

export type InitRequest = {
  configPath: string;
  roots: string[];
  skills?: string;
  managedSkills?: string;
  memory?: string;
  transcripts?: string;
  files?: string;
  home: string;
  env?: NodeJS.ProcessEnv;
  tolerant?: boolean;
  agentId?: string;
  autoRebuild?: boolean;
  hubSkills?: string;
  force?: boolean;
  merge?: boolean;
};

export type InitResult = BoxConfig & { reports: string[] };

export async function initBox(request: InitRequest): Promise<InitResult> {
  if (request.force === true && request.merge === true) {
    throw new BoxError('BOX_CONFIG', 'Pass either --merge or --force.');
  }
  const existing = await readConfigFile(request.configPath);
  if (existing && request.merge !== true && request.force !== true) {
    throw new BoxError(
      'BOX_CONFIG',
      `Config already exists: ${request.configPath}. Pass --force to replace it.`
    );
  }
  if (request.merge === true && !existing) {
    throw new BoxError(
      'BOX_CONFIG',
      `No config to merge at ${request.configPath}.`
    );
  }
  const base = defaultBoxConfig(request.env ?? process.env, request.home);
  const scanRoots = [
    ...new Set([
      ...request.roots.map((root) => path.resolve(root)),
      base.grokHome,
    ]),
  ];
  const workflows = await resolveRole(
    'workflows',
    WORKFLOW_CANDIDATES,
    scanRoots,
    request.skills,
    request.tolerant === true,
    '--skills'
  );
  const managed = await resolveRole(
    'managed skills',
    MANAGED_CANDIDATES,
    scanRoots,
    request.managedSkills,
    request.tolerant === true,
    '--managed-skills'
  );
  const memory = await resolveOptional(
    'memory',
    MEMORY_CANDIDATES,
    scanRoots,
    request.memory
  );
  const transcripts = await resolveOptional(
    'transcripts',
    TRANSCRIPT_CANDIDATES,
    scanRoots,
    request.transcripts
  );
  const files = await resolveFiles(request.files);
  const agentId =
    request.agentId !== undefined ? checkedAgentId(request.agentId) : undefined;
  const skillRoots = [...workflows.roots, ...managed.roots];
  if (request.hubSkills !== undefined) {
    await mkdir(request.hubSkills, { recursive: true, mode: 0o700 });
    const real = await realpath(request.hubSkills);
    if (!hubSkillsAllowed(real)) {
      throw new BoxError(
        'BOX_CONFIG',
        `hub skills path ${request.hubSkills} resolves to a denied path.`
      );
    }
    skillRoots.push(real);
  }
  const config: BoxConfig = {
    output: base.output,
    grokHome: base.grokHome,
    agents: ['box'],
    ...(agentId !== undefined ? { agentId } : {}),
    ...(request.autoRebuild === true ? { autoRebuild: true } : {}),
    scopes: {
      files: { roots: files.roots },
      skills: { roots: [...new Set(skillRoots)] },
      memory: { roots: memory.roots },
      transcripts: { roots: transcripts.roots },
    },
  };
  const stored =
    request.merge === true && existing
      ? await mergeConfig(existing, config, request.home)
      : config;
  await mkdir(path.dirname(request.configPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(request.configPath, `${JSON.stringify(stored, null, 2)}\n`, {
    mode: 0o600,
  });
  const reports = [memory.report, transcripts.report, files.report];
  if (request.tolerant === true) {
    for (const report of [workflows.report, managed.report]) {
      if (report) reports.push(report);
    }
  }
  return {
    output: stringField(stored, 'output', config.output),
    grokHome: stringField(stored, 'grokHome', config.grokHome),
    agents: agentsField(stored, config.agents),
    scopes: scopesField(stored, config.scopes),
    ...(stringField(stored, 'agentId', '')
      ? { agentId: stringField(stored, 'agentId', '') }
      : {}),
    ...(stored.autoRebuild === true ? { autoRebuild: true as const } : {}),
    reports,
  };
}

async function readConfigFile(
  configPath: string
): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw new BoxError('BOX_CONFIG', `Could not read ${configPath}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BoxError('BOX_CONFIG', `Could not read ${configPath}.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BoxError('BOX_CONFIG', 'Box config must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function stringField(
  stored: BoxConfig | Record<string, unknown>,
  key: string,
  fallback: string
): string {
  const value = (stored as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : fallback;
}

function agentsField(
  stored: BoxConfig | Record<string, unknown>,
  fallback: string[]
): string[] {
  const value = (stored as Record<string, unknown>).agents;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return fallback;
  }
  return value as string[];
}

function scopesField(
  stored: BoxConfig | Record<string, unknown>,
  fallback: BoxConfig['scopes']
): BoxConfig['scopes'] {
  const value = (stored as Record<string, unknown>).scopes;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fallback;
  const record = value as Record<string, unknown>;
  const scopes = { ...fallback };
  for (const name of ['files', 'skills', 'memory', 'transcripts'] as const) {
    const entry = record[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const roots = (entry as { roots?: unknown }).roots;
    if (!Array.isArray(roots) || roots.some((item) => typeof item !== 'string'))
      continue;
    scopes[name] = { roots: roots as string[] };
  }
  return scopes;
}

async function mergeConfig(
  existing: Record<string, unknown>,
  fresh: BoxConfig,
  home: string
): Promise<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...existing };
  const priorScopes =
    existing.scopes &&
    typeof existing.scopes === 'object' &&
    !Array.isArray(existing.scopes)
      ? { ...(existing.scopes as Record<string, unknown>) }
      : {};
  const scopes: Record<string, unknown> = { ...priorScopes };
  const grokHome = path.resolve(
    expandHomePath(
      typeof existing.grokHome === 'string'
        ? existing.grokHome
        : fresh.grokHome,
      home
    )
  );
  for (const name of ['files', 'skills', 'memory', 'transcripts'] as const) {
    const priorEntry = scopes[name];
    const entry =
      priorEntry && typeof priorEntry === 'object' && !Array.isArray(priorEntry)
        ? { ...(priorEntry as Record<string, unknown>) }
        : {};
    // An omitted scope still has loader defaults. Writing only the scan
    // would replace those defaults with an explicit list.
    const listed = explicitRoots(priorEntry);
    const prior = listed ?? implicitScopeRoots(name, grokHome);
    entry.roots = await unionRoots(prior, fresh.scopes[name].roots, home);
    scopes[name] = entry;
  }
  next.scopes = scopes;
  if (typeof next.output !== 'string') next.output = fresh.output;
  if (typeof next.grokHome !== 'string') next.grokHome = fresh.grokHome;
  if (!Array.isArray(next.agents)) next.agents = fresh.agents;
  if (fresh.agentId !== undefined) next.agentId = fresh.agentId;
  if (fresh.autoRebuild === true) next.autoRebuild = true;
  return next;
}

function explicitRoots(entry: unknown): string[] | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    return undefined;
  const roots = (entry as { roots?: unknown }).roots;
  if (!Array.isArray(roots)) return undefined;
  return roots.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  );
}

function implicitScopeRoots(
  name: 'files' | 'skills' | 'memory' | 'transcripts',
  grokHome: string
): string[] {
  if (name === 'skills') {
    return [
      path.join(grokHome, 'skills'),
      path.join(grokHome, 'bundled', 'skills'),
    ];
  }
  if (name === 'memory') return [path.join(grokHome, 'memory-v2')];
  if (name === 'transcripts') return [path.join(grokHome, 'sessions')];
  return [];
}

function expandHomePath(input: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/')) return path.join(home, input.slice(2));
  return input;
}

async function unionRoots(
  existing: readonly string[],
  found: readonly string[],
  home: string
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of [...existing, ...found]) {
    const key = await rootKey(root, home);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

async function rootKey(root: string, home: string): Promise<string> {
  const expanded =
    root === '~'
      ? home
      : root.startsWith('~/')
        ? path.join(home, root.slice(2))
        : root;
  const resolved = path.resolve(expanded);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

// `.knolo` is denied so a scan cannot index the box output.
// `~/.knolo/skills` is the one directory setup always adds.
function hubSkillsAllowed(real: string): boolean {
  const parts = real.split(/[\\/]+/u).filter((part) => part.length > 0);
  const base = parts.at(-1)?.toLowerCase();
  const parent = parts.at(-2)?.toLowerCase();
  if (parent === '.knolo' && base === 'skills') {
    const rest = path.join(path.sep, ...parts.slice(0, -2));
    return !isDeniedInitPath(rest);
  }
  return !isDeniedInitPath(real);
}

function checkedAgentId(value: string): string {
  if (!AGENT_ID.test(value)) {
    throw new BoxError(
      'BOX_CONFIG',
      'agentId must be letters, digits, dot, underscore, or hyphen.'
    );
  }
  return value;
}

async function resolveOptional(
  label: string,
  relatives: readonly string[],
  roots: readonly string[],
  override: string | undefined
): Promise<{ roots: string[]; report: string }> {
  if (override !== undefined) {
    const found = await resolveOne(label, override);
    return { roots: [found], report: `${label}: ${found}` };
  }
  const found: string[] = [];
  const denied: string[] = [];
  for (const root of roots) {
    for (const relative of relatives) {
      for (const candidate of await pathsForCandidate(root, relative)) {
        const resolved = await resolveCandidate(candidate);
        if (!resolved) continue;
        if (resolved.denied) {
          denied.push(resolved.real);
          continue;
        }
        found.push(resolved.real);
      }
    }
  }
  const unique = [...new Set(found)];
  if (unique.length === 1) {
    return { roots: unique, report: `${label}: ${unique[0]}` };
  }
  if (unique.length === 0) {
    const skipped = denied.length ? ` Denied ${denied.join(', ')}.` : '';
    return {
      roots: [],
      report: `${label}: no directory found.${skipped}`,
    };
  }
  return {
    roots: [],
    report: `${label}: found more than one directory, left empty. Found ${unique.join(', ')}.`,
  };
}

async function resolveFiles(
  override: string | undefined
): Promise<{ roots: string[]; report: string }> {
  if (override === undefined) {
    return { roots: [], report: 'files: opt-in, left empty.' };
  }
  const found = await resolveOne('files', override);
  return { roots: [found], report: `files: ${found}` };
}

async function resolveOne(label: string, override: string): Promise<string> {
  const found = await resolveCandidate(override);
  if (!found) {
    throw new BoxError(
      'BOX_CONFIG',
      `Could not use ${label} path ${override}.`
    );
  }
  if (found.denied) {
    throw new BoxError(
      'BOX_CONFIG',
      `${label} path ${override} resolves to a denied path.`
    );
  }
  return found.real;
}

async function resolveRole(
  label: string,
  relatives: readonly string[],
  roots: readonly string[],
  override: string | undefined,
  tolerant: boolean,
  flagName: string
): Promise<{ roots: string[]; report?: string }> {
  if (override !== undefined) {
    const found = await resolveCandidate(override);
    if (!found) {
      throw new BoxError(
        'BOX_CONFIG',
        `Could not use ${label} path ${override}.`
      );
    }
    if (found.denied) {
      throw new BoxError(
        'BOX_CONFIG',
        `${label} path ${override} resolves to a denied path.`
      );
    }
    return { roots: [found.real] };
  }
  const found: string[] = [];
  for (const root of roots) {
    for (const relative of relatives) {
      for (const candidate of await pathsForCandidate(root, relative)) {
        const resolved = await resolveCandidate(candidate);
        if (!resolved || resolved.denied) continue;
        found.push(resolved.real);
      }
    }
  }
  const unique = [...new Set(found)];
  if (unique.length === 1) return { roots: unique };
  if (!tolerant) {
    throw new BoxError(
      'BOX_CONFIG',
      `${label} must resolve to one directory. Found ${unique.length}.`
    );
  }
  if (unique.length === 0) {
    return { roots: [], report: emptySkillReport(label, roots) };
  }
  return {
    roots: [],
    report: `${label}: found ${unique.length} directories. Pass ${flagName} <path>.`,
  };
}

function emptySkillReport(label: string, roots: readonly string[]): string {
  const scanned =
    roots.length > 0
      ? roots.map((root) => path.resolve(root)).join(', ')
      : '(none)';
  return `${label}: no directory found. Scanned ${scanned}. A root needs to contain agent-data or sand-data, or be the skill folder itself.`;
}

async function pathsForCandidate(
  root: string,
  relative: string
): Promise<string[]> {
  const resolved = path.resolve(root);
  const paths = [path.join(resolved, relative)];
  let real = resolved;
  try {
    await lstat(resolved);
    real = await realpath(resolved);
  } catch {
    return paths;
  }
  const base = path.basename(real);
  if (base !== 'agent-data' && base !== 'sand-data') return paths;
  const prefix = `${base}/`;
  if (!relative.startsWith(prefix)) return paths;
  const rest = relative.slice(prefix.length);
  if (!rest) return paths;
  paths.push(path.join(real, rest));
  return paths;
}

async function resolveCandidate(
  candidate: string
): Promise<{ real: string; denied: boolean } | undefined> {
  try {
    await lstat(candidate);
    const real = await realpath(candidate);
    if (!(await stat(real)).isDirectory()) return undefined;
    return { real, denied: isDeniedInitPath(real) };
  } catch {
    return undefined;
  }
}
