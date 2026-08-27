# 🧠 Knolo

**Current contract: Knolo V5 foundation with V4 compatibility.** TypeScript
`@knolo/core` still builds and retrieves V4 packs by default, while the V5
Knowledge Image, verification, migration, runtime diagnostics, and read-only
Studio management contracts are available alongside the unchanged V4 APIs.
V1–V4 packs remain readable; Python and ICP remain legacy compatibility
profiles, while Rust provides the native V5 verification foundation.

See the [V5 roadmap](docs/ROADMAP.md) for delivered work, release hardening,
and the next implementation wave.

Knolo is a **local-first knowledge base engine** built around deterministic retrieval and portable `.knolo` packs.

It provides:

* `@knolo/core` — pack format + deterministic retrieval engine, LivePack overlay, and Cortex memory layer
* `@knolo/cli` — build workflows for `.knolo` artifacts, including **live ICP** canister commands
* `packages/icp-canister` — **live** Internet Computer knowledge canister (lexical search on-chain)
* `create-knolo-app` — instant Next.js starter with playground
* `@knolo/langchain` — LangChain-style retriever adapter
* `@knolo/llamaindex` — LlamaIndex-style retriever adapter

Knolo prioritizes:

* Deterministic lexical retrieval
* Optional hybrid semantic reranking
* Zero vector database requirement
* Local-first execution (offline capable)
* Portable binary knowledge packs
* Optional ICP deployment for on-chain knowledge retrieval
* Strict runtime contracts (optional advanced features)
* Verifiable receipts, evidence spans, and deterministic retrieval-plan hashes

> ⚠️ `knolo-core` (unscoped) on npm is deprecated. Use `@knolo/core`.

## V5 foundation and operational checks

The V5 foundation adds a verifiable Knowledge Image runtime beside the
unchanged V4 retrieval path. It supports deterministic encoding and roots,
fail-closed verification, V4 migration receipts, read-only runtime
diagnostics, and the KIP-0026 Studio management snapshot.

```bash
npm run release:check
npm run knolo -- v5 info ./dist/knowledge.v5
npm run knolo -- v5 health ./dist/knowledge.v5
npm run knolo -- v5 studio ./dist/knowledge.v5
```

The Studio command reports verified state and available read-only panels; it
does not grant mutation, authority, or host execution permissions. See the
[V5 roadmap](docs/ROADMAP.md) and [V5 contracts](spec/README.md).

---

# 📊 TrustBench Reference (v4 / Phase 5)

Knolo is evaluated using the checked-in deterministic lexical-first reference
profile and the shared `conformance/` fixtures.

**Contract:** `retrieval-v4.0`
**Runner:** `npm run trustbench:test`

### Aggregate Metrics

| Metric      | Score     |
| ----------- | --------- |
| Metric | Definition |
| --- | --- |
| Recall@K | Relevant fixture sources retrieved |
| MRR@K | Reciprocal rank of the first relevant source |
| nDCG@K | Discounted ranking quality |
| Abstention precision | Correct empty-scope decisions |

### Interpretation

* Results are generated from committed fixtures, not a time-stamped external benchmark.
* IDs, plan hashes, decisions, receipts, and corruption rejection are canonical.
* Scores are rounded to six decimals for cross-runtime comparison.

This contract demonstrates:

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

For pack workflows, `knolo dev` is the watch/rebuild loop for configured sources. We are keeping that workflow instead of adding a separate `build --watch` command in this phase.

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
* A local-first Knolo Cortex overlay memory layer for `.knolo` packs
* A portable knowledge artifact you can ship anywhere

You build `.knolo` packs once.
You mount them anywhere — Node, web, React Native, offline.
When you need a deterministic mutable overlay on top of a mounted pack, use `LivePack`.

Retrieval is lexical-first and deterministic by default.

Hybrid semantic reranking is optional and **never replaces lexical grounding**.

# 🧪 Live KBs MVP

`LivePack` is the phase-1 mutable overlay for mounted packs. The base pack stays immutable, live docs are keyed by stable ids, and `serialize()` returns a standard `.knolo` snapshot.

For the rollout plan, implementation notes, and test matrix, see [`LIVE_KBS_MVP.md`](./LIVE_KBS_MVP.md).

```ts
import { createLivePack, mountPack } from '@knolo/core';

const base = await mountPack({ src: './dist/knowledge.knolo' });
const live = await createLivePack(base, [
  { id: 'notes.alpha', text: 'alpha note', namespace: 'notes' },
]);

await live.updateDocument({ id: 'notes.alpha', text: 'alpha note v2' });
await live.removeDocument('notes.alpha');
await live.addDocument({ id: 'notes.alpha', text: 'alpha note restored' });

const snapshot = await live.serialize();
const rebuilt = await mountPack({ src: snapshot });
```

`LivePack` stays lexical/graph-only in v1. Cortex remains a separate append-only memory layer.

### Delta / append-only patch packs

