# Recommended features and improvements

This is a list of recommended work for Knolo. Each item says what to do, why,
and how to tell it is done. It is a proposal. It does not change any contract,
fixture, or package version.

The baseline was taken on 2026-11-25 at commit `49c71d2` (`main`, after
`feat(cli): add persona packs (#224)`), on Node 22.22.

## Baseline health

| Check                               | Result                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm ci` + `npm run build`          | Pass                                                                                           |
| `npm test`                          | Pass. 616 tests, 615 pass, 1 skipped, 0 fail. About 6 minutes wall time, run one after another |
| `npm run docs:check`                | Pass. 288 Markdown files                                                                       |
| `npm run format:check:all`          | Pass. Only the files named in the script are checked                                           |
| `prettier --check packages/cli/bin` | **23 files fail.** The CLI is outside the formatting gate                                      |
| `npm audit`                         | **3 high.** `zod <4.6.6` through `n8n-workflow` in `n8n-nodes-knolo` (GHSA-mrhx-c7xc-m3w5)     |
| `npm run release:metadata`          | Pass                                                                                           |
| CI Node version                     | **Node 20.** Node 20 reached end of life on 2026-04-30                                         |
| Test files per package              | `@knolo/tools` has none. MCP, AI SDK, and Mastra depend on it                                  |
| Lint                                | No ESLint or other linter is configured                                                        |
| Repo hygiene files                  | No `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, Dependabot, or code scanning                |

Priority: **P0** do next, **P1** next milestone, **P2** later.
Effort: **S** under a day, **M** a few days, **L** a week or more.

## 1. Fixes and quick wins

### 1.1 Move CI off Node 20 (P0, S)

`ci.yml` runs most jobs on Node 20, which is end of life. Several packages
already need newer versions: `@knolo/ai-sdk` and `@knolo/openai-agents` need
`>=22`, `@knolo/mastra` needs `>=22.13`, and `@knolo/openclaw` needs `>=24.16`.

- Run the main `test` job as a matrix on Node 22 and 24.
- Raise `engines.node` to `>=22` in a minor release and say so in the release
  notes. `@knolo/semantic-ollama` still says `>=18`.
- Add `engines` to `@knolo/core`, `@knolo/langchain`, and `@knolo/llamaindex`,
  which do not declare one.
- Add an `.nvmrc` so contributors use the same version.

Done when CI is green on 22 and 24 and no published package claims a Node
range that CI does not test.

Status: the CI part is done. The `test` job runs on Node 22 and 24, and the
other jobs moved from 20 to 22. The `engines` changes are a release decision
and remain open.

### 1.2 Fix the high-severity `npm audit` finding (P0, S)

`n8n-nodes-knolo` pulls `zod <4.6.6` through `n8n-workflow` and
`@n8n/expression-runtime`, which pin `zod@3.25.76` exactly.

What was checked:

- No patched zod 3.x exists. The latest `@n8n/expression-runtime` (0.40.4)
  still pins `zod@3.25.76`, so updating n8n does not help yet.
- A scoped `overrides` entry that forces zod 4 into the n8n packages clears
  the audit but breaks `n8n-workflow` at load time
  (`z.string().ip is not a function`). Do not use it.
- `n8n-workflow` is only a devDependency of `n8n-nodes-knolo`. At run time the
  n8n host supplies its own copy. `npm audit --omit=dev` reports 0
  vulnerabilities.

Status: CI now runs `npm audit --omit=dev --audit-level=high`, so a
high-severity issue in a dependency that users install fails the build. The
dev-only finding stays open until n8n ships a fixed `@n8n/expression-runtime`.

### 1.3 Suggest a command when the user mistypes one (P0, S)

`knolo serach` (a typo for `search`) goes to direct mode and prints
`ENOENT: no such file or directory, open '.../serach'`. That message does not
help. When the first argument is not a file and is close to a known command
(edit distance 2 or less), print `Unknown command "serach". Did you mean
"search"?` and exit 2. Leave direct mode alone when the file exists.

Done when a CLI test covers a typo, a real file, and an unknown word.

