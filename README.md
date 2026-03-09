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

# 📊 Retrieval Benchmark (March 2026)

Knolo was evaluated using a deterministic lexical-first + optional rerank configuration.

**Run:** 2026-03-01
**TopK:** 5

### Aggregate Metrics

| Metric      | Score     |
| ----------- | --------- |
| Precision@5 | **0.490** |
| Recall@5    | **1.000** |
| MRR@5       | **0.867** |
| nDCG@5      | **0.900** |

### Interpretation

* ✅ **Recall@5 = 1.0** → All relevant documents were retrieved in every test query.
* ✅ **High MRR (0.867)** → Relevant documents appear near the top.
* ✅ **Strong nDCG (0.900)** → Ranking quality is consistently high.
* 🔍 Precision reflects lexical grounding before rerank — by design, Knolo prioritizes deterministic recall over aggressive pruning.

This benchmark demonstrates:

* Deterministic lexical retrieval is highly reliable.
* Hybrid reranking improves ranking quality without sacrificing grounding.
* No vector database is required to achieve strong retrieval performance.

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
import { mountPack } from '@knolo/core/node';
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
import { mountPack } from '@knolo/core/node';
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

# 📱 Expo / React Native Mounting

Use the runtime-safe entrypoint (`@knolo/core`) and pass URL/bytes.
For local filesystem paths in Node.js, use `@knolo/core/node`.

```ts
import { mountPack } from '@knolo/core';

const ab = await (await fetch(PACK_URL)).arrayBuffer();
const pack = await mountPack({ src: new Uint8Array(ab) });
```

Node-only local path usage:

```ts
import { mountPack } from '@knolo/core/node';

const pack = await mountPack({ src: './dist/knowledge.knolo' });
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

## Semantic sidecar workflow (Ollama, optional)

Lexical retrieval is still the first-pass and default. Sidecars add optional local reranking over lexical top-N candidates (no vector DB, no `.knolo` format migration).

```bash
# 1) Build deterministic lexical pack
knolo build

# 2) Generate local semantic sidecar (requires Ollama running)
knolo semantic:index --pack ./dist/knowledge.knolo --out ./dist/knowledge.knolo.semantic.json --model qwen3-embedding:4b

# 3) Inspect and validate sidecar before query-time use
knolo semantic:inspect --sidecar ./dist/knowledge.knolo.semantic.json
knolo semantic:validate --pack ./dist/knowledge.knolo --sidecar ./dist/knowledge.knolo.semantic.json --model qwen3-embedding:4b
```

Troubleshooting:
- If Ollama is not running, start it and ensure `http://localhost:11434` is reachable.
- If model is missing, run `ollama pull qwen3-embedding:4b`.
- If validate fails for fingerprint/model mismatch, regenerate sidecar with the current pack and exact model.

---

# 🧠 Optional: Agent Metadata & Routing

Knolo is a knowledge base first.

Packs may optionally embed structured metadata for:

* System prompts
* Namespace restrictions
* Tool policies
* Routing hints

Agent registries are validated once at `mountPack()` time.

Strict namespace binding ensures agents cannot escape configured domains.

These features are additive — they do not change the retrieval-first architecture.

---

# 🛠 Runtime Contracts (Optional Advanced Features)

Knolo defines strict validation contracts for deterministic workflows:

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

Helpers:

* `isRouteDecisionV1`
* `validateRouteDecisionV1`
* `isToolAllowed`
* `assertToolCallAllowed`

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

* Deterministic lexical retrieval
* Deterministic hybrid rerank (fixed vectors)
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



---

# 🕸 ClaimGraph (Deterministic Knowledge Graph + Delta Logs)

Knolo packs can now embed an optional **ClaimGraph** section built deterministically from source docs.

What it adds:

* Deterministic node/edge extraction from markdown links, wiki links, headings, and conservative `X is Y` sentences.
* Pack-embedded base graph (`meta.claimGraph`) with stable IDs and sorted ordering.
* Agent-shareable append-only **ClaimGraphLog** overlays for offline collaboration.

Determinism guarantees:

* Same docs + options → same graph JSON and pack bytes.
* Stable hash IDs for nodes and edges.
* Sorted nodes/edges, sorted evidence arrays, deterministic caps.

## Build a pack with ClaimGraph

```ts
import { buildPack } from '@knolo/core';

const bytes = await buildPack(docs, {
  graph: {
    enabled: true,
    maxEdgesPerDoc: 500,
  },
});
```

## Mount and inspect ClaimGraph

```ts
import { mountPack, getClaimGraph } from '@knolo/core';

const pack = await mountPack({ src: bytes });
const graph = getClaimGraph(pack);

console.log(pack.meta.claimGraph); // { version: 1, nodes, edges }
console.log(graph?.edges.slice(0, 3));
```

## Agent-shared delta logs

```ts
import {
  createGraphLog,
  appendOp,
  mergeClaimGraphLogs,
  applyClaimGraphLog,
} from '@knolo/core';

let a = createGraphLog();
a = appendOp(a, {
  op: 'upsert_node',
  label: 'Delta Log',
  ts: 1710000000000,
  actor: 'agent.alpha',
});

let b = createGraphLog();
b = appendOp(b, {
  op: 'add_edge',
  from: 'n_1234abcd',
  p: 'mentions',
  to: 'n_7890ef12',
  ts: 1710000000100,
  actor: 'agent.beta',
});

const merged = mergeClaimGraphLogs(a, b);
const effectiveGraph = applyClaimGraphLog(graph ?? { version: 1, nodes: [], edges: [] }, merged);
```

## Optional deterministic graph-based query expansion

```ts
import { query } from '@knolo/core';

const hits = query(pack, 'knolo determinism', {
  topK: 5,
  graph: {
    expand: true,
    maxExtraTerms: 12,
    predicates: ['defined_as', 'is', 'mentions', 'ref'],
  },
});
```

---

# 📄 License

Apache-2.0 — see `LICENSE`
