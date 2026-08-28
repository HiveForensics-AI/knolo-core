# @knolo/cli

The CLI preserves the Knolo V4 pack workflow and adds read-only V5 Knowledge
Image inspection. Normal builds emit V4; the ICP legacy build path explicitly
emits V3 until the canister gains a V4 profile. V5 Studio output is a verified
management snapshot, not a mutation interface.

The official CLI for building `.knolo` knowledge packs.

It indexes structured content and produces a deterministic, local-first knowledge bundle for use with `@knolo/core`.

---

## 📦 Installation

Global:

```bash
npm install -g @knolo/cli
```

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

Artifact workflows:

```bash
knolo inspect dist/knowledge.knolo
knolo verify dist/knowledge.knolo
knolo migrate old.knolo --to 4 --out new.knolo
knolo query "billing policy" --receipt receipt.json --json
knolo explain receipt.json --pack dist/knowledge.knolo
knolo diff old.knolo new.knolo
```

V5 runtime diagnostics:

```bash
knolo v5 info ./dist/knowledge.v5
knolo v5 health ./dist/knowledge.v5
knolo v5 studio ./dist/knowledge.v5
knolo v5 info ./dist/knowledge.v5 --index ./dist/query-index.v5 --history ./dist/query-history.v5
```

These commands verify the V5 image and optional state-root-bound runtime
artifacts before printing deterministic diagnostics. The `studio` variant
prints the KIP-0026 read-only management snapshot with artifact-panel
availability and a management root. All variants are read-only.

### ICP Canister Workflow (LIVE)

Deploy a Knolo knowledge canister on a local ICP replica, upload a `.knolo` pack, and query it with no middleware.

```bash
knolo icp init ./icp-knowledge-canister
cd ./icp-knowledge-canister
dfx start --background
dfx deploy
knolo icp build-pack ./knowledge --out ./dist/knowledge.knolo
knolo icp upload ./dist/knowledge.knolo --canister knolo_knowledge --label my-docs
knolo icp health --canister knolo_knowledge
knolo icp info --canister knolo_knowledge
knolo icp query "alpha beta" --canister knolo_knowledge --k 5
# knolo icp clear --canister knolo_knowledge  # controller only
```

From the monorepo, you can also seed dummy data and open a Postman-friendly REST gateway:

```bash
npm run icp:local
curl -sS "http://127.0.0.1:8787/search?q=billing&k=5"
```

These commands stay local-first:

* No hosted service
* No vector database
* Lexical retrieval by default
* Controller-only pack mutation; 2 MiB pack limit
* Pack state survives canister upgrades

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

Current v4 features include:

* Routing profile extraction
* Tool policy validation
* Mount-time registry validation
* Deterministic selection logic
* Pack manifests, analyzer identities, retrieval plans, receipts, and evidence spans

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

The active roadmap is maintained in [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md).
The current release focuses on V5 verification, migration, diagnostics, and
read-only Studio management while preserving the V4 CLI behavior.

---

## ClaimGraph section compatibility

New `.knolo` packs may include an optional trailing **ClaimGraph** JSON section.
This section is deterministic, offline-safe, and additive; runtimes that ignore trailing sections remain backward compatible.

---

## 📄 License

Apache-2.0