Status: done. Bare words that are not files get the suggestion and exit 2.
Arguments that look like paths (`missing.json`, `./nope`) keep the original
file error and exit 1. Covered by `packages/cli/test/unknown-command.test.mjs`.

### 1.4 Bring the CLI under the formatting gate (P0, S)

`format:check:all` is a long hand-written list of files. `packages/cli/bin`
is not on it, and 23 CLI files fail Prettier. Format the CLI in its own
commit with no other changes. Replace the list with globs and a
`.prettierignore` for generated, fixture, and research files.

Done when `npx prettier --check .` passes, with exclusions listed in
`.prettierignore`.

### 1.5 Add tests for `@knolo/tools` (P0, M)

`@knolo/tools` (about 1.9k lines) is the shared tool layer under
`@knolo/mcp`, `@knolo/ai-sdk`, and `@knolo/mastra`, and it has no tests of its
own. Add `node --test` coverage for the search, KAR, and KITE tool handlers
against the conformance packs, including error and abstention paths.

Done when `@knolo/tools` has a `test` script that runs in `npm test`.

### 1.6 Move `tasks-500.json` out of the repo root (P1, S)

The root `tasks-500.json` (180 KB) is the BANKING77 seed set for Reflex.
Move it next to the Reflex benchmark data, or into a `datasets/` directory
with its license note (CC BY 4.0). Update the default output paths in
`scripts/convert-banking77.mjs` and `scripts/generate-reflex-test-dataset.mjs`
and the Reflex README.

## 2. CI and engineering

### 2.1 Stop duplicate CI runs (P1, S)

`ci.yml` triggers on both `push` and `pull_request`, so a pushed PR branch
runs every job twice. Limit `push` to `main` and tags, and add a
`concurrency` group with `cancel-in-progress: true`.

### 2.2 Run workspace tests in parallel (P1, M)

`npm test` runs each workspace one after another, and each one rebuilds
`@knolo/core`. Build once, then split CI into jobs per package group (core,
CLI, adapters, Python, Rust). Add `--test-concurrency` where tests do not
share temporary state. The goal is a PR check under 3 minutes.

### 2.3 Type-check the CLI (P1, M)

`@knolo/cli` is about 19k lines of untyped `.mjs`, and its `build` script
only prints a message. Add `// @ts-check`, a `tsconfig` with
`allowJs` and `checkJs`, and a `typecheck` script using `tsc --noEmit`. Turn
it on one file at a time, starting with `registry/commands.mjs` and
`knolo.mjs`.

### 2.4 Add a linter (P1, S)

Add a flat ESLint config with `typescript-eslint` and a small rule set
(`no-floating-promises`, `no-unused-vars`, `eqeqeq`, and import cycles). Run
it in CI and do not fail on existing warnings at first.

### 2.5 Update `moduleResolution` in `@knolo/core` (P2, S)

`packages/core/tsconfig.json` uses `"moduleResolution": "node"` (node10),
which ignores `package.json` `exports`. Subpaths such as `@knolo/core/kar`
and `@knolo/core/kar/authoring` depend on `exports`. Use `NodeNext` or
`Bundler` and add an `attw` (Are The Types Wrong) check to
`release:packages`.

### 2.6 Measure coverage (P2, S)

Run `node --test --experimental-test-coverage` (or `c8`) on core and the CLI
and publish the summary as a CI artifact. Report it at first. Set a minimum
only after it is stable.

### 2.7 Make the version matrix data (P1, M)

The README and `docs/README.md` explain package versions in long paragraphs
("`@knolo/cli@6.2.8` has no `ask.mjs`..."). These are hard to read and easy to
let drift. Keep one `release/versions.json` with each package's version, its
npm `latest`, its dependency ranges, and the features it has. Generate a table
from it, and have `check-release-metadata.mjs` read the same file. Changesets
is another option for the version bumps.

## 3. CLI and developer experience

### 3.1 `--json` on every command (P1, M)

Only 9 of the 26 CLI source files in `bin/` handle `--json`. Agents and CI scripts
call the CLI, so give every read command a stable JSON output with a
`schema` field, and document the exit codes (0 ok, 1 error, 2 usage,
abstention stays 0 as it does today).

### 3.2 Shell completion (P2, S)

