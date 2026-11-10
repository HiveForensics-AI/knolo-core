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
  await mkdir(path.dirname(request.configPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(request.configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  const reports = [memory.report, transcripts.report, files.report];
  if (request.tolerant === true) {
    for (const report of [workflows.report, managed.report]) {
      if (report) reports.push(report);
    }
  }
  return {
    ...config,
    reports,
  };
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
      const candidate = path.join(path.resolve(root), relative);
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
      const candidate = path.join(path.resolve(root), relative);
      const resolved = await resolveCandidate(candidate);
      if (!resolved || resolved.denied) continue;
      found.push(resolved.real);
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
    return { roots: [], report: `${label}: no directory found.` };
  }
  return {
    roots: [],
    report: `${label}: found ${unique.length} directories. Pass ${flagName} <path>.`,
  };
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
