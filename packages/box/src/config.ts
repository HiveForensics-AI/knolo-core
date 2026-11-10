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
  agentId?: string;
  sessionId?: string;
  autoRebuild?: boolean;
  configPath?: string;
};

const AGENT_ID = /^[a-zA-Z0-9_.-]+$/u;

export function defaultBoxConfig(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): BoxConfig {
  const grokHome = path.resolve(
    expandPath(env.GROK_HOME?.trim() || path.join(home, '.grok'), home, '')
  );
  const identity = resolveIdentity({}, env);
  return {
    output: path.join(home, '.knolo', 'box'),
    grokHome,
    agents: ['box'],
    agentId: identity.agentId,
    ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
    autoRebuild: identity.autoRebuild,
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
  const identity = resolveIdentity(record, env);
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
    agentId: identity.agentId,
    ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
    autoRebuild: identity.autoRebuild,
    configPath: path.resolve(configPath),
    scopes,
  };
}

function resolveIdentity(
  record: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): { agentId: string; sessionId?: string; autoRebuild: boolean } {
  const agentId = Object.hasOwn(record, 'agentId')
    ? checkedAgentId(record.agentId, 'agentId')
    : envAgentId(env);
  const sessionId = Object.hasOwn(record, 'sessionId')
    ? checkedSessionId(record.sessionId, 'sessionId')
    : envSessionId(env);
  return {
    agentId,
    ...(sessionId ? { sessionId } : {}),
    autoRebuild: Object.hasOwn(record, 'autoRebuild')
      ? checkedAutoRebuild(record.autoRebuild)
      : envAutoRebuild(env),
  };
}

function envAgentId(env: NodeJS.ProcessEnv): string {
  const value = env.KNOLO_BOX_AGENT_ID?.trim();
  return value ? checkedAgentId(value, 'KNOLO_BOX_AGENT_ID') : 'box';
}

function envSessionId(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.KNOLO_BOX_SESSION_ID?.trim();
  return value ? checkedSessionId(value, 'KNOLO_BOX_SESSION_ID') : undefined;
}

function envAutoRebuild(env: NodeJS.ProcessEnv): boolean {
  const value = env.KNOLO_BOX_AUTO_REBUILD?.trim();
  if (!value) return false;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new BoxError(
    'BOX_CONFIG',
    'KNOLO_BOX_AUTO_REBUILD must be true or false.'
  );
}

function checkedAgentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !AGENT_ID.test(value)) {
    throw new BoxError(
      'BOX_CONFIG',
      `${label} must be letters, digits, dot, underscore, or hyphen.`
    );
  }
  return value;
}

function checkedSessionId(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new BoxError('BOX_CONFIG', `${label} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 256) {
    throw new BoxError('BOX_CONFIG', `${label} must be 1 to 256 characters.`);
  }
  return trimmed;
}

function checkedAutoRebuild(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new BoxError('BOX_CONFIG', 'autoRebuild must be true or false.');
  }
  return value;
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