Add `knolo completion bash|zsh|fish`. Generate it from the same `SUBCOMMANDS`
table the help text uses so it cannot drift.

### 3.3 Support `NO_COLOR` and a non-TTY mode (P2, S)

No CLI module reads `NO_COLOR`. Follow the `NO_COLOR` convention, and drop
spinners and glyphs such as `✔` when stdout is not a TTY.

### 3.4 Split `knolo.mjs` (P2, M)

`bin/knolo.mjs` is 2,044 lines, and commands are routed with a long chain of
`if (command === ...)`. Move to a command registry in which each command
module exports `{ name, summary, help, run }`. Help, completion (3.2), the
typo suggestion (1.3), and lazy loading can then come from one table.

### 3.5 `knolo doctor` (P1, S)

Add one command that reports the Node version, the resolved core and CLI
versions, Hub login state, MCP config location, whether the conformance
vectors can be found, and whether native Rust and Python are present. Print
a fix for each failed check. This helps with support and bug reports.

## 4. Security and supply chain

### 4.1 Add `SECURITY.md` (P0, S)

Knolo's value is integrity and verification. Tell reporters where to send
vulnerabilities and what response time to expect. Link the existing
[KAR security notes](kar/security.md).

### 4.2 npm provenance for every published package (P1, S)

Only `@knolo/core` and `@knolo/evidence-gate` request `provenance`. Add it to
every public package and publish from GitHub Actions with OIDC (npm trusted
publishing), as `python-publish.yml` already does for PyPI.

### 4.3 Dependabot and code scanning (P1, S)

Add `.github/dependabot.yml` for npm, Cargo, pip, and GitHub Actions, and a
CodeQL workflow for JavaScript/TypeScript, Python, and Rust.

### 4.4 Fuzz the image parsers (P1, M)

The V5 reader, VQF-1 decoders, CBOR decoder, and CEG Source parser read
untrusted bytes and are meant to fail closed. Add property and fuzz tests:
`fast-check` in TypeScript and `cargo fuzz` targets for `core-rust`. Seed
them with the conformance fixtures. Any crash, hang, or unbounded allocation
is a bug.

### 4.5 Test the `knolo-verify` action against the current CLI (P2, S)

The `knolo-verify-action` CI job pins `cli-version: 6.2.0`. Add a second run
against the CLI built from the current tree, so action changes and CLI
changes are tested together.

## 5. Product features

These stay inside the scope in [ROADMAP.md](ROADMAP.md): core owns bytes,
roots, validation, and deterministic planning. Hosts own models, networks,
and UI.

### 5.1 Evidence review tool to unblock human gold (P0, L)

Human validation of semantic production is the main open blocker
(`HUMAN_REVIEW_REQUIRED` in the [V6 gap audit](kar/V6_GAP_AUDIT.md)).
Relation-producing rules cannot be `AUTO_ACCEPT` until it is done. Build a
local review tool, `knolo kar review`, as a terminal UI or a static local web
page. It shows each `NEEDS_REVIEW` proposal with its source span. The
reviewer accepts, rejects, or edits it. Decisions are written as signed,
replayable records that `compileCegSource()` can use. Record agreement
between reviewers so the gold set can be measured.

Done when a Domain Pack can produce a human gold set with inter-annotator
agreement through this tool alone.

### 5.2 Read-only Studio viewer (P1, L)

The KIP-0026 Studio management snapshot and `knolo v5 studio` exist, but
there is no UI. Ship a static single-page viewer, for example
`knolo studio --open`, that loads an image or snapshot locally. It shows the
commit history, sections and digests, objects, the KAR frontiers for a plan,
and a dossier. Keep it read-only and offline, with no server state.

### 5.3 Streamable HTTP transport for `@knolo/mcp` (P1, M)

`@knolo/mcp` serves stdio only. Add an opt-in Streamable HTTP transport
(`knolo-mcp --http --port`) so one mounted image can serve several agents or
a remote host. Bind to localhost by default, require a bearer token for
anything else, and keep every tool read-only. The host still owns
deployment, as [V5_HOST_DEPLOYMENT.md](V5_HOST_DEPLOYMENT.md) describes.

### 5.4 Pluggable embedding providers (P2, M)

