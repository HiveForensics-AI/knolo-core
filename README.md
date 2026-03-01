# 🧠 Knolo

Knolo is a **local-first knowledge base engine** built around deterministic retrieval and portable `.knolo` packs.

It provides:

* `@knolo/core` — pack format + deterministic retrieval engine
* `@knolo/cli` — build workflows for `.knolo` artifacts
* `create-knolo-app` — instant Next.js starter with playground
* `@knolo/langchain` — LangChain-style retriever adapter
* `@knolo/llamaindex` — LlamaIndex-style retriever adapter

Knolo prioritizes:

* Deterministic lexical retrieval
* Optional hybrid semantic reranking
* Zero vector database requirement
* Local-first execution (offline capable)
* Portable binary knowledge packs
* Strict runtime contracts (optional advanced features)

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

# 🔍 What Knolo Actually Is

Knolo is **not a vector database wrapper**.
It is **not a hosted retrieval service**.

Knolo is:

* A structured, versioned binary pack format
* A deterministic lexical retrieval engine
* An optional hybrid rerank layer
* A portable knowledge artifact you can ship anywhere

You build `.knolo` packs once.
You mount them anywhere — Node, web, React Native, offline.

Retrieval is lexical-first and deterministic by default.

Hybrid semantic reranking is optional and **never replaces lexical grounding**.

---

# 📦 Packages

| Package             | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `@knolo/core`       | Pack builder, pack loader, deterministic retrieval engine |
| `@knolo/cli`        | CLI for building `.knolo` artifacts                       |
| `create-knolo-app`  | Next.js scaffolding with playground                       |
| `@knolo/langchain`  | LangChain-style retriever interface                       |
| `@knolo/llamaindex` | LlamaIndex-style retriever interface                      |

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

# 🔌 LangChain-Style Usage

```ts
import { mountPack } from '@knolo/core';
import { KnoLoRetriever } from '@knolo/langchain';

const pack = await mountPack({ src: './dist/knowledge.knolo' });
const retriever = new KnoLoRetriever({ pack, topK: 5 });

const docs = await retriever.getRelevantDocuments(
  'How do I configure Knolo?'
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

# 🧠 Optional: Agent Metadata & Routing

Knolo is a knowledge base first.

However, packs may optionally embed structured metadata for:

* System prompts
* Namespace restrictions
* Tool policies
* Routing hints

Agent registries are validated once at `mountPack()` time.

Strict namespace binding ensures agents cannot escape configured domains.

These features are **additive** — they do not change the retrieval-first architecture.

---

# 🛠 Runtime Contracts (Optional Advanced Features)

Knolo defines strict validation contracts for:

## RouteDecisionV1

```ts
type RouteDecisionV1 = {
  type: 'route_decision';
  intent?: string;
  entities?: Record<string, unknown>;
  candidates: { agentId: string; score: number }[];
  selected: string;
};
```

## ToolCallV1

```ts
type ToolCallV1 = {
  type: 'tool_call';
  callId: string;
  tool: string;
  args: Record<string, unknown>;
};
```

Validation helpers:

* `isRouteDecisionV1`
* `validateRouteDecisionV1`
* `isToolAllowed`
* `assertToolCallAllowed`

These enable deterministic policy enforcement for advanced workflows.

They are not required for standard retrieval usage.

---

# 🗂 Repository Structure

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
* Binary pack format is versioned

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

