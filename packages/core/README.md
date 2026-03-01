# 📦 `@knolo/core`

`@knolo/core` is the **deterministic retrieval engine and pack runtime** behind Knolo.

It lets you:

* Build structured knowledge packs
* Mount portable `.knolo` artifacts
* Run deterministic lexical retrieval
* Optionally apply hybrid semantic reranking
* Enforce strict runtime contracts for advanced workflows

No vector database required.
No cloud dependency required.
Works fully offline.

---

# 🧠 What It Is

`@knolo/core` is **not**:

* A vector database wrapper
* A hosted RAG service
* A probabilistic similarity engine

It is:

* A versioned binary pack format
* A deterministic lexical retrieval engine
* An optional semantic rerank layer
* A portable knowledge runtime

You build once.
You mount anywhere — Node, browser, React Native, serverless, offline.

---

# 📊 Retrieval Characteristics

Lexical retrieval is:

* Deterministic
* Reproducible
* Stable across runs
* Independent of embeddings

Hybrid reranking is:

* Optional
* Deterministic for fixed vectors
* Lexical-first (semantic never replaces grounding)

In benchmark testing (March 2026):

* **Recall@5:** 1.000
* **MRR@5:** 0.867
* **nDCG@5:** 0.900

Strong ranking quality without requiring a vector database.

---

# 📦 Installation

```bash
npm install @knolo/core
```

---

# 🚀 Core Concepts

## 1️⃣ Build a Pack

```ts
import { buildPack } from "@knolo/core";

const bytes = await buildPack(docs, {
  semantic: {
    enabled: false
  }
});
```

`buildPack` produces a versioned `.knolo` binary artifact.

You can write it to disk or store it in object storage.

---

## 2️⃣ Mount a Pack

```ts
import { mountPack } from "@knolo/core";

const pack = await mountPack({
  src: "./dist/knowledge.knolo"
});
```

You can mount from:

* File path
* Buffer / Uint8Array
* Remote fetch response
* Object storage download

Mount-time validation ensures:

* Pack version compatibility
* Metadata integrity
* Optional agent registry validation

---

## 3️⃣ Query (Deterministic Lexical Retrieval)

```ts
import { query } from "@knolo/core";

const hits = query(pack, "debounce vs throttle", {
  topK: 5
});

for (const hit of hits) {
  console.log(hit.text);
  console.log(hit.metadata); // { score, source, namespace, id }
}
```

Properties:

* Fully deterministic
* No embedding dependency
* Namespace-aware
* Evaluation-friendly scoring

---

# 🔀 Optional: Hybrid Semantic Rerank

Semantic rerank runs **after lexical retrieval**.

It never replaces lexical grounding.

## Build with embeddings

```ts
const bytes = await buildPack(docs, {
  semantic: {
    enabled: true,
    modelId: "text-embedding-3-small",
    embeddings,
    quantization: {
      type: "int8_l2norm",
      perVectorScale: true
    }
  }
});
```

## Query with rerank

```ts
import { hasSemantic } from "@knolo/core";

const hits = query(pack, "react native throttling issue", {
  topK: 8,
  semantic: {
    enabled: hasSemantic(pack),
    mode: "rerank",
    topN: 50,
    minLexConfidence: 0.35,
    blend: { enabled: true, wLex: 0.75, wSem: 0.25 },
    queryEmbedding
  }
});
```

Design principles:

* Lexical-first
* Deterministic scoring
* No external vector store
* Quantized embedding storage inside pack

---

# 🤖 Optional: Agent Metadata & Routing

Knolo is a knowledge engine first.

However, packs may optionally embed structured metadata for:

* System prompts
* Namespace restrictions
* Tool policies
* Routing hints

Agent registries are validated once at `mountPack()`.

These features are additive and do not affect retrieval.

---

# 🛠 Runtime Contracts (Advanced)

For strict deterministic workflows:

## RouteDecisionV1

```ts
type RouteDecisionV1 = {
  type: "route_decision";
  intent?: string;
  entities?: Record<string, unknown>;
  candidates: { agentId: string; score: number }[];
  selected: string;
};
```

## ToolCallV1

```ts
type ToolCallV1 = {
  type: "tool_call";
  callId: string;
  tool: string;
  args: Record<string, unknown>;
};
```

Helpers:

```ts
import {
  isRouteDecisionV1,
  validateRouteDecisionV1,
  isToolAllowed,
  assertToolCallAllowed
} from "@knolo/core";
```

Enables:

* Deterministic routing validation
* Policy enforcement
* Tool permission checks
* Structured AI pipelines

These are optional — not required for standard retrieval usage.

---

# 📁 `.knolo` Pack Format

Binary layout:

```
[metaLen][meta]
[lexLen][lexicon]
[postCount][postings]
[blocksLen][blocks]
[semantic?]
```

Properties:

* Versioned
* Compact
* Immutable
* Semantic section auto-detected
* Designed for fast mount + query

---

# ⚙️ Design Guarantees

* Deterministic lexical retrieval
* Deterministic hybrid rerank (fixed vectors)
* No vector database required
* No cloud dependency required
* Works offline
* Works in React Native / Expo
* Portable binary artifacts

---

# 🔐 Ideal For

* Local-first AI systems
* Offline assistants
* On-device LLM retrieval
* Secure / air-gapped environments
* Deterministic RAG pipelines
* Evaluation-heavy workflows

---

# 🗺 Roadmap

* Incremental pack updates
* Evaluation tooling
* Performance introspection APIs
* WASM builds
* Continued local-first optimization

---

# 📄 License

Apache-2.0




