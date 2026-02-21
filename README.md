# 🧠 KnoLo Monorepo

KnoLo is moving toward **adoption-frictionless retrieval tooling**: you should be able to try the core experience in **under 10 minutes**, with a **~5 minute quickstart** from clone to first query.

> Status today: the monorepo scaffolding is in place and `@knolo/core` is production code. CLI/adapters/examples/templates are present as placeholders for upcoming phases.

## ✅ Implemented now

- `@knolo/core` package in `packages/core`
- Build + test workflow wired through root workspace scripts
- Existing core engine and test suite preserved

## 🚧 Coming soon

- `@knolo/cli` package implementation (package scaffold exists)
- `@knolo/langchain` adapter (scaffold exists)
- `@knolo/llamaindex` adapter (scaffold exists)
- Example apps under `examples/`
- `templates/create-knolo-app`

## 📦 Install

```bash
npm install @knolo/core
```

Build from source:

```bash
git clone https://github.com/HiveForensics-AI/knolo-core.git
cd knolo-core
npm install
npm run build
```

## 🚀 5-minute quickstart

```ts
import { buildPack, mountPack, query, makeContextPatch } from '@knolo/core';

const docs = [
  {
    id: 'bridge-guide',
    namespace: 'mobile',
    heading: 'React Native Bridge',
    text: 'The bridge sends messages between JS and native modules. Throttling limits event frequency.',
  },
  {
    id: 'perf-notes',
    namespace: 'mobile',
    heading: 'Debounce vs Throttle',
    text: 'Debounce waits for silence; throttle enforces a maximum trigger rate.',
  },
];

const bytes = await buildPack(docs);
const kb = await mountPack({ src: bytes });
const hits = query(kb, '"react native" throttle', { topK: 5, namespace: 'mobile' });
const patch = makeContextPatch(hits, { budget: 'small' });

console.log(hits, patch);
```

## 🗂️ Repo structure

```text
.
├── packages/
│   ├── core                  # @knolo/core (implemented)
│   ├── cli                   # @knolo/cli (scaffold)
│   ├── adapter-langchain     # @knolo/langchain (scaffold)
│   └── adapter-llamaindex    # @knolo/llamaindex (scaffold)
├── examples/
│   ├── nextjs-rag-chat       # placeholder
│   └── node-cli-rag          # placeholder
└── templates/
    └── create-knolo-app      # placeholder
```

## 🧭 Planned adapters & examples

- LangChain adapter (**coming soon**)
- LlamaIndex adapter (**coming soon**)
- Example apps (**coming soon**)
- `create-knolo-app` template (**coming soon**)

## 🔀 Hybrid retrieval with embeddings (optional)

KnoLo’s core retrieval remains lexical-first and deterministic. Semantic signals are added as an **optional rerank stage** when lexical confidence is low (or forced).

### Build a semantic-enabled pack

```ts
import { buildPack } from '@knolo/core';

// embeddings must align 1:1 with docs/block order
const embeddings: Float32Array[] = await embedDocumentsInOrder(docs);

const bytes = await buildPack(docs, {
  semantic: {
    enabled: true,
    modelId: 'text-embedding-3-small',
    embeddings,
    quantization: { type: 'int8_l2norm', perVectorScale: true },
  },
});
```

### Query with semantic rerank

```ts
import { mountPack, query, hasSemantic } from '@knolo/core';

const kb = await mountPack({ src: bytes });
const queryEmbedding = await embedQuery('react native bridge throttling');

const hits = query(kb, 'react native bridge throttling', {
  topK: 8,
  semantic: {
    enabled: hasSemantic(kb),
    mode: 'rerank',
    topN: 50,
    minLexConfidence: 0.35,
    blend: { enabled: true, wLex: 0.75, wSem: 0.25 },
    queryEmbedding,
    force: false,
  },
});
```

### Semantic helper utilities

```ts
import {
  quantizeEmbeddingInt8L2Norm,
  encodeScaleF16,
  decodeScaleF16,
} from '@knolo/core';

const { q, scale } = quantizeEmbeddingInt8L2Norm(queryEmbedding);
const packed = encodeScaleF16(scale);
const restored = decodeScaleF16(packed);
```

## 🧩 API

### `buildPack(docs, opts?) => Promise<Uint8Array>`

```ts
type BuildInputDoc = {
  id?: string;
  heading?: string;
  namespace?: string;
  text: string;
};

type BuildPackOptions = {
  agents?: AgentRegistry | AgentDefinitionV1[];
  semantic?: {
    enabled: boolean;
    modelId: string;
    embeddings: Float32Array[];
    quantization?: {
      type: 'int8_l2norm';
      perVectorScale?: true;
    };
  };
};
```

