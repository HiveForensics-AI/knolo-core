# 📦 `@knolo/core`

**Version 4 contract:** v4 packs, analyzer profiles, deterministic retrieval
plans, verifiable receipts, evidence spans, and TrustBench conformance are the
current TypeScript runtime surface.

`@knolo/core` is the **deterministic retrieval engine and pack runtime** behind Knolo.

It lets you:

- Build structured knowledge packs
- Mount portable `.knolo` artifacts
- Run deterministic lexical retrieval
- Optionally apply hybrid semantic reranking
- Enforce strict runtime contracts for advanced workflows

No vector database required.
No cloud dependency required.
Works fully offline.

## V5 Knowledge Image foundation

The V5 foundation adds a read-only, verifiable Knowledge Image contract while
leaving V4 pack and retrieval APIs unchanged. The new APIs use deterministic
CBOR, SHA-256 domain-separated roots, A/B superblocks, immutable segments, and
fail-closed verification.

```ts
import {
  migrateV4ToV5,
  mountKnowledgeImageV5,
  verifyKnowledgeImageV5,
} from '@knolo/core';

const { image, receipt } = await migrateV4ToV5(v4Bytes);
const verification = verifyKnowledgeImageV5(image);
const mounted = mountKnowledgeImageV5(image);
console.log(
  verification.stateRoot,
  receipt.objectMappings.length,
  mounted.objects.length
);
```

Single-writer transactions with detached snapshot readers are available through
`KnowledgeImageStoreV5`:

```ts
import { KnowledgeImageStoreV5 } from '@knolo/core';

const store = new KnowledgeImageStoreV5(image);
const tx = store.beginTransaction({ actor: 'writer-a' });
tx.addObject({
  kind: 'source',
  bytes: new TextEncoder().encode('alpha'),
  meta: {},
});
const next = tx.commit();
```

Concurrent writers, stale-lock recovery, and model/tool execution remain
intentionally deferred. Durable run journals, checkpointing, query indexes,
query history, synchronization, and conflict merging are bounded V5 foundation
features. The byte-level contracts live under
[`/spec`](../../spec/README.md).

Node applications can persist the same single-writer store with the Node-only
entry point. It uses an exclusive lock file and temp-file plus fsync/rename
writes; opening always verifies the complete V5 image before returning:

```ts
import { DurableKnowledgeImageStoreV5 } from '@knolo/core/node';

const store = DurableKnowledgeImageStoreV5.open('./knowledge.v5', image);
const tx = store.beginTransaction({ actor: 'disk-writer' });
tx.addObject({
  kind: 'source',
  bytes: new TextEncoder().encode('alpha'),
  meta: {},
});
const next = tx.commit();
store.close();
```

The read-only V5 EQL surface supports bounded object filtering and search with
verifiable plan and result roots:

```ts
import { queryKnowledgeImageV5 } from '@knolo/core';

const result = queryKnowledgeImageV5(
  image,
  'FROM chunk SEARCH "retention" LIMIT 20'
);
console.log(result.planRoot, result.resultRoot, result.hits);
```

Persistent query indexes and append-only query history are available as
state-root-bound V5 artifacts. Bounded joins and deterministic ordering remain
available in the V5 EQL surface.

V5 policy evaluation is available for committed policy roots. It applies
deny-precedence rules to query hits and returns an authorization root bound to
the image state root, query plan root, policy root, principal, and action.

Signed authority envelopes can bind an externally resolved principal to that
authorization root. Signature verification and key resolution are injected by
the host runtime; delegation chains are bounded and validated fail-closed.
The Node/browser-compatible WebCrypto adapter supports Ed25519 key IDs,
validity windows, revocation cutoffs, and rotation-aware keyrings.

Authority keyrings can now be serialized as canonical CBOR, replayed through
signed predecessor-linked rotation records, and persisted atomically by the
Node-only durable keyring store. The keyring root commits to active keys and
ordered rotation history.

Authority envelopes may include the keyring root; the verifier then requires
the exact matching persisted keyring state.

The authority-session facade composes query, policy, keyring selection, and
Ed25519 envelope verification into one root-bound result.

V5 sync summaries and read-only plans classify equal, fast-forward, and
diverged images and list safe transfer deltas without applying implicit merges.
Verified direct fast-forward adoption is available for memory and Node durable
stores; divergent or keyring-incompatible states remain blocked.

Transport-neutral sync requests and responses can be signed and verified with
Ed25519, binding nonces, expiry, summaries, requested deltas, and keyring roots.
The exchange helper verifies both messages before admitting the request to a
bounded replay cache; durable replay persistence and network transport remain
host responsibilities.

Signed sync messages can be serialized for transport with the bounded,
canonical-CBOR `encodeKnowledgeSyncRequestV1` and
`encodeKnowledgeSyncResponseV1` helpers and restored with their matching decode
functions. The codec remains transport-neutral and does not transfer image
objects or events itself.

