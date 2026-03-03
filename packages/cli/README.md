# @knolo/cli

The official CLI for building `.knolo` knowledge packs.

It indexes structured content and produces a deterministic, local-first knowledge bundle for use with `@knolo/core`.

---

## 📦 Installation

Global:

```bash
npm install -g @knolo/cli
````

Or use via npx:

```bash
npx knolo build
```

---

## 🚀 Commands

### Build a Knowledge Pack

```bash
knolo build
```

Indexes your configured content and outputs:

```
dist/knowledge.knolo
```

---

## 📁 Expected Project Structure

Example:

```
/knowledge
  mobile.json
  backend.json
knolo.config.ts
```

---

## ⚙️ knolo.config.ts Example

```ts
export default {
  input: "./knowledge",
  output: "./dist/knowledge.knolo"
};
```

---

## 🧱 What the CLI Does

* Parses structured documents
* Normalizes metadata
* Indexes namespaces
* Extracts agent routing profiles
* Validates agent registry
* Generates compact `.knolo` bundle

All builds are deterministic.

---

## 🧠 Agent Features

Phase 2 includes:

* Routing profile extraction
* Tool policy validation
* Mount-time registry validation
* Deterministic selection logic

---

## 🔍 Why No Embeddings?

KnoLo intentionally avoids:

* Vector databases
* Similarity search
* External inference APIs

This ensures:

* Reproducibility
* Security
* Low memory usage
* Predictable results

---

## 🗺 Roadmap

* Watch mode
* Incremental indexing
* Rust-powered build engine
* WASM build output

---

## 📄 License

MIT
---

## ClaimGraph section compatibility

New `.knolo` packs may include an optional trailing **ClaimGraph** JSON section.
This section is deterministic, offline-safe, and additive; runtimes that ignore trailing sections remain backward compatible.