### Agents in pack metadata

Agents are optional and embedded in `meta.agents` so a single `.knolo` artifact can ship retrieval behavior + prompt defaults on-prem. Agent registries are validated once at `mountPack()` time, so invalid embedded registries fail fast during mount.

Agent namespace binding is **strict**: when `resolveAgent()` composes retrieval options, `retrievalDefaults.namespace` is always enforced and caller-provided `query.namespace` is ignored.

```ts
type AgentPromptTemplate = string[] | { format: 'markdown'; template: string };

type AgentRegistry = {
  version: 1;
  agents: AgentDefinitionV1[];
};

type PackMeta = {
  version: number;
  stats: { docs: number; blocks: number; terms: number; avgBlockLen?: number };
  agents?: AgentRegistry;
};

type AgentDefinitionV1 = {
  id: string;
  version: 1;
  name?: string;
  description?: string;
  systemPrompt: AgentPromptTemplate;
  retrievalDefaults: {
    namespace: string[]; // required
    topK?: number;
    queryExpansion?: QueryOptions['queryExpansion'];
    semantic?: Omit<
      NonNullable<QueryOptions['semantic']>,
      'queryEmbedding' | 'enabled' | 'force'
    > & { enabled?: boolean };
    minScore?: number;
    requirePhrases?: string[];
    source?: string[];
  };
  toolPolicy?: { mode: 'allow' | 'deny'; tools: string[] };
  metadata?: Record<string, string | number | boolean | null>;
};
```

### `mountPack({ src }) => Promise<Pack>`

```ts
type Pack = {
  meta: {
    version: number;
    stats: {
      docs: number;
      blocks: number;
      terms: number;
      avgBlockLen?: number;
    };
  };
  lexicon: Map<string, number>;
  postings: Uint32Array;
  blocks: string[];
  headings?: (string | null)[];
  docIds?: (string | null)[];
  namespaces?: (string | null)[];
  blockTokenLens?: number[];
  semantic?: {
    version: 1;
    modelId: string;
    dims: number;
    encoding: 'int8_l2norm';
    perVectorScale: boolean;
    vecs: Int8Array;
    scales?: Uint16Array;
  };
};
```

### `query(pack, queryText, opts?) => Hit[]`

```ts
type QueryOptions = {
  topK?: number;
  minScore?: number;
  requirePhrases?: string[];
  namespace?: string | string[];
  source?: string | string[];
  queryExpansion?: {
    enabled?: boolean;
    docs?: number;
    terms?: number;
    weight?: number;
    minTermLength?: number;
  };
  semantic?: {
    enabled?: boolean;
    mode?: 'rerank';
    topN?: number;
    minLexConfidence?: number;
    blend?: {
      enabled?: boolean;
      wLex?: number;
      wSem?: number;
    };
    queryEmbedding?: Float32Array;
    force?: boolean;
  };
};

type Hit = {
  blockId: number;
  score: number;
  text: string;
  source?: string;
  namespace?: string;
};
```

### Agent runtime helpers

- `listAgents(pack) => string[]`
- `getAgent(pack, agentId) => AgentDefinitionV1 | undefined`
- `resolveAgent(pack, { agentId, query?, patch? }) => { agent, systemPrompt, retrievalOptions }`
- `buildSystemPrompt(agent, patch?) => string`
- `isToolAllowed(agent, toolId) => boolean` (defaults to allow-all when no `toolPolicy`)
- `assertToolAllowed(agent, toolId) => void` (throws deterministic error when blocked)
- `parseToolCallV1FromText(text) => ToolCallV1 | null` (safe parser for model outputs)
- `assertToolCallAllowed(agent, call) => void` (policy gate for parsed calls)
- `isToolCallV1(value) / isToolResultV1(value)` (runtime-safe type guards)
- `getAgentRoutingProfileV1(agent) => AgentRoutingProfileV1`
- `getPackRoutingProfilesV1(pack) => AgentRoutingProfileV1[]`
- `isRouteDecisionV1(value) => boolean` (strict contract guard for router output)
- `validateRouteDecisionV1(decision, registryById) => { ok: true } | { ok: false; error: string }`
- `selectAgentIdFromRouteDecisionV1(decision, registryById, { fallbackAgentId? }) => { agentId, reason }`

### Routing discoverability conventions

To make an agent easier to route, use these optional `metadata` keys on `AgentDefinitionV1`:

- `tags`: comma-separated (`"shopping,checkout"`) or JSON array string (`"[\"shopping\",\"checkout\"]"`)
- `examples`: comma-separated, newline-separated, or JSON array string
- `capabilities`: comma-separated, newline-separated, or JSON array string
- `heading`: short UI heading shown in routing cards

`@knolo/core` parses these into a compact routing profile with trimming + dedupe + caps and never throws on bad metadata formats.

```ts
type AgentRoutingProfileV1 = {
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
};
```

Example profile payload:

```json
{
  "agentId": "shopping.agent",
  "namespace": "shopping",
  "heading": "Shopping Assistant",
  "description": "Handles product lookup, checkout help, and order tracking.",
  "tags": ["shopping", "checkout", "order-status"],
  "examples": ["track my order", "find running shoes under $120"],
  "capabilities": ["catalog_search", "order_lookup"],
  "toolPolicySummary": {
    "mode": "mixed",
    "allowed": ["search_docs", "order_lookup"]
  }
}
```

### Route decision contract

`@knolo/core` does not call Ollama (or any model provider). A runtime can call any router model, then validate the output with this contract:

```ts
type RouteCandidateV1 = {
  agentId: string;
  score: number; // 0..1
  why?: string;
};

type RouteDecisionV1 = {
  type: 'route_decision';
  intent?: string;
  entities?: Record<string, unknown>;
  candidates: RouteCandidateV1[];
  selected: string;
  needsTools?: string[];
  risk?: 'low' | 'med' | 'high';
};
```

JSON example:

```json
{
  "type": "route_decision",
  "intent": "order_tracking",
  "entities": { "orderId": "A-1023" },
  "candidates": [
    { "agentId": "shopping.agent", "score": 0.91, "why": "Order-related intent" },
    { "agentId": "returns.agent", "score": 0.37 }
  ],
  "selected": "shopping.agent",
  "needsTools": ["order_lookup"],
  "risk": "low"
}
```

Validation and selection notes:

- `isRouteDecisionV1(...)` is strict and rejects malformed payloads.
- `validateRouteDecisionV1(...)` requires `selected` and every candidate `agentId` to exist in the mounted registry and rejects duplicate candidate ids.
- `selectAgentIdFromRouteDecisionV1(...)` is deterministic and never throws:
  1. use `selected` if registered,
  2. else highest-score registered candidate,
  3. else caller `fallbackAgentId` if valid,
  4. else lexicographically first registered agent id.

### Router runtime flow (provider-agnostic)

1. Receive user input text.
2. Build routing profiles from mounted pack agents via `getPackRoutingProfilesV1(pack)`.
3. Send input + profiles to your router model (Ollama or any provider) outside `@knolo/core`.
4. Parse model output JSON and gate with `isRouteDecisionV1`.
5. Validate against mounted registry with `validateRouteDecisionV1`.
6. Pick final agent using `selectAgentIdFromRouteDecisionV1`.
7. Call `resolveAgent(pack, { agentId, ... })` and run your existing loop.

### Tool call + result contracts

```ts
type ToolCallV1 = {
  type: 'tool_call';
  callId: string;
  tool: string;
  args: Record<string, unknown>;
};

type ToolResultV1 = {
  type: 'tool_result';
  callId: string;
  tool: string;
  ok: boolean;
  output?: unknown; // when ok=true
  error?: { message: string; code?: string; details?: unknown }; // when ok=false
};
```

JSON examples:

```json
{
  "type": "tool_call",
  "callId": "call-42",
  "tool": "search_docs",
  "args": { "query": "bridge throttle" }
}
```

```json
{
  "type": "tool_result",
  "callId": "call-42",
  "tool": "search_docs",
  "ok": true,
  "output": { "hits": [{ "id": "mobile-doc" }] }
}
```

### Runtime loop shape (model-agnostic)

1. Run model with current conversation state.
2. Parse text output with `parseToolCallV1FromText(...)`.
3. If parsed: gate with `assertToolCallAllowed(resolved.agent, call)`.
4. Runtime executes the tool and creates `ToolResultV1`.
5. Feed the tool result back into the conversation and continue until completion.

### Trace events for timeline UIs

```ts
type TraceEventV1 =
  | {
      type: 'route.requested';
      ts: string;
      text: string;
      agentCount: number;
    }
  | {
      type: 'route.decided';
      ts: string;
      decision: RouteDecisionV1;
      selectedAgentId: string;
    }
  | { type: 'agent.selected'; ts: string; agentId: string; namespace?: string }
  | {
      type: 'prompt.resolved';
      ts: string;
      agentId: string;
      promptHash?: string;
      patchKeys?: string[];
    }
  | { type: 'tool.requested'; ts: string; agentId: string; call: ToolCallV1 }
  | {
      type: 'tool.executed';
      ts: string;
      agentId: string;
      result: ToolResultV1;
      durationMs?: number;
    }
  | {
      type: 'run.completed';
      ts: string;
      agentId: string;
      status: 'ok' | 'error';
    };
```