Hosts can provide a `request(bytes)` adapter to
`exchangeKnowledgeSyncOverTransportWithEd25519`; the core encodes, verifies,
decodes, and replay-protects the exchange before returning it. Socket setup,
framing, peer discovery, and deployment remain host-owned. The
`exchangeKnowledgeSyncImageOverTransportV5` variant additionally verifies a
complete transferred image before replay admission, and
`DurableKnowledgeSyncReplayStoreV5` persists replay state atomically through
the Node entry point.

For host-owned deployment orchestration, `executeKnowledgeSyncHostDeploymentV5`
combines explicit peer discovery, bounded retries, resumable transfer
checkpoints, and monitoring events with the existing verified image exchange.
The Node entry point includes `InMemoryKnowledgeSyncHostAdapterV5` as a
deterministic reference adapter for local development and integration tests.
Production adapters provide their own sockets, endpoint routing, credentials,
checkpoint persistence, and monitoring sink; none are created by the core:

```ts
import {
  executeKnowledgeSyncHostDeploymentV5,
  KnowledgeSyncReplayCacheV1,
} from '@knolo/core';
import { InMemoryKnowledgeSyncHostAdapterV5 } from '@knolo/core/node';

const adapter = new InMemoryKnowledgeSyncHostAdapterV5();
const result = await executeKnowledgeSyncHostDeploymentV5({
  request,
  discovery: adapter,
  transport: adapter,
  peerId: 'peer-a',
  now: () => Date.now(),
  verification: {
    replayCache: new KnowledgeSyncReplayCacheV1(),
    resolveKey,
    verifySignature,
  },
});
console.log(result.peer.peerId, result.checkpoint.offset);
```

Durable agent run state is available through the pure lifecycle functions and
the Node-only `DurableKnowledgeRunStoreV5`. Runs are bound to an image state
root, checkpointable, resumable, and journal-verified; model and tool
execution remain host-controlled.

The host-controlled `executeKnowledgeAgentRunV1` helper connects that run state
to any model or agent framework through injected step and tool functions. It
enforces input binding, tool policy, unique call IDs, bounded steps, and
checkpoint/complete/fail transitions without owning model inference or
external side effects.

Signed run authority is available through `runAuthorityPayloadV1`,
`verifyKnowledgeRunAuthorityV5`, and the Ed25519/WebCrypto adapter. It binds
the issuer, subject, run ID, run root, image state root, validity window, and
optional keyring root; execution permissions and credentials remain host
responsibilities.

`inspectKnowledgeRuntimeV5` provides a deterministic, read-only health snapshot
for the image and optional query index, query history, durable run, and sync
replay state. Its diagnostics root is suitable for CLI, service, and Studio
health views; inspection never mutates runtime state.

`inspectKnowledgeStudioManagementV5` wraps those verified diagnostics in a
deterministic, read-only management snapshot with explicit artifact-panel
availability and a `managementRoot`. The Node-only entry point also exposes
`createKnowledgeStudioServiceV5`, a host-facing GET/HEAD service for this
snapshot. Hosts can supply explicit read authorization; POST and other write
methods are rejected, and no mutation or authority capability is exposed:

```ts
import { createKnowledgeStudioServiceV5 } from '@knolo/core/node';

const studio = createKnowledgeStudioServiceV5({
  load: () => ({ image }),
  authorizeRead: ({ method }) => method === 'GET' || method === 'HEAD',
});

const response = await studio.handle(
  new Request('https://studio.example/studio/v5')
);
```

Durable stores support opt-in bounded writer leases through the Node entry
point. Live writers are excluded, lease renewal is explicit, and stale lease
recovery must be requested by the host; legacy unleased opens remain
compatible. `executeKnowledgeAuthorizedOperationV5` provides the shared audit
gate for host-owned commit, merge, policy, authority, and sync handlers. The
Node-only `executeKnowledgeSyncHostFastForwardV5` composes that gate with
verified host deployment and applies only a direct remote-ahead image. See
[`V5_COORDINATION.md`](../../docs/V5_COORDINATION.md) for recovery and
production-boundary details.

Divergent branches can be compared with `planKnowledgeSyncMergeV5`, which
returns a deterministic, read-only conflict plan covering branch-only objects,
events, event targets, views, and commit metadata. It never chooses a winner or
mutates either image; application requires an explicit authorized resolution.

An authorized caller can apply a complete resolution with
`applyKnowledgeSyncMergeV5` or the store-level `merge()` method. The result is
an independently verified two-parent image; rejected or failed merges leave
the existing store snapshot unchanged.