Live mutations can be distributed as a small deterministic patch stream:

```ts
import { applyPatchPack, deserializePatchPack, mountPack } from '@knolo/core';

const base = await mountPack({ src: './knowledge.knolo' });
const patch = deserializePatchPack(patchBytes);
const live = await applyPatchPack(base, patch);
```

Patch packs contain complete stable-id upserts and tombstones, are mergeable, and bind themselves to the fingerprint of the base pack. `live.serializePatchPack()` exports the append-only mutations since the live overlay was created; `live.serialize()` still produces a normal full `.knolo` snapshot.

---

# 🧠 Knolo Cortex

Knolo Cortex adds a local-first overlay memory layer on top of `@knolo/core`.
It is separate from `LivePack`: Cortex is append-only memory, while LivePack is a mutable document overlay for mounted packs.

It gives you:

* Immutable `createCortex()`, `remember()`, `forget()`, `labelMemory()`, and `linkMemories()` writes
* Deterministic lexical recall with labels, namespaces, source filters, and confidence/importance thresholds
* Portable memory logs that can be serialized, merged, and replayed
* `consolidateMemories()` to turn selected memories back into build docs
* `memoryToClaimOps()` to export deterministic ClaimGraph ops without changing the existing graph builder

```ts
import {
  buildPack,
  consolidateMemories,
  createCortex,
  mountPack,
  recall,
  remember,
} from '@knolo/core';

const cortex = createCortex({ actor: 'notes-app' });
const { cortex: next, memory } = remember(cortex, {
  kind: 'note',
  text: 'Project alpha uses a local-first memory overlay.',
  labels: ['project.alpha'],
  namespace: 'project.alpha',
});

const hits = recall(next, 'project alpha');
const docs = consolidateMemories(next, { namespacePrefix: 'memory' });
const bytes = await buildPack(docs);
const pack = await mountPack({ src: bytes });
```

For the full API surface and memory-specific examples, see [`packages/core/README.md`](packages/core/README.md) and [`examples/memory-overlay/README.md`](examples/memory-overlay/README.md).

---

# 📦 Packages

| Package             | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `@knolo/core`       | V4 pack/retrieval APIs plus the V5 verifiable Knowledge Image foundation |
| `@knolo/cli`        | CLI for V4 artifacts and V5 inspection/Studio management  |
| `create-knolo-app`  | Next.js scaffolding with playground                       |
| `@knolo/langchain`  | LangChain-style retriever interface                       |
| `@knolo/llamaindex` | LlamaIndex-style retriever interface                      |
| `knolo-core-rust`   | Native Rust pack mount + lexical query runtime            |

---

# 🦀 Rust Runtime Support (New)

Knolo now includes an initial Rust runtime in `packages/core-rust`.

Current Rust support includes:

* Mounting `.knolo` packs from bytes
* Parsing v1/v3-compatible core sections (`meta`, `lexicon`, `postings`, `blocks`)
* Deterministic lexical querying with `top_k`, `min_score`, `namespace`, and `source` filters
* Read-only V5 Knowledge Image verification and deterministic V4 migration
* Cross-runtime V5 roots and migration fixtures under `conformance/v5/`

Run Rust tests:

```bash
cd packages/core-rust
cargo test
```

---

# 🐍 Python Runtime Support (Legacy compatibility profile)

Knolo also ships a pure-Python runtime in `packages/core-python` for mounting existing `.knolo` packs and running deterministic lexical queries locally.

It stays local-first, requires no vector database, and does not use embeddings on the default query path.

The Python package currently reads v1–v3 packs and is not yet a v4 TrustBench-equivalent runtime.

# 🧪 TrustBench / Conformance

```bash
npm run trustbench:generate
npm run trustbench:test
```

The suite checks deterministic IDs, scores, plan hashes, receipts, Recall@K,
MRR, nDCG, abstention precision, and fail-closed corruption handling.

For the V5 release gate, run:

```bash
npm run release:check
```

The complete implementation roadmap is [`docs/ROADMAP.md`](docs/ROADMAP.md).

Install locally:

```bash
cd packages/core-python
python -m pip install -e ".[dev]"
```

Use it from Python:

```python
from knolo import mount_pack, query

pack = mount_pack("tests/fixtures/simple.knolo")
hits = query(pack, "alpha beta", top_k=5)
```

For the release checklist and publishing notes, see [`packages/core-python/README.md`](packages/core-python/README.md) and [`packages/core-python/RELEASE.md`](packages/core-python/RELEASE.md).

---

# 🌐 ICP Canister Adapter — LIVE

Knolo’s Internet Computer path is **live**: deploy a knowledge canister, upload a `.knolo` pack, and run **deterministic lexical search** directly on-chain.

No middleware server. No vector database. Browser clients, CLI, `dfx`, Postman (via local REST gateway), and Candid UI all talk to the same canister.

