
# DOCS.md — KnoLo Core

> Deterministic, embedding-free retrieval and portable knowledge packs.

## Table of Contents

1. [What is KnoLo Core?](#what-is-knolo-core)
2. [Quickstart](#quickstart)
3. [Concepts](#concepts)
4. [Building Packs](#building-packs)
5. [Querying & Results](#querying--results)
6. [LLM Context Patches](#llm-context-patches)
7. [Advanced Retrieval Controls](#advanced-retrieval-controls)
8. [Pack Format (Spec)](#pack-format-spec)
9. [Performance & Tuning](#performance--tuning)
10. [React Native / Expo Notes](#react-native--expo-notes)
11. [Testing & QA](#testing--qa)
12. [Migration 0.1.x → 0.2.0](#migration-01x--020)
13. [Security & Privacy](#security--privacy)
14. [FAQ](#faq)
15. [Glossary](#glossary)
16. [Versioning & Releases](#versioning--releases)

---

## What is KnoLo Core?

KnoLo Core packages your corpus into a single `.knolo` file and performs **deterministic lexical retrieval**—no embeddings or vector DBs. It’s designed for **local-first, offline** LLM use.

**Key properties**

* **Deterministic**: phrase enforcement, proximity scoring, heading boosts
* **Duplicate-free**: near-duplicate suppression + MMR diversity
* **Portable**: single-pack file; Node, browsers, Expo
* **LLM-ready**: outputs structured **Context Patches**

---

## Quickstart

### Install

```bash
npm install knolo-core
```

### Minimal example

```ts
import { buildPack, mountPack, query, makeContextPatch } from "knolo-core";

const docs = [
  { id: "guide", namespace: "mobile", heading: "React Native Bridge", text: "The bridge sends messages between JS and native. You can throttle events..." },
  { id: "throttle", namespace: "mobile", heading: "Throttling", text: "Throttling reduces frequency of events..." }
];

const bytes = await buildPack(docs);
const kb = await mountPack({ src: bytes });
const hits = query(kb, '"react native bridge" throttling', { topK: 5 });
const patch = makeContextPatch(hits, { budget: "small" });
```

### CLI build

```bash
# input docs.json -> output knowledge.knolo
npx knolo docs.json knowledge.knolo
```

---

## Concepts

* **Pack (.knolo)**: single-file container with metadata, lexicon, postings, and blocks.
* **Block**: chunk of text (\~512 tokens recommended) with optional `heading` and `id`.
* **Deterministic Retrieval**: lexical signals (terms, phrases, positions), not embeddings.
* **Proximity**: bonus for smaller minimal span covering all query terms.
* **MMR**: Maximum Marginal Relevance to promote diversity in the top-K.
* **KNS**: tiny lexical numeric signature for stable tie-breaking.
* **Context Patch**: structured snippets for LLM prompts (budgeted).

---

## Building Packs

### Input format

```ts
type BuildInputDoc = {
  id?: string;          // exposed later as hit.source
  heading?: string;     // boosts relevance when overlapping query terms
  namespace?: string;   // optional namespace for scoped retrieval
  text: string;         // raw markdown accepted (lightly stripped)
};
```

### API

```ts
const bytes: Uint8Array = await buildPack(docs: BuildInputDoc[]);
```

**Tips**

* Prefer multiple smaller blocks (\~512 tokens).
* Provide `heading` for stronger field boosts.
* Use stable `id` if you want `hit.source`.

---

## Querying & Results

### API

```ts
type QueryOptions = {
  topK?: number;               // default 10
  minScore?: number;           // optional absolute score floor
  requirePhrases?: string[];   // phrases that must appear verbatim
  namespace?: string | string[]; // optional namespace filter(s)
  source?: string | string[];    // optional source/docId filter(s)
  queryExpansion?: {
    enabled?: boolean;         // default true
    docs?: number;             // top seed docs, default 3
    terms?: number;            // expanded lexical terms, default 4
    weight?: number;           // tf scaling for expansion terms, default 0.35
    minTermLength?: number;    // default 3
  };
};

type Hit = {
  blockId: number;
  score: number;
  text: string;
  source?: string;             // docId if provided
  namespace?: string;          // namespace if provided
};

const hits: Hit[] = query(pack, '“react native bridge” throttling', {
  topK: 5,
  requirePhrases: ["maximum rate"], // hard constraint
  namespace: "mobile",
  source: ["guide", "faq"]
});
```

**What the ranker does**

1. Enforces quoted/required phrases (hard filter)
2. Corpus-aware BM25L with true IDF, query-time DF collection, and per-block length normalization
3. **Proximity bonus** (minimal span cover)
4. **Heading overlap** boost
5. Deterministic **pseudo-relevance query expansion** from top lexical seeds
6. **KNS** tie-breaker (small, deterministic)
7. **De-dupe + MMR** diversity for final top-K

---

## LLM Context Patches

### API

```ts
type ContextPatch = {
  background: string[];
  snippets: Array<{ text: string; source?: string }>;
  definitions: Array<{ term: string; def: string; evidence?: number[] }>;
  facts: Array<{ s: string; p: string; o: string; evidence?: number[] }>;
};

const patch = makeContextPatch(hits, { budget: "mini" | "small" | "full" });
```

**Budgets**

* `mini` ≈ 512 tokens
* `small` ≈ 1k tokens
* `full` ≈ 2k tokens

**Best practices**

* Prefer `background` as setup lines for the system prompt.
* Place `snippets` nearest to the user’s question in the prompt.

---

## Advanced Retrieval Controls

### Require phrases (hard constraints)

```ts
query(pack, "throttling", { requirePhrases: ["react native bridge"] });
```

### Namespace-scoped retrieval

```ts
query(pack, "bridge events", { namespace: ["mobile", "sdk"] });
```

### Source/docId-scoped retrieval

```ts
query(pack, "throttling", { source: ["guide", "faq"] });
```

### Minimum score threshold

```ts
query(pack, "throttle bridge", { minScore: 2.5 });
```

Use this when you prefer precision over recall and only want confident lexical matches.

### Query expansion controls

```ts
query(pack, "throttle bridge", {
  queryExpansion: { enabled: true, docs: 4, terms: 6, weight: 0.3 }
});
```

This keeps retrieval lexical/deterministic while increasing recall for related vocabulary found in top-ranked seed blocks.

### Tight vs. scattered matches

Proximity bonus favors blocks where all query terms co-occur in a small span.

### Diversity

Top-K results apply near-duplicate suppression (5-gram Jaccard) and MMR (λ≈0.8).

**Tuning (if you fork)**

* Jaccard threshold default \~0.92
* MMR λ default \~0.8
* Proximity multiplier default \~0.15

---

## Pack Format (Spec)

**Binary layout**

```
[metaLen:u32][meta JSON]
[lexLen:u32][lexicon JSON]
[postCount:u32][postings u32[]]
[blocksLen:u32][blocks JSON]
```

**Meta JSON**

```json
{
  "version": 3,
  "stats": {
    "docs": <number>,
    "blocks": <number>,
    "terms": <number>,
    "avgBlockLen": <number> // optional in older packs
  }
}
```

**Lexicon JSON**

* Array of `[term, termId]` pairs.

**Postings**

* Flattened `Uint32Array`:

  ```
  termId, blockId+1, pos, pos, …, 0, blockId+1, …, 0, 0, termId, ...
  ```

  Block IDs are encoded as `bid + 1` so `0` is reserved as the delimiter. Each block section ends with `0`, each term section ends with `0`.

**Blocks JSON (v1 / v2)**

* **v1**: `string[]` (text only)
* **v2**: `{ text, heading?, docId? }[]`
* **v3**: `{ text, heading?, docId?, namespace?, len }[]` (`len` is block token length for stable ranking)

Runtime auto-detects and exposes:

```ts
type Pack = {
  meta, lexicon, postings, blocks: string[],
  headings?: (string|null)[],
  docIds?: (string|null)[],
  namespaces?: (string|null)[],
  blockTokenLens?: number[]
}
```

---

## Performance & Tuning

**Targets (typical)**

* Query < 50 ms on mid-range laptops (packs ≤ 200 MB)
* Memory < 10 MB for \~50k blocks
* Pack size ≈ 6–12% of raw text

**Tuning checklist**

* Split large documents into \~512-token blocks
* Provide informative `heading`s
* Shard packs by domain if you exceed 200–500 MB
* Cache mounted packs in memory if app does repeated queries

---

## React Native / Expo Notes

* Built-in ponyfills for `TextEncoder`/`TextDecoder`; no extra deps needed.
* To load `.knolo` assets, read as Base64 then convert to `Uint8Array` before `mountPack({ src })`.
* Hermes compatible.

---

## Testing & QA

### Smoke test

We ship a no-deps smoke test that exercises phrase enforcement, proximity, de-dupe, and heading boosts.

Run:

```bash
npm run build
npm run smoke
```

### What it validates

* Basic query returns results
* Quoted phrases enforced
* `requirePhrases` enforced (normalized)
* Tight spans outrank scattered
* No near-duplicates in top-K
* `source` type is `string | undefined`

---

## Migration 0.1.x → 0.2.0

* **No API breaks**: `buildPack`, `mountPack`, `query`, `makeContextPatch` unchanged.
* **Compatibility**: v0.2.0 mounts v1 packs (string blocks) and v2 (object blocks).
* **New**: phrase enforcement, proximity bonus, heading boosts, KNS tie-breaker, de-dupe + MMR, avgBlockLen in meta, RN/Expo ponyfills.
* Provide `id` and `heading` at build time to enable `hit.source` and field boosts.

---

## Security & Privacy

* All retrieval is **local**; no network dependency for search.
* Packs are plain JSON sections + typed arrays—auditable and diff-able.
* If packs contain sensitive data, treat `.knolo` files as confidential artifacts.

---

## FAQ

**Q: Does this use embeddings or a vector DB?**
A: No—pure lexical retrieval with positions and structural cues.

**Q: Why am I still seeing similar results?**
A: De-dup suppresses near-duplicates but allows related passages. Increase Jaccard threshold or tune λ (if forking).

**Q: How do I improve recalls for synonyms?**
A: Add domain alias tables or expand queries; we intentionally avoid opaque embeddings.

**Q: Does it work offline?**
A: Yes, end-to-end.

---

## Glossary

* **BM25L**: length-normalized lexical ranking.
* **Minimal span cover**: smallest token window containing all query terms.
* **MMR**: diversity-promoting re-ranker balancing relevance & novelty.
* **KNS**: deterministic lexical numeric signature (tie-breaker).

---

## Versioning & Releases

* **SemVer**: feature ≥ minor, bugs = patch.
* Tag releases: `vX.Y.Z`.
* Recommended commit message (example):

```
feat(core): deterministic retrieval upgrades
- phrase enforcement, proximity, heading boosts
- de-dup + MMR, KNS tie-breaker
- avgBlockLen, RN/Expo ponyfills
```