Semantic indexing comes only through `@knolo/semantic-ollama`. Define a small
`EmbeddingProvider` interface in core, with no model calls in core. Then ship
providers for any OpenAI-compatible endpoint and a local `transformers.js`
model. Record the provider id, model id, and dimension in the image so a
mounted index can be checked against the query embedder.

### 5.5 Image diff and change review (P2, M)

`knolo diff` exists for packs. Add a structural diff between two V5 commits:
objects added or removed, CEG relations changed, and KAR plans whose status
changed between the two. A reviewer could then see "this update flips plan X
from `SATISFIED` to `UNSATISFIED_EVIDENCE_REQUIREMENTS`" before pinning the
new digest. Add a `--fail-on-status-change` flag for CI.

### 5.6 Watch mode for packs (P2, S)

The CLI already watches files for `knolo dev`. Add
`knolo build --watch` for V5 images and CEG Source, recompiling and
re-verifying when a file changes, and printing the new state root.

### 5.7 Freeze the VQF-1 wire format (P1, M)

[VQF1_NEXT_PHASES.md](VQF1_NEXT_PHASES.md) says the format is still draft and
"must not be advertised as frozen". Finish the format review, freeze the
object and event envelopes as a KIP, and add the frozen vectors to
`conformance/`. Compressed images can then be shared between runtimes with a
compatibility promise.

## 6. Cross-runtime parity

| Capability                 | TypeScript | Rust | Python |
| -------------------------- | ---------- | ---- | ------ |
| V5 verify and mount        | Yes        | Yes  | Yes    |
| KAR V5 evaluate and verify | Yes        | Yes  | Yes    |
| KITE certificate replay    | Yes        | Yes  | Yes    |
| Pack and image builder     | Yes        | No   | No     |
| Cortex                     | Yes        | No   | No     |
| Composition verify         | Yes        | No   | No     |

### 6.1 Composition and Cortex trace verification in Rust and Python (P1, L)

Verification is where a second runtime is most useful: a verifier written
independently of the builder. Port **verification only** of composition
attestations and Cortex traces to `core-rust` and `core-python`, driven by
shared conformance vectors as KAR already is.

### 6.2 Python image builder (P2, L)

Python users can verify images but cannot build them. Add a
`knolo.build_image()` that is byte-identical to TypeScript on the shared
fixtures.

### 6.3 Bring Rust and the ICP canister to 6.x (P2, M)

Rust and the ICP canister stay at `5.5.1`. After 6.1 lands, release them on
the 6.x line so version numbers match capability across runtimes.

## 7. Documentation

### 7.1 Update `ROADMAP.md` (P0, S)

[ROADMAP.md](ROADMAP.md) still describes V6 as future work ("After the gate
closes, create the separate V6 implementation workstream"). The tree is
6.2. Rewrite it around the current line: delivered V6, KAR, composition, and
Cortex, then the next milestones from this list.

### 7.2 Add `CONTRIBUTING.md` (P1, S)

Cover the setup commands, how to run one package's tests, Rust and Python
prerequisites, the formatting and doc-link gates, how golden vectors are
regenerated, and the rule that frozen fixtures must not change.

### 7.3 Short README start (P1, S)

The README opens with a long version paragraph. Move it to the generated
table (2.7) and start with a 5-minute "pack, pin, mount, verify" walkthrough
that a reader can copy and paste.

## Suggested order

| Milestone          | Items                                                           |
| ------------------ | --------------------------------------------------------------- |
| Next patch release | 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 7.1                               |
| 6.3                | 2.1, 2.2, 2.3, 2.7, 3.1, 3.5, 4.2, 4.3, 4.4, 5.3, 5.7, 7.2, 7.3 |
| 6.4 and later      | 5.1, 5.2, 6.1, then 2.4–2.6, 3.2–3.4, 4.5, 5.4–5.6, 6.2, 6.3    |

5.1 is the largest item and the most important for the product. It can
start in parallel with 6.3 because it does not touch frozen contracts.

## Out of scope

These would conflict with the stated design and are not recommended: model
inference in core, a hosted Knolo service, approximate fallbacks for KAR
bounds, and any change to frozen fixtures, roots, or published versions.
