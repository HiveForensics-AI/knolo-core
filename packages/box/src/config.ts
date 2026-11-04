import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BoxError } from './errors.js';

export const SCOPE_NAMES = [
  'files',
  'skills',
  'memory',
  'transcripts',
] as const;

export type BoxScopeName = (typeof SCOPE_NAMES)[number];

export type BoxConfig = {
  output: string;
  grokHome: string;
  agents: string[];
  scopes: Record<BoxScopeName, { roots: string[] }>;
};

const AGENT_ID = /^[a-zA-Z0-9_.-]+$/u;

export function defaultBoxConfig(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): BoxConfig {
  const grokHome = path.resolve(
    expandPath(env.GROK_HOME?.trim() || path.join(home, '.grok'), home, '')
  );
  return {
    output: path.join(home, '.knolo', 'box'),
    grokHome,
    agents: ['box'],
    scopes: {
      files: { roots: [] },
      skills: {
        roots: [
          path.join(grokHome, 'skills'),
          path.join(grokHome, 'bundled', 'skills'),
        ],
      },
      memory: { roots: [path.join(grokHome, 'memory-v2')] },
      transcripts: { roots: [path.join(grokHome, 'sessions')] },
    },
  };
}

export async function loadBoxConfig(
  configPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): Promise<BoxConfig> {
  const base = defaultBoxConfig(env, home);
  if (!configPath) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    throw new BoxError('BOX_CONFIG', `Could not read ${configPath}.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BoxError('BOX_CONFIG', 'Box config must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const grokHome = path.resolve(
    expandPath(
      typeof record.grokHome === 'string' ? record.grokHome : base.grokHome,
      home,
      base.grokHome
    )
  );
  const agents =
    record.agents === undefined ? base.agents : agentList(record.agents);
  const scopes = { ...base.scopes };
  if (record.scopes !== undefined) {
    if (
      !record.scopes ||
      typeof record.scopes !== 'object' ||
      Array.isArray(record.scopes)
    ) {
      throw new BoxError('BOX_CONFIG', 'scopes must be an object.');
    }
    const incoming = record.scopes as Record<string, unknown>;
    for (const name of SCOPE_NAMES) {
      if (incoming[name] === undefined) continue;
      scopes[name] = { roots: rootList(incoming[name], home, grokHome) };
    }
  }
  return {
    output: path.resolve(
      expandPath(
        typeof record.output === 'string' ? record.output : base.output,
        home,
        grokHome
      )
    ),
    grokHome,
    agents,
    scopes,
  };
}

function agentList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BoxError('BOX_CONFIG', 'agents must be a non-empty list.');
  }
  const agents = value.map((item) => {
    if (typeof item !== 'string' || !AGENT_ID.test(item)) {
      throw new BoxError(
        'BOX_CONFIG',
        'Each agent id must be letters, digits, dot, underscore, or hyphen.'
      );
    }
    return item;
  });
  return [...new Set(agents)];
}

function rootList(value: unknown, home: string, grokHome: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BoxError('BOX_CONFIG', 'Each scope must be an object.');
  }
  const roots = (value as { roots?: unknown }).roots;
  if (!Array.isArray(roots)) {
    throw new BoxError('BOX_CONFIG', 'Each scope needs a roots list.');
  }
  return roots.map((item) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new BoxError('BOX_CONFIG', 'Scope roots must be paths.');
    }
    return path.resolve(expandPath(item, home, grokHome));
  });
}

function expandPath(input: string, home: string, grokHome: string): string {
  const withHome = input
    .replaceAll('${GROK_HOME}', grokHome)
    .replaceAll('$GROK_HOME', grokHome);
  if (withHome === '~') return home;
  if (withHome.startsWith('~/')) return path.join(home, withHome.slice(2));
  return withHome;
}
