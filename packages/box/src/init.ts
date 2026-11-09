import { lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
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
};

export type InitResult = BoxConfig & { reports: string[] };

export async function initBox(request: InitRequest): Promise<InitResult> {
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
    request.skills
  );
  const managed = await resolveRole(
    'managed skills',
    MANAGED_CANDIDATES,
    scanRoots,
    request.managedSkills
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
  const config: BoxConfig = {
    output: base.output,
    grokHome: base.grokHome,
    agents: ['box'],
    scopes: {
      files: { roots: files.roots },
      skills: { roots: [...new Set([...workflows, ...managed])] },
      memory: { roots: memory.roots },
      transcripts: { roots: transcripts.roots },
    },
  };
  await mkdir(path.dirname(request.configPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(request.configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    ...config,
    reports: [memory.report, transcripts.report, files.report],
  };
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
  const checked: string[] = [];
  const found: string[] = [];
  const denied: string[] = [];
  for (const root of roots) {
    for (const relative of relatives) {
      const candidate = path.join(path.resolve(root), relative);
      checked.push(candidate);
      const resolved = await resolveCandidate(candidate);
      if (!resolved) continue;
      if (resolved.denied) {
        denied.push(resolved.real);
        continue;
      }
      found.push(resolved.real);
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
      report: `${label}: no directory found. Checked ${checked.join(', ') || '(none)'}.${skipped}`,
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
  override: string | undefined
): Promise<string[]> {
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
    return [found.real];
  }
  const checked: string[] = [];
  const found: string[] = [];
  for (const root of roots) {
    for (const relative of relatives) {
      const candidate = path.join(path.resolve(root), relative);
      checked.push(candidate);
      const resolved = await resolveCandidate(candidate);
      if (!resolved || resolved.denied) continue;
      found.push(resolved.real);
    }
  }
  const unique = [...new Set(found)];
  if (unique.length !== 1) {
    throw new BoxError(
      'BOX_CONFIG',
      `${label} must resolve to one directory. Checked ${checked.join(', ') || '(none)'}. Found ${unique.join(', ') || '(none)'}.`
    );
  }
  return unique;
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
