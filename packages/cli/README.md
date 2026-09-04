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

## Hub Registry Discovery (V5.2)

The CLI can search the public Knolo Hub and inspect a published pack without
changing the local pack workflow:

```bash
knolo search "refund policy"
knolo info acme/refund-policy
```

The production registry is `https://hub.knolo.dev`. Use `--registry` for a
one-off override, or set `KNOLO_HUB_URL` for the current environment:

```bash
knolo search docs --registry https://hub.knolo.dev
KNOLO_HUB_URL=http://localhost:3000 knolo search docs
```

An explicit `--registry` value takes precedence over `KNOLO_HUB_URL`. In
development mode (`NODE_ENV=development`), the default is
`http://localhost:3000`; otherwise the default is `https://hub.knolo.dev`.

Hub writes use a dashboard token as an HTTP Bearer credential. GitHub sign-in
is needed only to mint that token at
`https://hub.knolo.dev/dashboard/tokens`; `knolo login` is local-only and does
not call a Hub login or token-minting endpoint:

```bash
knolo login --token kno_…
# write requests use: Authorization: Bearer kno_…
```

`knolo publish` asks Hub for a Blob PUT grant with the dashboard token, PUTs
bytes to that grant URL, then completes with the public pack URL from the PUT
response. A `kno_…` token is the only credential. Do not set
`PACKS_READ_WRITE_TOKEN` — that is Hub’s store secret, not a publisher token.

```bash
knolo login --token kno_…
knolo publish ./dist/knowledge.knolo \
  --slug refund-policy --version 1.2.0 --license Apache-2.0
knolo yank acme/refund-policy@1.2.0
```

The grant pathname is `sha256/<64-lowercase-hex>.knolo`. Only public Blob URLs
(`*.public.blob.vercel-storage.com`) are sent to `/api/upload/complete`. The
CLI never sends the `kno_…` token to Blob, in a query string, cookie, or pack
bytes. A 401 usually means the `Bearer` word is missing or the token was
revoked; it does not mean the Hub write API requires a GitHub browser session.

The older `@knolo/cli@5.2.0` publish/yank command was an unimplemented stub;
current versions use the live Hub HTTP sequence. For a direct smoke test of a
stored credential, request the account endpoint with the same header:

```bash
curl -sS \
  -H "Authorization: Bearer kno_…" \
  -H "Accept: application/json" \
  https://hub.knolo.dev/api/v1/account
```

Do not use `POST /api/v1/tokens` as a CLI login endpoint; it is for the
dashboard/GitHub session that mints tokens.

Hub pack installation remains available without credentials and only happens
after its manifest, Blob bytes, digest, size, and local Knowledge Image
structure have all been verified:

```bash
knolo add acme/refund-policy@1.2.0
```

Successful installs are cached by SHA-256 and recorded in
`knolo.lock.json`. A yanked version or an existing conflicting pin requires
`--force`; digest and artifact validation cannot be bypassed.

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

- No hosted service
- No vector database
- Lexical retrieval by default
- Controller-only pack mutation; 2 MiB pack limit
- Pack state survives canister upgrades

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
  input: './knowledge',
  output: './dist/knowledge.knolo',
};
```

---

## 🧱 What the CLI Does

- Parses structured documents
- Normalizes metadata
- Indexes namespaces
- Extracts agent routing profiles
- Validates agent registry
- Generates compact `.knolo` bundle

All builds are deterministic.

---

## 🧠 Agent Features

Current v4 features include:

- Routing profile extraction
- Tool policy validation
- Mount-time registry validation
- Deterministic selection logic
- Pack manifests, analyzer identities, retrieval plans, receipts, and evidence spans

---

## 🔍 Why No Embeddings?

KnoLo intentionally avoids:

- Vector databases
- Similarity search
- External inference APIs

This ensures:

- Reproducibility
- Security
- Low memory usage
- Predictable results

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