Before publishing a V5 foundation build, run `npm run release:check` from the
repository root. It rebuilds `@knolo/core` and validates the public runtime and
Node exports, package artifacts, Node-free runtime bundle, CLI entry point, and
required V5 specification coverage. The active implementation roadmap is
[`../../docs/ROADMAP.md`](../../docs/ROADMAP.md).

---

# 🧠 What It Is

`@knolo/core` is **not**:

- A vector database wrapper
- A hosted RAG service
- A probabilistic similarity engine

It is:

- A versioned binary pack format
- A deterministic lexical retrieval engine
- A deterministic `LivePack` overlay for mounted packs
- An optional semantic rerank layer
- A portable knowledge runtime
- A separate append-only Cortex memory layer

You build once.
You mount anywhere — Node, browser, React Native, serverless, offline.

---

# 📊 Retrieval Characteristics

Lexical retrieval is:

- Deterministic
- Reproducible
- Stable across runs
- Independent of embeddings

Hybrid reranking is:

- Optional
- Deterministic for fixed vectors
- Lexical-first (semantic never replaces grounding)

In benchmark testing (March 2026):

- **Recall@5:** 1.000
- **MRR@5:** 0.867
- **nDCG@5:** 0.900

Strong ranking quality without requiring a vector database.

---

# 📦 Installation

```bash
npm install @knolo/core
```

---

## 0️⃣ LivePack Overlay

`LivePack` is the mutable overlay for mounted packs.

Use it when you want stable-id document edits without rebuilding the immutable base pack first:

- `addDocument()` inserts or replaces a live doc by stable id
- `updateDocument()` merges partial fields onto the last known full doc
- `removeDocument()` tombstones a doc id and hides the base copy
- `serialize()` materializes the merged live state as a normal `.knolo` snapshot

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

Live querying in v1 stays lexical/graph-only. Semantic live options are rejected until the embedding story exists.

### Append-only patch packs

Use patch packs to ship only stable-id document mutations instead of rebuilding and distributing a full snapshot. Patch packs are deterministic JSON bytes, carry a fingerprint of their base pack, and can be merged or replayed safely:

```ts
import { applyPatchPack, deserializePatchPack, mountPack } from '@knolo/core';

const base = await mountPack({ src: './dist/knowledge.knolo' });
const patch = deserializePatchPack(
  new Uint8Array(
    await fetch('./updates.knolo.patch').then((r) => r.arrayBuffer())
  )
);
const live = await applyPatchPack(base, patch);
const snapshot = await live.serialize();
```

`LivePack.serializePatchPack()` exports the mutations made since the overlay was created. Each upsert is a complete document replacement and each remove is a tombstone; replay rejects a patch whose base fingerprint does not match.

For the rollout notes and constraints, see [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md).

---

# 🚀 Core Concepts

## 1️⃣ Build a Pack

```ts
import { buildPack } from '@knolo/core';

const bytes = await buildPack(docs, {
  semantic: {
    enabled: false,
  },
});
```

`buildPack` produces a versioned `.knolo` binary artifact.

It emits a v4 container by default. Use `{ format: 3 }` only when targeting a
legacy runtime. v1–v3 packs remain readable.

You can write it to disk or store it in object storage.

---

## 2️⃣ Mount a Pack

### Node.js (local path convenience)

```ts
import { mountPack } from '@knolo/core/node';

const pack = await mountPack({
  src: './dist/knowledge.knolo',
});
```

### React Native / Expo (URL or bytes)

```ts
import { mountPack } from '@knolo/core';

const ab = await (await fetch(PACK_URL)).arrayBuffer();
const pack = await mountPack({ src: new Uint8Array(ab) });
```

You can mount from:

- URL string (runtime-safe entry)
- Buffer / Uint8Array
- Local file path in Node via `@knolo/core/node`
- Object storage download

Mount-time validation ensures:

- Pack version compatibility
- Metadata integrity
- Optional agent registry validation

---

## 3️⃣ Query (Deterministic Lexical Retrieval)

```ts
import { query } from '@knolo/core';

const hits = query(pack, 'debounce vs throttle', {
  topK: 5,
});

for (const hit of hits) {
  console.log(hit.text);
  console.log(hit.metadata); // { score, source, namespace, id }
}
```

Properties:

- Fully deterministic
- No embedding dependency
- Namespace-aware
- Evaluation-friendly scoring

For iterative pack builds, use `knolo dev` as the watch/rebuild workflow. We are keeping that flow instead of introducing `build --watch` in this phase.

---

## 4️⃣ LivePack Overlay Details

`LivePack` is a deterministic mutable overlay on top of a mounted base pack.

It is phase-1 lexical/graph-only. Stable doc ids are required for the initial `docs` array and for every live mutation, and semantic live updates are rejected until the embedding story exists.

Construction accepts `LivePackOptions` for graph settings such as `maxEdgesPerDoc`, but semantic live options stay disabled in v1.

It is designed for document-style live updates:

