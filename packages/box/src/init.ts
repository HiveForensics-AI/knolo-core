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

export type InitRequest = {
  configPath: string;
  roots: string[];
  skills?: string;
  managedSkills?: string;
  home: string;
  env?: NodeJS.ProcessEnv;
};

export async function initBox(request: InitRequest): Promise<BoxConfig> {
  const base = defaultBoxConfig(request.env ?? process.env, request.home);
  const workflows = await resolveRole(
    'workflows',
    WORKFLOW_CANDIDATES,
    request.roots,
    request.skills
  );
  const managed = await resolveRole(
    'managed skills',
    MANAGED_CANDIDATES,
    request.roots,
    request.managedSkills
  );
  const config: BoxConfig = {
    output: base.output,
    grokHome: base.grokHome,
    agents: ['box'],
    scopes: {
      files: { roots: [] },
      skills: { roots: [...new Set([...workflows, ...managed])] },
      memory: { roots: [] },
      transcripts: { roots: [] },
    },
  };
  await mkdir(path.dirname(request.configPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(request.configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  return config;
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
