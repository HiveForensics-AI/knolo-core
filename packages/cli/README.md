# @knolo/cli

The CLI preserves the Knolo V4 pack workflow and adds explicit V5 Knowledge
Image inspection and querying. Normal builds emit V4; the ICP legacy build path explicitly
emits V3 until the canister gains a V4 profile. V5 Studio output is a verified
management snapshot, not a mutation interface.

The CLI also exposes opt-in VQF-1 physical transcodes for V5 images. `v5
compress` supports the `fast`, `balanced`, and `max` profiles, while `v5
decompress` restores ordinary required segments. VQF preserves logical roots;
the format is still draft and compressed object/event images require a VQF-aware
reader.

`knolo compose`, `knolo attest`, and `knolo verify-attestation` cite local
Knowledge Images and write an attestation sidecar. This tree's `@knolo/cli`
package file is `6.2.3` and depends on `@knolo/core` `^6.2.0`. npm
`latest` is `6.2.3`. They do not fetch Hub. Verification
recomputes `compositionRoot` and checks bundled excerpt bytes. A keyring key
must fall inside `notBefore`, `notAfter`, and `revokedAt`. `used` means a
query or evaluation ran. It does not mean `SATISFIED`, and it does not mean a
claim is true or false. Hub `attested: true` is a listing flag.

`knolo cortex find`, `knolo cortex ask`, `knolo cortex explain`, and
`knolo cortex verify` run bounded evidence retrieval. The CLI does not call a
model and does not take an API key. A verified trace matches the image. It
does not mean the answer is true.

`knolo flight ingest` packs a `flight-events-1` document into a V5 Knowledge
Image and binds it to the SHA-256 of one log file. It does not decode the log.
`log.format` is `ulog`, `dataflash`, or `rosbag2`. Optional producers live in
`scripts/flight/` and are not part of `npm test`. `SATISFIED` on a later KAR
check means the evidence requirements were met. It does not mean a flight was
safe, legal, or compliant. See `docs/flight/README.md`.

`knolo skill` creates a skill pack for the host agent. The CLI does not call
a model. A receipt is an integrity check. It does not mean a claim is proven.
`SATISFIED` means the evidence requirements were met. See
[Skills](../../docs/skills/README.md).

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

## Skill packs

`knolo skill` is separate from the Hub commands above. `knolo publish` still
uploads a `.knolo` knowledge pack to `https://hub.knolo.dev`. `knolo skill
publish` sends a skill pack to that same hub. `--hub <dir>` remains a local
directory for an offline catalog.

```bash
knolo skill init refund-policy
knolo skill check refund-policy
knolo skill pack refund-policy --out dist/refund-policy.knolo-skill
knolo skill publish dist/refund-policy.knolo-skill
knolo skill install acme/refund-policy
knolo skill publish dist/refund-policy.knolo-skill --hub ./catalog
knolo skill install refund-policy --hub ./catalog --dir ./skills
knolo skill search refund
knolo skill list
knolo skill info acme/refund-policy
knolo setup --root <dir> --agent <id> --auto-rebuild
```

`init` writes `SKILL.md` and an empty `knowledge/` directory. `check` reads
that directory. When `knowledge/` has files, `check` builds a V5 image, runs
one search, and prints a receipt id. The receipt is an integrity check. It
does not mean a claim is proven.

`pack` writes `manifest.json`, `SKILL.md`, `policy.json`, and, when
`knowledge/` has files, `knowledge.v5`. The manifest stores SHA-256 pins and
the image state root. It does not store a home directory or a computer
layout. The same files produce the same pins.

`publish` without `--hub` uses the stored `kno_…` token. The same pin can be
published again. A different pin is refused, and the catalog copy stays as
it was. `--hub <dir>` copies the pack into `<dir>/<name>` instead.
`install <publisher>/<name>` downloads one pack from the hub. It does not
read a stored token, and the download does not send one. `install` with
`--hub` or `--pack` reads a local directory. Either install checks the pin
before it writes. A mismatch writes nothing. The catalog id must match the
manifest. `SKILL.md` must match that name and description, and `policy.json`
must match the image policy root. The files land in `--dir/<name>`, or in
`~/.knolo/skills/<name>` when `--dir` is omitted. When that folder is a
skills root in `~/.knolo/box/box.config.json` and `knolo-box` is on `PATH`,
install runs one `knolo-box build`. A root written as `~/...` or
`$GROK_HOME/...` counts, and a skills scope left out of the file uses the
default `~/.grok` skill folders. A folder outside those roots is still
written, and install prints that it was not indexed. A failed build leaves
the installed files in place and prints that the install was not indexed.
`search`, `list`, and `info` read the public skill catalog. `list` prints
every `publisher/name`. `check` reads a source directory that contains
`knowledge/`. An installed pack contains `knowledge.v5` instead.

`knolo setup` runs `knolo-box init --tolerant` and then `knolo-box build`
when `knolo-box` is on `PATH`. It scans `~/.grok` when that directory
exists, plus every `--root`. It does not require `~/.grok`. It always
includes `~/.knolo/skills`. An existing `~/.knolo/box/box.config.json` is
kept and rebuilt. `--reset` replaces it. `--agent`, `--auto-rebuild`,
`--root`, and the scope paths merge into that file. `--root` may be the
parent of `agent-data`, or the `agent-data` directory itself. `--agent` sets
the caller name. `--auto-rebuild` turns on a rebuild at the next search.
Setup does not prompt,
install a pack, or call the hub. A missing `knolo-box` is one line, and
setup still exits 0. It prints the config path, `knolo skill install <publisher>/<name>`,
and `knolo-box mcp --config <path>`. The install path, auth, trust, and
version rules are in [Community install](../../docs/hub/COMMUNITY.md). This
page does not restate that contract. The hub stores packs. It does not run
a model, and it does not answer questions. `--hub` and `--registry` cannot
be combined.

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

`knolo build` produces a V4 pack, so its natural-language query and receipt
contract applies to that artifact. V5 images are verified Knowledge Images and
use bounded EQL with roots-bound query results:

```bash
knolo query 'FROM chunk SEARCH "billing" LIMIT 5' \
  --pack ./dist/knowledge.v5 --json --receipt ./query-result.json
knolo v5 query ./dist/knowledge.v5 \
  'FROM chunk SEARCH "billing" LIMIT 5' --json
knolo explain ./query-result.json --pack ./dist/knowledge.v5
```

V5 images are never mounted through the V4 pack query API. Semantic sidecars
currently target V4 packs and are rejected for V5 images with a contract-specific
message.

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
The published npm release is `6.2.3`. It preserves the V4 CLI, keeps V5 verification,
migration, diagnostics, and read-only Studio management, and adds offline
composition, attestation, and `knolo cortex`. Cortex verification does not
mean an answer is true.

---

## ClaimGraph section compatibility

New `.knolo` packs may include an optional trailing **ClaimGraph** JSON section.
This section is deterministic, offline-safe, and additive; runtimes that ignore trailing sections remain backward compatible.

---

## 📄 License

Apache-2.0
