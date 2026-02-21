import type { Pack } from './pack.js';
import type { QueryOptions } from './query.js';
import { validateQueryOptions } from './query.js';

export type AgentPromptTemplate =
  | string[]
  | {
      format: 'markdown';
      template: string;
    };

export type AgentToolPolicy = {
  mode: 'allow' | 'deny';
  tools: string[];
};

export type AgentRetrievalDefaults = {
  namespace: string[];
  topK?: number;
  queryExpansion?: QueryOptions['queryExpansion'];
  semantic?: Omit<
    NonNullable<QueryOptions['semantic']>,
    'queryEmbedding' | 'enabled' | 'force'
  > & {
    enabled?: boolean;
  };
  minScore?: number;
  requirePhrases?: string[];
  source?: string[];
};

export type AgentDefinitionV1 = {
  id: string;
  version: 1;
  name?: string;
  description?: string;
  systemPrompt: AgentPromptTemplate;
  retrievalDefaults: AgentRetrievalDefaults;
  toolPolicy?: AgentToolPolicy;
  metadata?: Record<string, string | number | boolean | null>;
};

export type AgentRegistry = {
  version: 1;
  agents: AgentDefinitionV1[];
};

export type ResolveAgentInput = {
  agentId: string;
  query?: QueryOptions;
  patch?: Record<string, string | number | boolean>;
};

export type ResolvedAgent = {
  agent: AgentDefinitionV1;
  systemPrompt: string;
  retrievalOptions: QueryOptions;
};

export function validateAgentRegistry(reg: AgentRegistry): void {
  if (!reg || typeof reg !== 'object') {
    throw new Error('agent registry must be an object.');
  }
  if (reg.version !== 1) {
    throw new Error('agent registry version must be 1.');
  }
  if (!Array.isArray(reg.agents)) {
    throw new Error('agent registry agents must be an array.');
  }

  const seen = new Set<string>();
  for (const agent of reg.agents) {
    validateAgentDefinition(agent);
    if (seen.has(agent.id)) {
      throw new Error(`agent id must be unique: ${agent.id}`);
    }
    seen.add(agent.id);
  }
}

export function validateAgentDefinition(agent: AgentDefinitionV1): void {
  if (!agent || typeof agent !== 'object') {
    throw new Error('agent definition must be an object.');
  }
  if (typeof agent.id !== 'string' || !agent.id.trim()) {
    throw new Error('agent id must be a non-empty string.');
  }
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(agent.id)) {
    throw new Error(`agent id must be slug-like: ${agent.id}`);
  }
  if (agent.version !== 1) {
    throw new Error(`agent ${agent.id} version must be 1.`);
  }

  validateSystemPrompt(agent);

  const defaults = agent.retrievalDefaults;
  if (!defaults || typeof defaults !== 'object') {
    throw new Error(`agent ${agent.id} retrievalDefaults must be an object.`);
  }
  if (
    !Array.isArray(defaults.namespace) ||
    defaults.namespace.length === 0 ||
    defaults.namespace.some((ns) => typeof ns !== 'string' || !ns.trim())
  ) {
    throw new Error(
      `agent ${agent.id} retrievalDefaults.namespace must be a non-empty string array.`
    );
  }
  if (
    defaults.topK !== undefined &&
    (!Number.isInteger(defaults.topK) || defaults.topK < 1)
  ) {
    throw new Error(
      `agent ${agent.id} retrievalDefaults.topK must be a positive integer.`
    );
  }

  if (agent.toolPolicy) {
    const { mode, tools } = agent.toolPolicy;
    if (mode !== 'allow' && mode !== 'deny') {
      throw new Error(
        `agent ${agent.id} toolPolicy.mode must be "allow" or "deny".`
      );
    }
    if (
      !Array.isArray(tools) ||
      tools.some((tool) => typeof tool !== 'string' || !tool.trim())
    ) {
      throw new Error(
        `agent ${agent.id} toolPolicy.tools must be a string array.`
      );
    }
    if (new Set(tools).size !== tools.length) {
      throw new Error(
        `agent ${agent.id} toolPolicy.tools must contain unique values.`
      );
    }
  }

  const syntheticOpts: QueryOptions = {
    namespace: defaults.namespace,
    topK: defaults.topK,
    queryExpansion: defaults.queryExpansion,
    semantic: defaults.semantic,
    minScore: defaults.minScore,
    requirePhrases: defaults.requirePhrases,
    source: defaults.source,
  };
  validateQueryOptions(syntheticOpts);
}