> **Status: LIVE** for local ICP development and controller-operated deploys.
>
> - `set_pack` / `clear_pack` require a **canister controller**
> - Pack uploads are capped at **2 MiB**
> - Search is lexical-only (BM25-style via `packages/core-rust`)
> - Pack bytes + label persist across canister upgrades

## What ships

| Piece | Path / command |
| ----- | -------------- |
| Rust canister | `packages/icp-canister` |
| Repo example | `examples/icp-knowledge-canister` |
| CLI scaffold | `knolo icp init` → bundled template |
| CLI ops | `knolo icp build-pack`, `upload`, `query`, `health`, `info`, `clear` |
| Automated e2e | `npm run test:icp:e2e` / `scripts/e2e-icp-local.sh` |
| Manual seed + Postman | `npm run icp:local` / `tests/icp-local/` |

## Prerequisites

```bash
npm install
npm run build
rustup target add wasm32-unknown-unknown
# dfx 0.20.x on PATH
```

## Quick start (scaffold + CLI)

```bash
# from repo root after npm install / build
npx knolo icp init ./my-icp-canister
cd ./my-icp-canister

dfx start --background --clean
dfx deploy

knolo icp build-pack ./knowledge --out ./dist/knowledge.knolo
knolo icp upload ./dist/knowledge.knolo --canister knolo_knowledge --label my-docs
knolo icp health --canister knolo_knowledge
knolo icp info --canister knolo_knowledge
knolo icp query "alpha beta" --canister knolo_knowledge --k 5
```

> Tip: run name-based `dfx` / `knolo icp` commands from the directory that contains `dfx.json`, or pass the canister principal id instead of the name.

### Operator commands

```bash
knolo icp health --canister knolo_knowledge   # ready / not loaded
knolo icp info --canister knolo_knowledge     # docs, blocks, terms, label
knolo icp query "billing escalation" --canister knolo_knowledge --k 5
knolo icp clear --canister knolo_knowledge    # controller only
```

### Same calls via dfx

```bash
cd examples/icp-knowledge-canister   # or your scaffold dir
dfx canister call knolo_knowledge health --query --output json
dfx canister call knolo_knowledge pack_info --query --output json
dfx canister call knolo_knowledge search --query --output json \
  --argument '("password reset", 5 : nat32)'
```

## One-command local demo (dummy seed + REST for Postman)

Generates **gitignored** dummy docs/pack under `tests/icp-local/data/`, deploys the canister, seeds it, and starts a REST gateway:

```bash
npm run icp:local
# equivalent: bash tests/icp-local/run-local.sh
```

Then use either surface:

**CLI**

```bash
cd examples/icp-knowledge-canister
node ../../packages/cli/bin/knolo.mjs icp query "billing escalation" --canister knolo_knowledge --k 5
```

**Postman / curl** (gateway on `http://127.0.0.1:8787`)

```http
GET  http://127.0.0.1:8787/health
GET  http://127.0.0.1:8787/info
GET  http://127.0.0.1:8787/search?q=billing%20escalation&k=5
POST http://127.0.0.1:8787/search
Content-Type: application/json

{ "q": "password reset", "k": 5 }
```

```bash
curl -sS "http://127.0.0.1:8787/search?q=deploy%20checklist&k=3"
curl -sS -X POST "http://127.0.0.1:8787/search" \
  -H 'Content-Type: application/json' \
  -d '{"q":"onboarding","k":5}'
```

Full harness notes: [`tests/icp-local/README.md`](tests/icp-local/README.md).

## Checked-in example (no dummy generator)

```bash
cd examples/icp-knowledge-canister
dfx start --background --clean
dfx deploy
node scripts/build-sample-pack.mjs
bash scripts/upload-pack.sh
bash scripts/query.sh "alpha beta"
```

If `dfx` complains about terminal colors in a minimal shell, prefix with `TERM=xterm-256color`.

Browser client (after deploy + upload):

```bash
cd examples/icp-knowledge-canister/frontend
npm install
npm run dev
```

## Automated verification

```bash
# unit + template drift + CLI icp tests (CI job: icp-ci)
npm run test:icp

# full local replica: deploy, upload, query, upgrade persistence, stop
npm run test:icp:e2e
```

## Canister API (Candid)

| Method | Kind | Access | Purpose |
| ------ | ---- | ------ | ------- |
| `set_pack(bytes, label)` | update | controller | Mount + persist a `.knolo` pack |
| `clear_pack()` | update | controller | Clear loaded pack |
| `search(q, top_k)` | query | public | Lexical top-k hits (max 50) |
| `pack_info()` | query | public | Loaded meta (docs/blocks/terms/label) |
| `health()` | query | public | Ready / not loaded message |

Interface file: [`packages/icp-canister/knolo_icp.did`](packages/icp-canister/knolo_icp.did).

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

The active roadmap is maintained in [`docs/ROADMAP.md`](docs/ROADMAP.md).
The current release hardens the V5 foundation while preserving V4 retrieval
compatibility; the next product layer is the Studio UI/service.

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