- `addDocument()` inserts or replaces a live doc by stable id
- `updateDocument()` merges partial fields onto the last known full doc and shadows any base copy
- `removeDocument()` tombstones a doc id and hides the base copy
- `query()` returns the same `Hit[]` shape as `query(pack, ...)`
- `serialize()` materializes the merged live state as a normal `.knolo` snapshot
- repeated `serialize()` calls on the same state are byte-identical

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

For the phase-1 rollout notes and test matrix, see [`../../docs/V5_PRE_V6_DEVELOPMENT_PLAN.md`](../../docs/V5_PRE_V6_DEVELOPMENT_PLAN.md).

---

# 🔀 Optional: Hybrid Semantic Rerank

Semantic rerank runs **after lexical retrieval**.

It never replaces lexical grounding.

## Build with embeddings

```ts
const bytes = await buildPack(docs, {
  semantic: {
    enabled: true,
    modelId: 'text-embedding-3-small',
    embeddings,
    quantization: {
      type: 'int8_l2norm',
      perVectorScale: true,
    },
  },
});
```

## Query with rerank

```ts
import { hasSemantic } from '@knolo/core';

const hits = query(pack, 'react native throttling issue', {
  topK: 8,
  semantic: {
    enabled: hasSemantic(pack),
    mode: 'rerank',
    topN: 50,
    minLexConfidence: 0.35,
    blend: { enabled: true, wLex: 0.75, wSem: 0.25 },
    queryEmbedding,
  },
});
```

Design principles:

- Lexical-first
- Deterministic scoring
- No external vector store
- Quantized embedding storage inside pack

---

# 🤖 Optional: Agent Metadata & Routing

Knolo is a knowledge engine first.

However, packs may optionally embed structured metadata for:

- System prompts
- Namespace restrictions
- Tool policies
- Routing hints

Agent registries are validated once at `mountPack()`.

These features are additive and do not affect retrieval.

---

# 🛠 Runtime Contracts (Advanced)

For strict deterministic workflows:

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

```ts
import {
  isRouteDecisionV1,
  validateRouteDecisionV1,
  isToolAllowed,
  assertToolCallAllowed,
} from '@knolo/core';
```

Enables:

- Deterministic routing validation
- Policy enforcement
- Tool permission checks
- Structured AI pipelines

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

- Versioned
- Compact
- Immutable
- Semantic section auto-detected
- Designed for fast mount + query

---

# ⚙️ Design Guarantees

- Deterministic lexical retrieval
- Deterministic hybrid rerank (fixed vectors)
- No vector database required
- No cloud dependency required
- Works offline
- Works in React Native / Expo
- Portable binary artifacts

---

# 🔐 Ideal For

- Local-first AI systems
- Offline assistants
- On-device LLM retrieval
- Secure / air-gapped environments
- Deterministic RAG pipelines
- Evaluation-heavy workflows

---

# 🧠 Knolo Cortex

Knolo Cortex is a local-first overlay memory layer for `.knolo` packs.

It gives you:

- Deterministic append-only memory writes
- Lexical-first recall with label and namespace filters
- Portable memory logs you can serialize and replay
- Consolidation back into pack docs without mutating the pack itself
- Deterministic graph export via `memoryToClaimOps()`

## Example

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
} from '@knolo/core';
```

- `createCortex({ actor?, now?, log? })` creates an immutable memory runtime
- `remember()` appends a new memory entry
- `forget()` tombstones a memory
- `labelMemory()` adds labels without mutating the original cortex
- `linkMemories()` records deterministic memory relationships
- `recall()` ranks memories with lexical-first scoring
- `consolidateMemories()` converts selected memories back into `BuildInputDoc[]`
- `memoryToClaimOps()` emits deterministic ClaimGraph ops for memory nodes, labels, and links

The full example lives in [`examples/memory-overlay/README.md`](../../examples/memory-overlay/README.md).

---

# 🗺 Roadmap

- Incremental pack updates
- Evaluation tooling
- Performance introspection APIs
- WASM builds
- Continued local-first optimization

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

- `ClaimNode`
- `ClaimEdge`
- `ClaimGraph`
- `ClaimOp`
- `ClaimGraphLog`

## Notes on determinism and bounds

- Node IDs are hash-derived from normalized labels.
- Edge IDs are hash-derived from `(from, predicate, to, evidence)`.
- Node labels are normalized and deterministically truncated.
- Evidence arrays are sorted + unique.
- Node/edge arrays are sorted by ID in final graph.
- Extraction is bounded with `maxEdgesPerDoc`.
- Query expansion is bounded with `maxExtraTerms` and stable ordering.

## Pack format note

`.knolo` binary layout now supports an optional trailing ClaimGraph JSON section after existing sections.
Runtimes that ignore unknown trailing bytes remain compatible.

---

# 📄 License

Apache-2.0
