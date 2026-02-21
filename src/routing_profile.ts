import type { AgentDefinitionV1, AgentToolPolicy } from './agent.js';
import type { Pack } from './pack.js';

const MAX_DISCOVERABILITY_ITEMS = 20;

export interface AgentRoutingProfileV1 {
  agentId: string;
  namespace?: string;
  heading?: string;
  description?: string;
  tags: string[];
  examples: string[];
  capabilities: string[];
  toolPolicy?: unknown;
  toolPolicySummary?: {
    mode: 'allow_all' | 'deny_all' | 'mixed' | 'unknown';
    allowed?: string[];
    denied?: string[];
  };
}

export function getAgentRoutingProfileV1(
  agent: AgentDefinitionV1
): AgentRoutingProfileV1 {
  const metadata = agent.metadata ?? {};
  const heading = getStringMetadata(metadata, 'heading');
  const namespace = getPrimaryNamespace(agent);

  return {
    agentId: agent.id,
    namespace,
    heading,
    description: agent.description,
    tags: parseDiscoverabilityList(metadata.tags),
    examples: parseDiscoverabilityList(metadata.examples),
    capabilities: parseDiscoverabilityList(metadata.capabilities),
    toolPolicy: agent.toolPolicy,
    toolPolicySummary: summarizeToolPolicy(agent.toolPolicy),
  };
}

export function getPackRoutingProfilesV1(pack: Pack): AgentRoutingProfileV1[] {
  const agents = pack.meta.agents?.agents ?? [];
  return agents.map((agent) => getAgentRoutingProfileV1(agent));
}

function getPrimaryNamespace(agent: AgentDefinitionV1): string | undefined {
  const first = agent.retrievalDefaults.namespace[0];
  if (typeof first === 'string' && first.trim()) {
    return first;
  }
  return undefined;
}

function getStringMetadata(
  metadata: Record<string, string | number | boolean | null>,
  key: string
): string | undefined {
  const value = metadata[key];
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parseDiscoverabilityList(value: unknown): string[] {
  if (typeof value !== 'string') return [];

  const raw = value.trim();
  if (!raw) return [];

  let parsed: string[];
  if (raw.startsWith('[')) {
    parsed = parseJsonArrayString(raw);
  } else if (raw.includes('\n')) {
    parsed = raw.split('\n');
  } else {
    parsed = raw.split(',');
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= MAX_DISCOVERABILITY_ITEMS) break;
  }

  return deduped;
}

function parseJsonArrayString(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function summarizeToolPolicy(
  policy?: AgentToolPolicy
): AgentRoutingProfileV1['toolPolicySummary'] {
  if (!policy) {
    return {
      mode: 'allow_all',
    };
  }

  if (!Array.isArray(policy.tools)) {
    return {
      mode: 'unknown',
    };
  }

  if (policy.mode === 'allow') {
    return {
      mode: 'mixed',
      allowed: policy.tools,
    };
  }

  if (policy.mode === 'deny') {
    return {
      mode: 'mixed',
      denied: policy.tools,
    };
  }

  return {
    mode: 'unknown',
  };
}