Helpers: `nowIso()` for timestamps and `createTrace()` for lightweight trace collection.

### Build a pack with agents and resolve at runtime

```ts
import {
  buildPack,
  mountPack,
  resolveAgent,
  query,
  isToolAllowed,
  assertToolAllowed,
} from '@knolo/core';

const bytes = await buildPack(docs, {
  agents: [
    {
      id: 'mobile.agent',
      version: 1,
      systemPrompt: {
        format: 'markdown',
        template: 'You are {{team}} support.',
      },
      retrievalDefaults: { namespace: ['mobile'], topK: 5 },
      toolPolicy: { mode: 'allow', tools: ['search_docs'] },
    },
  ],
});

const pack = await mountPack({ src: bytes });
const resolved = resolveAgent(pack, {
  agentId: 'mobile.agent',
  patch: { team: 'mobile' },
  query: { namespace: ['backend'], topK: 8 },
});

console.log(resolved.retrievalOptions.namespace); // ['mobile'] (strict binding)

if (isToolAllowed(resolved.agent, 'search_docs')) {
  // invoke search_docs
}
assertToolAllowed(resolved.agent, 'search_docs');

const hits = query(pack, 'bridge throttle', resolved.retrievalOptions);
```

### `makeContextPatch(hits, { budget }) => ContextPatch`

Budgets: `"mini" | "small" | "full"`

---

## 📚 More usage examples

### Namespace + source filtering

```ts
const hits = query(kb, 'retry backoff', {
  namespace: ['sdk', 'api'],
  source: ['errors-guide', 'http-reference'],
  topK: 6,
});
```

### Phrase-only retrieval fallback behavior

If your query has no free tokens but includes required phrases, KnoLo still forms candidates from phrase tokens and enforces phrase presence.

```ts
const hits = query(kb, '"event loop"', { requirePhrases: ['single thread'] });
```

### Precision mode with minimum score

```ts
const strictHits = query(kb, 'jwt refresh token rotation', {
  topK: 5,
  minScore: 2.5,
});
```

### Validate semantic query options early

```ts
import { validateSemanticQueryOptions } from '@knolo/core';

validateSemanticQueryOptions({
  enabled: true,
  topN: 40,
  minLexConfidence: 0.3,
  blend: { enabled: true, wLex: 0.8, wSem: 0.2 },
  queryEmbedding,
});
```

---

## 🛠 Pack format and compatibility

Binary layout:

`[metaLen:u32][meta JSON][lexLen:u32][lexicon JSON][postCount:u32][postings][blocksLen:u32][blocks JSON][semLen:u32?][sem JSON?][semBlobLen:u32?][semBlob?]`

- Supports legacy block payloads (`string[]`) and richer block objects (`{ text, heading, docId, namespace, len }`).
- Semantic section is optional and only present when built with `semantic.enabled = true`.
- `mountPack` auto-detects available sections.

---

## ⚡ Practical tuning guidance

- Keep blocks reasonably small (~300–700 tokens) for better lexical recall and proximity precision.
- Include strong headings to increase cheap relevance gains.
- Use `namespace` to reduce candidate noise in multi-domain corpora.
- Start semantic blend near `wLex: 0.75 / wSem: 0.25`, then tune by offline eval.
- Keep embedding model consistent between build and query (`modelId` should match your query embedding source).

---

## ❓ FAQ

**Does KnoLo require a vector database?**
No. Semantic vectors (when used) are stored in the `.knolo` pack and used for in-process reranking.

**Is retrieval deterministic?**
Lexical retrieval and post-processing are deterministic. Semantic rerank is deterministic for fixed pack bytes and fixed embedding vectors.

**Can I run fully offline?**
Yes. Query-time needs no network. Build-time embeddings can also be offline if your embedding pipeline is local.

**Is React Native / Expo supported?**
Yes. Runtime text encoder/decoder compatibility is included.

---

## 🗺️ Roadmap

- stronger hybrid retrieval evaluation tooling
- richer pack introspection and diagnostics
- incremental pack update workflows
- continued local-first performance optimization

---

## 🌐 Website

For docs, release updates, and examples: **[knolo.dev](https://www.knolo.dev/)**

## 📄 License

Apache-2.0 — see [LICENSE](./LICENSE).
