# 🧠 KnoLo Monorepo

KnoLo is a **local-first retrieval and agent runtime stack**.

It provides:

* `@knolo/core` — deterministic pack format + retrieval engine
* `@knolo/cli` — build workflows for `.knolo` packs
* `create-knolo-app` — instant Next.js starter
* `@knolo/langchain` — LangChain-style retriever adapter
* `@knolo/llamaindex` — LlamaIndex-style retriever adapter

KnoLo prioritizes:

* Deterministic lexical retrieval
* Optional hybrid semantic reranking
* Agent-native pack metadata
* Tool-safe runtime contracts
* Zero vector database requirement
* Local-first execution

---

## 📦 Packages

| Package             | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `@knolo/core`       | Pack builder, pack loader, retrieval engine, agent runtime |
| `@knolo/cli`        | CLI for building `.knolo` artifacts                        |
| `create-knolo-app`  | Next.js scaffolding with playground                        |
| `@knolo/langchain`  | LangChain-style retriever interface                        |
| `@knolo/llamaindex` | LlamaIndex-style retriever interface                       |

> ⚠️ `knolo-core` (unscoped) on npm is deprecated. Use `@knolo/core`.

---

# ⚡ 5-Minute Quickstart

```bash
npx create-knolo-app@latest my-kb-chat
cd my-kb-chat
npm install
npm run knolo:build
npm run dev
```

Open:

```
http://localhost:3000
```

Ask questions against the generated `/docs` corpus.

---

# 🚀 10-Minute Ecosystem Path

From this repository:

```bash
npm install
npm run build
```

Run examples:

```bash
cd examples/langchain-basic && npm install && npm run start
cd ../llamaindex-basic && npm install && npm run start
```

---

# 🔍 Core Philosophy

KnoLo is not a vector database wrapper.

It is:

* A structured binary pack format
* A deterministic lexical retrieval engine
* An optional hybrid rerank layer
* An embedded agent registry
* A strict routing + tool contract runtime

Hybrid semantic retrieval is optional and **never replaces lexical grounding**.

---

# 🔌 LangChain-Style Usage

```ts
import { mountPack } from '@knolo/core';
import { KnoLoRetriever } from '@knolo/langchain';

const pack = await mountPack({ src: './dist/knowledge.knolo' });
const retriever = new KnoLoRetriever({ pack, topK: 5 });

const docs = await retriever.getRelevantDocuments(
  'How do I configure KnoLo?'
);

for (const doc of docs) {
  console.log(doc.pageContent);
  console.log(doc.metadata); // { score, source, namespace, id }
}
```

---

# 🦙 LlamaIndex-Style Usage

```ts
import { mountPack } from '@knolo/core';
import { KnoLoRetriever } from '@knolo/llamaindex';

const pack = await mountPack({ src: './dist/knowledge.knolo' });
const retriever = new KnoLoRetriever({ pack, topK: 5 });

const nodes = await retriever.retrieve('Show me API usage examples');

for (const hit of nodes) {
  console.log(hit.node.text);
  console.log(hit.node.metadata);
}
```

---

# 🔀 Hybrid Retrieval (Optional)

Lexical-first. Semantic rerank second.

## Build with embeddings

```ts
import { buildPack } from '@knolo/core';

const bytes = await buildPack(docs, {
  semantic: {
    enabled: true,
    modelId: 'text-embedding-3-small',
    embeddings,
    quantization: {
      type: 'int8_l2norm',
      perVectorScale: true
    }
  }
});
```

## Query with rerank

```ts
import { mountPack, query, hasSemantic } from '@knolo/core';

const kb = await mountPack({ src: bytes });

const hits = query(kb, 'react native bridge throttling', {
  topK: 8,
  semantic: {
    enabled: hasSemantic(kb),
    mode: 'rerank',
    topN: 50,
    minLexConfidence: 0.35,
    blend: { enabled: true, wLex: 0.75, wSem: 0.25 },
    queryEmbedding
  }
});
```

---

# 🤖 Agents Inside Packs

Agents are embedded into pack metadata (`meta.agents`).

This allows a single `.knolo` artifact to ship:

* Retrieval behavior
* System prompt defaults
* Namespace restrictions
* Tool policies
* Routing metadata

Agent registries are validated once at `mountPack()` time.

Strict namespace binding ensures agents cannot escape their configured domain.

---

# 🧭 Router Contract (Provider-Agnostic)

`@knolo/core` does not call Ollama or any provider.

It defines strict contracts:

```ts
type RouteDecisionV1 = {
  type: 'route_decision';
  intent?: string;
  entities?: Record<string, unknown>;
  candidates: { agentId: string; score: number }[];
  selected: string;
};
```

You may:

1. Call any router model.
2. Validate output via `isRouteDecisionV1`.
3. Enforce registry consistency via `validateRouteDecisionV1`.
4. Select deterministically with `selectAgentIdFromRouteDecisionV1`.

No runtime ambiguity.

---

# 🛠 Tool Call Contract

```ts
type ToolCallV1 = {
  type: 'tool_call';
  callId: string;
  tool: string;
  args: Record<string, unknown>;
};
```

Policy enforcement:

* `isToolAllowed`
* `assertToolAllowed`
* `assertToolCallAllowed`

Deterministic failures. No silent bypass.

---

# 🗂 Repo Structure

```
.
├── packages/
│   ├── core
│   ├── cli
│   ├── langchain
│   ├── llamaindex
│   └── create-knolo-app
└── examples/
```

---

# ⚙️ Design Guarantees

* Lexical retrieval is deterministic
* Hybrid rerank is deterministic for fixed vectors
* No vector DB required
* No cloud dependency required
* Works offline
* Works in React Native / Expo
* Binary pack format versioned

---

# 🛠 Pack Format

Binary layout:

```
[metaLen][meta]
[lexLen][lexicon]
[postCount][postings]
[blocksLen][blocks]
[semantic?]
```

Semantic section is optional and auto-detected.

---

# 🗺 Roadmap

* Hybrid evaluation tooling
* Incremental pack updates
* Better diagnostics & introspection
* Continued local-first performance tuning

---

# 🌐 Website

Docs & updates:

**[https://www.knolo.dev/](https://www.knolo.dev/)**

---

# 📄 License

Apache-2.0 — see `LICENSE`

