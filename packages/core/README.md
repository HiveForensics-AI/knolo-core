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
* A deterministic `LivePack` overlay for mounted packs
* An optional semantic rerank layer
* A portable knowledge runtime
* A separate append-only Cortex memory layer

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

### Node.js (local path convenience)

```ts
import { mountPack } from "@knolo/core/node";

const pack = await mountPack({
  src: "./dist/knowledge.knolo"
});
```

### React Native / Expo (URL or bytes)

```ts
import { mountPack } from "@knolo/core";

const ab = await (await fetch(PACK_URL)).arrayBuffer();
const pack = await mountPack({ src: new Uint8Array(ab) });
```

You can mount from:

* URL string (runtime-safe entry)
* Buffer / Uint8Array
* Local file path in Node via `@knolo/core/node`
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

For iterative pack builds, use `knolo dev` as the watch/rebuild workflow. We are keeping that flow instead of introducing `build --watch` in this phase.

---

## 4️⃣ LivePack Overlay

`LivePack` is a deterministic mutable overlay on top of a mounted base pack.

It is phase-1 lexical/graph-only. Stable doc ids are required for the initial `docs` array and for every live mutation, and semantic live updates are rejected until the embedding story exists.

Construction accepts `LivePackOptions` for graph settings such as `maxEdgesPerDoc`, but semantic live options stay disabled in v1.

It is designed for document-style live updates:

* `addDocument()` inserts or replaces a live doc by stable id
* `updateDocument()` merges partial fields onto the last known full doc and shadows any base copy
* `removeDocument()` tombstones a doc id and hides the base copy
* `query()` returns the same `Hit[]` shape as `query(pack, ...)`
* `serialize()` materializes the merged live state as a normal `.knolo` snapshot
* repeated `serialize()` calls on the same state are byte-identical

Live querying in v1 stays lexical/graph-only.
Semantic build or query options are rejected until live embeddings are added.

```ts
import { createLivePack, mountPack, query } from '@knolo/core';

const base = await mountPack({ src: './dist/knowledge.knolo' });
const live = await createLivePack(base, [
  { id: 'notes.alpha', text: 'alpha note', namespace: 'notes' },
]);

await live.addDocument({ id: 'notes.beta', text: 'beta note' });
await live.updateDocument({ id: 'notes.alpha', text: 'alpha note v2' });
await live.removeDocument('notes.beta');
await live.addDocument({ id: 'notes.beta', text: 'beta note restored' });

const hits = live.query('alpha note', { topK: 5 });
const snapshot = await live.serialize();
const rebuilt = await mountPack({ src: snapshot });
const roundTripHits = query(rebuilt, 'beta note', { topK: 5 });
```

For the phase-1 rollout notes and test matrix, see [`../../LIVE_KBS_MVP.md`](../../LIVE_KBS_MVP.md).

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

# 🧠 Knolo Cortex

Knolo Cortex is a local-first overlay memory layer for `.knolo` packs.

It gives you:

* Deterministic append-only memory writes
* Lexical-first recall with label and namespace filters
* Portable memory logs you can serialize and replay
* Consolidation back into pack docs without mutating the pack itself
* Deterministic graph export via `memoryToClaimOps()`

## Example

```ts
import {
  buildPack,
  consolidateMemories,
  createCortex,
  mountPack,
  recall,
  remember,
} from "@knolo/core";

const cortex = createCortex({ actor: "notes-app" });
const { cortex: next, memory } = remember(cortex, {
  kind: "note",
  text: "Project alpha uses a local-first memory overlay.",
  labels: ["project.alpha"],
  namespace: "project.alpha",
});

const hits = recall(next, "project alpha");
const docs = consolidateMemories(next, { namespacePrefix: "memory" });
const bytes = await buildPack(docs);
const pack = await mountPack({ src: bytes });
```

If you need to load a local file in Node, use `@knolo/core/node` or read the bytes first and pass a `Uint8Array` into `mountPack()`.

## Cortex API

```ts
import {
  createCortex,
  remember,
  forget,
  labelMemory,
  linkMemories,
  recall,
  consolidateMemories,
  memoryToClaimOps,
} from "@knolo/core";
```

* `createCortex({ actor?, now?, log? })` creates an immutable memory runtime
* `remember()` appends a new memory entry
* `forget()` tombstones a memory
* `labelMemory()` adds labels without mutating the original cortex
* `linkMemories()` records deterministic memory relationships
* `recall()` ranks memories with lexical-first scoring
* `consolidateMemories()` converts selected memories back into `BuildInputDoc[]`
* `memoryToClaimOps()` emits deterministic ClaimGraph ops for memory nodes, labels, and links

The full example lives in [`examples/memory-overlay/README.md`](../../examples/memory-overlay/README.md).

---

# 🗺 Roadmap

* Incremental pack updates
* Evaluation tooling
* Performance introspection APIs
* WASM builds
* Continued local-first optimization

---

# 🕸 ClaimGraph API

`@knolo/core` includes a deterministic ClaimGraph subsystem.

## Build-time config

```ts
type BuildPackOptions = {
  graph?: {
    enabled?: boolean; // default true
    maxEdgesPerDoc?: number; // default 500
  };
};
```

## Query-time config

```ts
type QueryOptions = {
  graph?: {
    expand?: boolean; // default false
    maxExtraTerms?: number; // default 12
    predicates?: string[]; // default ['defined_as', 'is', 'mentions', 'ref']
  };
};
```

## Exports

```ts
import {
  buildClaimGraph,
  getClaimGraph,
  applyClaimGraphLog,
  mergeClaimGraphLogs,
  expandQueryWithGraph,
  createGraphLog,
  appendOp,
} from '@knolo/core';
```

Types:

* `ClaimNode`
* `ClaimEdge`
* `ClaimGraph`
* `ClaimOp`
* `ClaimGraphLog`

## Notes on determinism and bounds

* Node IDs are hash-derived from normalized labels.
* Edge IDs are hash-derived from `(from, predicate, to, evidence)`.
* Node labels are normalized and deterministically truncated.
* Evidence arrays are sorted + unique.
* Node/edge arrays are sorted by ID in final graph.
* Extraction is bounded with `maxEdgesPerDoc`.
* Query expansion is bounded with `maxExtraTerms` and stable ordering.

## Pack format note

`.knolo` binary layout now supports an optional trailing ClaimGraph JSON section after existing sections.
Runtimes that ignore unknown trailing bytes remain compatible.

---

# 📄 License

Apache-2.0
