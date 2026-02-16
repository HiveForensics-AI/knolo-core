
# 🧠 KnoLo Core

[![npm version](https://img.shields.io/npm/v/knolo-core.svg)](https://www.npmjs.com/package/knolo-core)
[![npm downloads](https://img.shields.io/npm/dm/knolo-core.svg)](https://www.npmjs.com/package/knolo-core)
[![npm license](https://img.shields.io/npm/l/knolo-core.svg?cacheBust=2)](https://www.npmjs.com/package/knolo-core)
[![GitHub license](https://img.shields.io/github/license/HiveForensics-AI/knolo-core.svg)](https://github.com/HiveForensics-AI/knolo-core/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-knolo.dev-2ea44f?logo=vercel)](https://www.knolo.dev/)



**KnoLo Core** is a **local-first knowledge base** for small LLMs.
Package documents into a compact `.knolo` file and query them deterministically —
**no embeddings, no vector DB, no cloud**. Ideal for **on‑device / offline** assistants.

---

## ✨ Highlights (v0.3.0)

* 🔎 **Stronger relevance:**

  * **Required phrase enforcement** (quoted & `requirePhrases`)
  * **Proximity bonus** using minimal term-span cover
  * **Optional heading boosts** when headings are present
* 🌀 **Duplicate-free results:** **near-duplicate suppression** + **MMR diversity**
* 🧮 **KNS tie‑breaker:** lightweight numeric signature to stabilize close ties
* ⚡ **Faster & leaner:** precomputed `avgBlockLen` and per-block token lengths in pack metadata
* 📈 **More accurate ranking:** corpus-aware BM25L with true IDF + document-length normalization
* 🧷 **Correct postings decoding:** block IDs are encoded as `bid + 1` so delimiter `0` remains unambiguous
* 📱 **Works in Expo/React Native:** safe TextEncoder/TextDecoder ponyfills
* 📑 **Context Patches:** LLM‑friendly snippets for prompts
* 🔒 **Local & private:** everything runs on device

---

## 📦 Install

```bash
npm install knolo-core
```

Dev from source:

```bash
git clone https://github.com/HiveForensics-AI/knolo-core.git
cd knolo-core
npm install
npm run build
```

---

## 🚀 Usage

### 1) Node.js (build → mount → query → patch)

```ts
import { buildPack, mountPack, query, makeContextPatch } from "knolo-core";

const docs = [
  { id: "guide",   heading: "React Native Bridge", text: "The bridge sends messages between JS and native. You can throttle events..." },
  { id: "throttle", heading: "Throttling",         text: "Throttling reduces frequency of events to avoid flooding the bridge." },
  { id: "dvst",     heading: "Debounce vs Throttle", text: "Debounce waits for silence; throttle guarantees a max rate." }
];

const bytes = await buildPack(docs);              // build .knolo bytes
const kb = await mountPack({ src: bytes });       // mount in-memory
const hits = query(kb, '“react native” throttle', // quotes enforce phrase
  { topK: 5, requirePhrases: ["max rate"] });

console.log(hits);
/*
[
  { blockId: 2, score: 6.73, text: "...", source: "dvst" },
  ...
]
*/

const patch = makeContextPatch(hits, { budget: "small" });
console.log(patch);
```

### 2) CLI (build a `.knolo` file)

Create `docs.json`:

```json
[
  { "id": "guide", "heading": "Guide", "text": "Install deps...\n\n## Throttle\nLimit frequency of events." },
  { "id": "faq",   "heading": "FAQ",   "text": "What is throttling? It reduces event frequency." }
]
```

Build:

```bash
# writes knowledge.knolo
npx knolo docs.json knowledge.knolo
```

Then load it in your app:

```ts
import { mountPack, query } from "knolo-core";
const kb = await mountPack({ src: "./knowledge.knolo" });
const hits = query(kb, "throttle events", { topK: 3 });
```

### 3) React / Expo

```ts
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import { mountPack, query } from "knolo-core";

async function loadKB() {
  const asset = Asset.fromModule(require("./assets/knowledge.knolo"));
  await asset.downloadAsync();

  const base64 = await FileSystem.readAsStringAsync(asset.localUri!, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  const kb = await mountPack({ src: bytes.buffer });
  return query(kb, `“react native” throttling`, { topK: 5 });
}
```

---

## 📑 API

### `buildPack(docs) -> Promise<Uint8Array>`

Builds a pack from an array of documents.

```ts
type BuildInputDoc = {
  id?: string;          // optional doc id (exposed as hit.source)
  heading?: string;     // optional heading (used for boosts)
  text: string;         // raw markdown accepted (lightly stripped)
};
```

* Stores optional `heading` and `id` alongside each block.
* Validates builder input shape and throws actionable errors for malformed docs.
* Computes and persists `meta.stats.avgBlockLen` plus per-block token length (`len`) for stable scoring.

### `mountPack({ src }) -> Promise<Pack>`

Loads a pack from a URL, `Uint8Array`, or `ArrayBuffer`.

```ts
type Pack = {
  meta: { version: number; stats: { docs: number; blocks: number; terms: number; avgBlockLen?: number } };
  lexicon: Map<string, number>;
  postings: Uint32Array;
  blocks: string[];
  headings?: (string | null)[];
  docIds?: (string | null)[];
  blockTokenLens?: number[];
};
```

> **Compatibility:** v0.2.0 reads both v1 packs (string-only blocks) and v2 packs (objects with `text/heading/docId`).

### `query(pack, q, opts) -> Hit[]`

Deterministic lexical search with phrase enforcement, proximity, and de‑duplication.

```ts
type QueryOptions = {
  topK?: number;                // default 10
  requirePhrases?: string[];    // additional phrases to require (unquoted)
};

type Hit = {
  blockId: number;
  score: number;
  text: string;
  source?: string;              // docId if provided at build time
};
```

**What happens under the hood (v0.3.0):**

* Tokenize + **enforce all phrases** (quoted in `q` and `requirePhrases`)
* Candidate generation via inverted index + query-time DF collection
* Corpus-aware BM25L (true IDF + length normalization from persisted block lengths)
* **Proximity bonus** using minimal window covering all query terms
* Optional **heading overlap boost** (when headings are present)
* Tiny **KNS** numeric-signature tie‑breaker (\~±2% influence)
* **Near-duplicate suppression** (5‑gram Jaccard) + **MMR** diversity for top‑K

### `makeContextPatch(hits, { budget }) -> ContextPatch`

Create structured snippets for LLM prompts.

```ts
type ContextPatch = {
  background: string[];
  snippets: Array<{ text: string; source?: string }>;
  definitions: Array<{ term: string; def: string; evidence?: number[] }>;
  facts: Array<{ s: string; p: string; o: string; evidence?: number[] }>;
};
```

Budgets: `"mini" | "small" | "full"`.

---

## 🧠 Relevance & De‑dupe Details

* **Phrases:**
  Quoted phrases in the query (e.g., `“react native”`) and any `requirePhrases` **must appear** in results. Candidates failing this are dropped before ranking.

* **Proximity:**
  We compute the **minimum span** that covers all query terms and apply a gentle multiplier:
  `1 + 0.15 / (1 + span)` (bounded, stable).

* **Heading Boost:**
  If you provide headings at build time, overlap with query terms boosts the score proportionally to the fraction of unique query terms present in the heading.

* **Duplicate Control:**
  We use **5‑gram Jaccard** to filter near‑duplicates and **MMR** (λ≈0.8) to promote diversity within the top‑K.

* **KNS Signature (optional spice):**
  A tiny numeric signature provides deterministic tie‑breaking without changing the overall retrieval behavior.

---

## 🛠 Input Format & Pack Layout

**Input docs:**
`{ id?: string, heading?: string, text: string }`

**Pack layout (binary):**
`[metaLen:u32][meta JSON][lexLen:u32][lexicon JSON][postCount:u32][postings][blocksLen:u32][blocks JSON]`

* `meta.stats.avgBlockLen` is persisted (v2).
* `blocks JSON` may be:

  * **v1:** `string[]` (text only)
  * **v2:** `{ text, heading?, docId? }[]`

The runtime auto‑detects either format.

---

## 🔁 Migration (0.1.x → 0.2.0)

* **No API breaks.** `buildPack`, `mountPack`, `query`, `makeContextPatch` unchanged.
* Packs built with 0.1.x still load and query fine.
* If you want heading boosts and `hit.source`, pass `heading` and `id` to `buildPack`.
* React Native/Expo users no longer need polyfills—ponyfills are included.

---

## ⚡ Performance Tips

* Prefer multiple smaller blocks (≈512 tokens) over giant ones for better recall + proximity.
* Provide `heading` for each block: cheap, high‑signal boost.
* For large corpora, consider sharding packs by domain/topic to keep per‑pack size modest.

---

## ❓ FAQ

**Q: Does this use embeddings?**
No. Pure lexical retrieval (index, positions, BM25L, proximity, phrases).

**Q: Can I run this offline?**
Yes. Everything is local.

**Q: How do I prevent duplicates?**
It’s built in (Jaccard + MMR). You can tune λ and similarity threshold in code if you fork.

**Q: Is RN/Expo supported?**
Yes—TextEncoder/TextDecoder ponyfills are included.

---

## 🗺️ Roadmap

* Multi-resolution packs (summaries + facts)
* Overlay layers (user annotations)
* WASM core for big-browser indexing
* Delta updates / append-only patch packs

---

## 🌐 Website

For docs, news, and examples visit **[knolo.dev](https://www.knolo.dev/)**

---


## 📄 License

Apache-2.0 — see [LICENSE](./LICENSE).

