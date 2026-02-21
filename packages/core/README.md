

# 📦 `@knolo/core`

# @knolo/core

KnoLo Core is a **local-first knowledge base engine for small language models (LLMs)**.

It allows you to package structured documents into a compact `.knolo` file and query them deterministically — **no embeddings, no vector databases, no cloud required**.

Designed for:
- On-device LLMs
- Deterministic AI systems
- Agent routing
- Air-gapped or privacy-first environments

---

## ✨ Why KnoLo?

Traditional RAG systems require:
- Embeddings
- Vector databases
- External services
- Non-deterministic similarity scoring

KnoLo uses:
- Structured indexing
- Namespace-based routing
- Deterministic query resolution
- Compact `.knolo` bundles

This makes it:
- Fast
- Reproducible
- Lightweight
- Fully local

---

## 📦 Installation

```bash
npm install @knolo/core
````

---

## 🚀 Basic Usage

### 1️⃣ Mount a Knowledge Pack

```ts
import { mountPack } from "@knolo/core";

const pack = await mountPack("./dist/knowledge.knolo");
```

---

### 2️⃣ Query the Pack

```ts
import { query } from "@knolo/core";

const results = query(pack, {
  namespace: "mobile",
  q: "debounce vs throttle"
});

console.log(results);
```

---

### 3️⃣ Resolve an Agent

```ts
import { resolveAgent } from "@knolo/core";

const resolved = resolveAgent(pack, {
  agentId: "support-agent",
  query: "Explain debounce vs throttle",
});
```

Supports patch variables:

```ts
resolveAgent(pack, {
  agentId: "support-agent",
  patch: { tone: "formal" },
});
```

---

## 🤖 Agents

Agents are defined inside the pack metadata.

Phase 2 features include:

* Agent routing profiles
* Deterministic route validation
* Tool policies (`allow_all`, `mixed`, `unknown`)
* Registry validation at mount-time

---

## 🛠 Tool Policy Helpers

```ts
import { isToolAllowed, assertToolAllowed } from "@knolo/core";

isToolAllowed(agent, "web-search");
assertToolAllowed(agent, "database-read");
```

Default behavior:

* If no policy → allow all
* Explicit deny → deterministic error

---

## 📁 .knolo Format

A `.knolo` file contains:

* Indexed documents
* Namespaces
* Agent registry
* Metadata
* Routing profiles

Built using `@knolo/cli`.

---

## 🧠 Design Philosophy

KnoLo is built around:

* Determinism over probability
* Structure over embeddings
* Local-first AI
* Small model optimization
* Agent-native architecture

---

## 🔐 Use Cases

* On-device assistants
* Enterprise internal knowledge
* Mobile AI apps
* Secure environments
* Offline-first systems

---

## 🗺 Roadmap

* Rust core implementation
* WASM builds
* Multi-language SDKs
* Advanced agent routing
* Deterministic tool orchestration

---

## 📄 License

MIT

