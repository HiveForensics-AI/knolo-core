
# 🧠 KnoLo Core

KnoLo Core is a **local-first knowledge base system** for small language models (LLMs).
It lets you package your own documents into a compact `.knolo` file and query them deterministically — **no embeddings, no vector DBs, no cloud**. Perfect for **on-device LLMs**.

---

## ✨ Features

* 📦 **Single-file packs** (`.knolo`) you can ship or load offline.
* 🔎 **Deterministic lexical retrieval** (BM25L + phrase + heading boosts).
* ⚡ **Tiny & fast** — runs in Node, browsers, and Expo.
* 📑 **Context Patches**: structured snippets for direct LLM input.
* 🔒 **Privacy-first**: all data stays local.

---

## 📦 Install

```bash
# local build
npm install
npm run build

# or if published later
npm install @knolo/core
```

---

## 🚀 Usage Examples

### 1. Node.js (in-memory build + query)

```js
import { buildPack, mountPack, query, makeContextPatch } from "./dist/index.js";

const docs = [
  { heading: "React Native Bridge", text: "The bridge sends messages between JS and native. You can throttle events to reduce jank." },
  { heading: "Throttling", text: "Throttling reduces frequency of events to avoid flooding the bridge." },
  { heading: "Debounce vs Throttle", text: "Debounce waits for silence, throttle guarantees a max rate." }
];

// Build a pack in memory
const bytes = await buildPack(docs);

// Mount it
const kb = await mountPack({ src: bytes });

// Query
const hits = query(kb, "react native bridge throttling", { topK: 5 });
console.log("Top hits:", hits);

// Turn into an LLM-friendly context patch
const patch = makeContextPatch(hits, { budget: "small" });
console.log("Context Patch:", patch);
```

---

### 2. CLI (build `.knolo` file)

**Prepare `docs.json`:**

```json
[
  { "heading": "Guide", "text": "Install deps.\n\n## Throttle\nLimit frequency of events." },
  { "heading": "FAQ", "text": "What is throttling? It reduces event frequency." }
]
```

**Build the pack:**

```bash
# writes mypack.knolo
node bin/knolo.mjs docs.json mypack.knolo
```

**Query it in a script:**

```js
import { mountPack, query } from "./dist/index.js";

const kb = await mountPack({ src: "./mypack.knolo" });
const hits = query(kb, "throttle events", { topK: 3 });
console.log(hits);
```

---

### 3. React / Expo (load from asset)

```ts
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import { mountPack, query, makeContextPatch } from "@knolo/core";

async function loadKnowledge() {
  const asset = Asset.fromModule(require("./assets/mypack.knolo"));
  await asset.downloadAsync();

  const base64 = await FileSystem.readAsStringAsync(asset.localUri!, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  const kb = await mountPack({ src: bytes.buffer });
  const hits = query(kb, "bridge throttling", { topK: 5 });
  return makeContextPatch(hits, { budget: "mini" });
}
```

---

## 📑 API Quick Reference

```ts
// Build a pack from docs
buildPack([{ heading: string, text: string }[]]) -> Promise<Uint8Array>

// Load a pack
mountPack({ src: string | Uint8Array | ArrayBuffer }) -> Promise<Pack>

// Query
query(pack, "your query", { topK?: number, requirePhrases?: string[] }) -> Hit[]

// Create LLM-friendly patch
makeContextPatch(hits, { budget?: "mini"|"small"|"full" }) -> ContextPatch
```

---

## 🔮 Roadmap

* Multi-resolution packs (summaries + facts).
* Overlay store for user notes.
* WASM core for very large packs.

---

👉 With KnoLo, you can **carry knowledge with your model** — no servers, no dependencies, just a tiny portable pack.