export function listAgents(pack: Pack): string[] {
  const reg = pack.meta.agents;
  if (!reg?.agents?.length) return [];
  return reg.agents.map((agent) => agent.id);
}

export function getAgent(
  pack: Pack,
  agentId: string
): AgentDefinitionV1 | undefined {
  return pack.meta.agents?.agents.find((agent) => agent.id === agentId);
}

export function buildSystemPrompt(
  agent: AgentDefinitionV1,
  patch: Record<string, string | number | boolean> = {}
): string {
  const template = agent.systemPrompt;
  if (Array.isArray(template)) {
    return template.join('\n');
  }

  const source = template.template;
  const placeholders = Array.from(
    source.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)
  ).map((m) => m[1]);
  for (const key of placeholders) {
    if (!(key in patch)) {
      throw new Error(
        `agent ${agent.id} system prompt contains unknown placeholder: ${key}`
      );
    }
  }

  return source.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) =>
    String(patch[key])
  );
}

export function resolveAgent(
  pack: Pack,
  input: ResolveAgentInput
): ResolvedAgent {
  const agent = getAgent(pack, input.agentId);
  if (!agent) {
    throw new Error(`agent not found: ${input.agentId}`);
  }

  const defaults: QueryOptions = {
    namespace: agent.retrievalDefaults.namespace,
    topK: agent.retrievalDefaults.topK,
    queryExpansion: agent.retrievalDefaults.queryExpansion,
    semantic: agent.retrievalDefaults.semantic,
    minScore: agent.retrievalDefaults.minScore,
    requirePhrases: agent.retrievalDefaults.requirePhrases,
    source: agent.retrievalDefaults.source,
  };

  const caller = input.query ?? {};
  const retrievalOptions: QueryOptions = {
    ...defaults,
    ...caller,
    queryExpansion: {
      ...(defaults.queryExpansion ?? {}),
      ...(caller.queryExpansion ?? {}),
    },
    semantic: {
      ...(defaults.semantic ?? {}),
      ...(caller.semantic ?? {}),
      blend: {
        ...(defaults.semantic?.blend ?? {}),
        ...(caller.semantic?.blend ?? {}),
      },
    },
  };

  if (!defaults.queryExpansion && !caller.queryExpansion)
    delete retrievalOptions.queryExpansion;
  if (!defaults.semantic && !caller.semantic) delete retrievalOptions.semantic;
  if (
    retrievalOptions.semantic &&
    !defaults.semantic?.blend &&
    !caller.semantic?.blend
  ) {
    delete retrievalOptions.semantic.blend;
  }

  validateQueryOptions(retrievalOptions);

  return {
    agent,
    systemPrompt: buildSystemPrompt(agent, input.patch),
    retrievalOptions,
  };
}

export function isToolAllowed(
  agent: AgentDefinitionV1,
  toolId: string
): boolean {
  const policy = agent.toolPolicy;
  if (!policy) return true;

  const hasTool = policy.tools.includes(toolId);
  if (policy.mode === 'allow') {
    return hasTool;
  }
  return !hasTool;
}

export function assertToolAllowed(
  agent: AgentDefinitionV1,
  toolId: string
): void {
  if (!isToolAllowed(agent, toolId)) {
    throw new Error(`agent ${agent.id} does not allow tool: ${toolId}`);
  }
}

function validateSystemPrompt(agent: AgentDefinitionV1): void {
  const prompt = agent.systemPrompt;
  if (Array.isArray(prompt)) {
    if (!prompt.length || prompt.some((line) => typeof line !== 'string')) {
      throw new Error(
        `agent ${agent.id} systemPrompt must be a non-empty string array.`
      );
    }
    if (!prompt.join('').trim()) {
      throw new Error(`agent ${agent.id} systemPrompt must not be empty.`);
    }
    return;
  }

  if (
    !prompt ||
    prompt.format !== 'markdown' ||
    typeof prompt.template !== 'string' ||
    !prompt.template.trim()
  ) {
    throw new Error(
      `agent ${agent.id} systemPrompt markdown template must be a non-empty string.`
    );
  }
}
