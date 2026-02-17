# 🧠 KnoLo Core

[![npm version](https://img.shields.io/npm/v/knolo-core.svg)](https://www.npmjs.com/package/knolo-core)
[![npm downloads](https://img.shields.io/npm/dm/knolo-core.svg)](https://www.npmjs.com/package/knolo-core)
[![npm license](https://img.shields.io/npm/l/knolo-core.svg?cacheBust=2)](https://www.npmjs.com/package/knolo-core)
[![GitHub license](https://img.shields.io/github/license/HiveForensics-AI/knolo-core.svg)](https://github.com/HiveForensics-AI/knolo-core/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-knolo.dev-2ea44f?logo=vercel)](https://www.knolo.dev/)

**KnoLo Core** is a **local-first knowledge retrieval engine** for LLM apps.
Build a portable `.knolo` pack and run deterministic lexical retrieval with optional semantic reranking using quantized embeddings.

- ✅ Local/offline-first runtime
- ✅ Deterministic lexical ranking and filtering
- ✅ Optional embedding-aware hybrid retrieval (no external vector DB required)
- ✅ Node.js + browser + React Native / Expo support

---

## ✨ What’s in v0.3.0

- **Deterministic lexical quality upgrades**
  - required phrase enforcement (quoted + `requirePhrases`)
  - corpus-aware BM25L with true IDF and block-length normalization
  - proximity bonus via minimal term-span cover
  - optional heading overlap boosts
  - deterministic pseudo-relevance query expansion
- **Hybrid retrieval support**
  - optional semantic rerank over top lexical candidates
  - int8 L2-normalized embedding quantization with per-vector float16 scales
  - weighted lexical/semantic score blending controls
- **Stability & diversity**
  - near-duplicate suppression + MMR diversity
  - KNS tie-break signal for stable close-score ordering
- **Portable packs**
  - single `.knolo` artifact
  - semantic payload embedded directly in pack when enabled

---

## 📦 Install

```bash
npm install knolo-core
```

Build from source:

```bash
git clone https://github.com/HiveForensics-AI/knolo-core.git
cd knolo-core
npm install
npm run build
```

---

## 🚀 Quickstart

### 1) Build + mount + query

```ts
import { buildPack, mountPack, query, makeContextPatch } from "knolo-core";

const docs = [
  {
    id: "bridge-guide",
    namespace: "mobile",
    heading: "React Native Bridge",
    text: "The bridge sends messages between JS and native modules. Throttling limits event frequency."
  },
  {
    id: "perf-notes",
    namespace: "mobile",
    heading: "Debounce vs Throttle",
    text: "Debounce waits for silence; throttle enforces a maximum trigger rate."
  }
];

const bytes = await buildPack(docs);
const kb = await mountPack({ src: bytes });

const hits = query(kb, '"react native" throttle', {
  topK: 5,
  requirePhrases: ["maximum trigger rate"],
  namespace: "mobile"
});

const patch = makeContextPatch(hits, { budget: "small" });
console.log(hits, patch);
```

### 2) CLI pack build

`docs.json`:

```json
[
  { "id": "guide", "heading": "Guide", "text": "Install deps.\n\n## Throttle\nLimit event frequency." },
  { "id": "faq", "heading": "FAQ", "text": "What is throttling? It reduces event frequency." }
]
```

```bash
npx knolo docs.json knowledge.knolo
```

Then query in app:

```ts
import { mountPack, query } from "knolo-core";

const kb = await mountPack({ src: "./knowledge.knolo" });
const hits = query(kb, "throttle events", { topK: 3 });
```

---

## 🔀 Hybrid retrieval with embeddings (recommended direction)

KnoLo’s core retrieval remains lexical-first and deterministic. Semantic signals are added as an **optional rerank stage** when lexical confidence is low (or forced).

### Build a semantic-enabled pack

```ts
import { buildPack } from "knolo-core";

// embeddings must align 1:1 with docs/block order
const embeddings: Float32Array[] = await embedDocumentsInOrder(docs);

const bytes = await buildPack(docs, {
  semantic: {
    enabled: true,
    modelId: "text-embedding-3-small",
    embeddings,
    quantization: { type: "int8_l2norm", perVectorScale: true }
  }
});
```

### Query with semantic rerank

```ts
import { mountPack, query, hasSemantic } from "knolo-core";

const kb = await mountPack({ src: bytes });
const queryEmbedding = await embedQuery("react native bridge throttling");

const hits = query(kb, "react native bridge throttling", {
  topK: 8,
  semantic: {
    enabled: hasSemantic(kb),
    mode: "rerank",
    topN: 50,
    minLexConfidence: 0.35,
    blend: { enabled: true, wLex: 0.75, wSem: 0.25 },
    queryEmbedding,
    force: false
  }
});
```

### Semantic helper utilities

```ts
import {
  quantizeEmbeddingInt8L2Norm,
  encodeScaleF16,
  decodeScaleF16
} from "knolo-core";

const { q, scale } = quantizeEmbeddingInt8L2Norm(queryEmbedding);
const packed = encodeScaleF16(scale);
const restored = decodeScaleF16(packed);
```

---

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
  semantic?: {
    enabled: boolean;
    modelId: string;
    embeddings: Float32Array[];
    quantization?: {
      type: "int8_l2norm";
      perVectorScale?: true;
    };
  };
};
```

### `mountPack({ src }) => Promise<Pack>`

```ts
type Pack = {
  meta: {
    version: number;
    stats: { docs: number; blocks: number; terms: number; avgBlockLen?: number };
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
    encoding: "int8_l2norm";
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
    mode?: "rerank";
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

### `makeContextPatch(hits, { budget }) => ContextPatch`

Budgets: `"mini" | "small" | "full"`

---

## 📚 More usage examples

### Namespace + source filtering

```ts
const hits = query(kb, "retry backoff", {
  namespace: ["sdk", "api"],
  source: ["errors-guide", "http-reference"],
  topK: 6
});
```

### Phrase-only retrieval fallback behavior

If your query has no free tokens but includes required phrases, KnoLo still forms candidates from phrase tokens and enforces phrase presence.

```ts
const hits = query(kb, '"event loop"', { requirePhrases: ["single thread"] });
```

### Precision mode with minimum score

```ts
const strictHits = query(kb, "jwt refresh token rotation", {
  topK: 5,
  minScore: 2.5
});
```

### Validate semantic query options early

```ts
import { validateSemanticQueryOptions } from "knolo-core";

validateSemanticQueryOptions({
  enabled: true,
  topN: 40,
  minLexConfidence: 0.3,
  blend: { enabled: true, wLex: 0.8, wSem: 0.2 },
  queryEmbedding
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

## 🗺️ Direction / roadmap

- stronger hybrid retrieval evaluation tooling
- richer pack introspection and diagnostics
- incremental pack update workflows
- continued local-first performance optimization

---

## 🌐 Website

For docs, release updates, and examples: **[knolo.dev](https://www.knolo.dev/)**

## 📄 License

Apache-2.0 — see [LICENSE](./LICENSE).
