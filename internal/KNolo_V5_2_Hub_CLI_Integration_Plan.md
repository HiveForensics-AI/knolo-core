# Knolo V5.2 Hub CLI integration plan

**Status:** Local implementation complete; CLI-only release selected

**Target:** `@knolo/cli` 5.2.0, as an additive V5.2 interoperability and trust
workstream

**Primary contract:** the supplied Knolo Hub CLI contract, backed by the live
Hub HTTP surface. This work belongs in `knolo-core`; it must not implement Hub
routes or browser upload behavior in `knolo-hub`.

**Progress:** PR 1 (registry foundation), PR 2 (discovery commands), PR 3
(verified Hub installation), PR 4 (local credentials and capability boundary),
and PR 5 (docs, smoke harness, and release checks) are implemented. The
selected release is `@knolo/cli@5.2.0` only; existing `5.1.0` packages remain
untouched.

## Recommendation

Ship the Hub read path as a CLI-only V5.2 release:

- `knolo search`
- `knolo info`
- `knolo add`
- `knolo login`
- `knolo whoami`
- `knolo logout`

Keep local pack/image commands unchanged. `search` is discovery, the Hub
manifest is the version contract, and the Vercel Blob URL is the byte source.
The CLI must hash, validate, cache, and lock the bytes locally before reporting
success.

Do not make `publish` or `yank` appear functional in V5.2. Hub does not yet
accept CLI Bearer tokens or expose the complete draft/verify/release contract.
If a visible `publish` stub is useful for discoverability, it should exit with
the exact message `Hub write APIs do not accept CLI tokens yet`; it must not
upload, release, or imply that a token was verified.

The production registry origin should be `https://hub.knolo.dev`. Resolve the
origin in this order:

1. command flag `--registry <url>`;
2. `KNOLO_HUB_URL`;
3. `http://localhost:3000` when running in an explicit development mode;
4. `https://hub.knolo.dev` otherwise.

Never use `cdn.packs.knolo.dev`, and never proxy Blob bytes through a Hub API
route.

## Why this fits V5.2

The existing internal development plan defines V5.2 as interoperability and
trust hardening. Hub installation is a concrete external interoperability
surface: it exercises stable pack/image identity, local verification, digest
pinning, and reproducible transfer without changing the V5 image contract.

The current repository already has the needed foundations:

- `packages/cli/bin/knolo.mjs` owns the published CLI entry point;
- `packages/cli/test/cli.test.mjs` contains the CLI shell-level test harness;
- `@knolo/core` exports V4 detection/mounting and V5 detection/verification;
- the CLI package is Node 20+, so native `fetch`, Web Streams, and
  `node:crypto` are available;
- the release preflight currently expects the npm packages to share one
  release version.

## V5.2 scope

### In scope

- registry origin resolution and `--registry` support;
- strict registry spec parsing for `publisher/slug[@version]`;
- Hub HTTP error decoding and stable human-readable CLI errors;
- compact search output and stable `--json` output;
- pack listing/info output;
- manifest-first `add` flow;
- HTTPS Blob download with no Hub token forwarding;
- content-length/size validation and local SHA-256 validation;
- V4/V5 Knowledge Image validation through `@knolo/core`;
- content-addressed local cache;
- project lockfile with immutable digest pins;
- secure local token storage and offline identity commands;
- unit, CLI, and optional local-Hub integration coverage;
- CLI README, root documentation, help output, and release notes.

### Explicitly out of scope

- hosted query against Hub;
- Hub HTML proxying or CLI-side CDN caching;
- organizations, private packs, signed Blob URLs, or Elasticsearch syntax;
- any change to the V4/V5 pack or image format;
- any Hub implementation change in this repository;
- `publish` upload/release behavior before Hub supports CLI-safe Bearer APIs;
- `yank` before the Hub yank endpoint ships;
- pull-count increments in the CLI;
- executing agent metadata from a downloaded artifact.

## User-facing command contract

### Registry configuration

All Hub commands accept `--registry <url>`. It is an origin, not a path to a
Blob object. Normalize a trailing slash once and build API paths with `URL` so
publisher and slug segments cannot escape their path component.

Reads do not need authentication. Stored credentials must not be attached to
Blob requests. When write authentication eventually lands, only Hub write
requests may receive `Authorization: Bearer kno_…`.

### `knolo search <query>`

Request:

```text
GET /api/v1/packs?q=<query>&format=V4|V5&license=<id>&official=true&agents=true
```

Only send parameters the user selected. Do not invent pagination. The initial
CLI flags are:

```text
--format V4|V5
--license <id>
--official
--agents
--json
--registry <url>
```

Human output is a compact table with stable columns:

```text
NAME                     VERSION  FORMAT  LICENSE     PULLS  DESCRIPTION
acme/refund-policy       1.2.0    V5      Apache-2.0  18420  Customer support policy…
```

`--json` emits the Hub response object `{ "packs": [...] }` without silently
renaming fields. This keeps the machine output close to the API contract and
lets later fields be added without another projection schema.

### `knolo info <publisher>/<slug>`

Request:

```text
GET /api/v1/packs/:publisher/:slug
```

Human output should show the pack identity, description, format/version,
license, size, docs/blocks/namespaces, pulls/stars, topics, and latest
manifest identity. `--json` emits the Hub response object unchanged.

### `knolo add <publisher>/<slug>[@<version>]`

The parser must accept:

```text
acme/refund-policy
acme/refund-policy@1.2.0
acme/refund-policy@latest
```

An omitted version means `latest`. Use this grammar:

```text
^(?<publisher>[a-z0-9-]+)\/(?<slug>[a-z0-9-]+)(?:@(?<version>[^@]+))?$
```

The existing local command remains valid:

```text
knolo add <source-name> <local-file-or-directory>
```

Routing rule:

- two positional arguments with the second resolving to a local path retain
  the existing local source behavior;
- one valid registry spec uses Hub;
- an ambiguous local-looking path must fail with local `add` usage rather than
  unexpectedly making a network request;
- do not overload `knolo inspect` or `knolo query` with network behavior.

The Hub path is normative:

1. Parse the spec and resolve `latest` through the manifest endpoint.
2. Fetch `GET /api/v1/packs/:publisher/:slug/:version`.
3. Treat 404 as `pack version not found`.
4. Treat 410 as `version yanked` and refuse unless `--force`.
5. Refuse an empty manifest `url` with `artifact bytes are not stored yet`.
6. Fetch `manifest.url` exactly as supplied; require HTTPS and follow
   redirects.
7. Do not send Hub credentials to the Blob host.
8. When `sizeBytes > 0`, compare both advertised and actual body size.
9. Compute lowercase SHA-256 and require an exact match with `manifest.sha256`.
10. Validate the bytes as V5 with `verifyKnowledgeImageV5`, or as V4 with
    `mountPack`/V4 verification. Reject any other bytes as `not a Knowledge
    Image`.
11. Atomically write
    `~/.knolo/cache/sha256/<sha256>.knolo` with mode `0644`.
12. Atomically upsert the project lockfile.
13. Copy to `--out <path>` if requested.
14. Print the resolved version and digest only after every prior step passes.

`--force` has two deliberate meanings: permit a yanked manifest download with
a warning, and permit replacing a different existing lockfile digest for the
same pack name. It must not bypass digest, size, HTTPS, or Knowledge Image
validation.

Human success output:

```text
added acme/refund-policy@1.2.0
sha256 21a9d04ea66f8a7da0b6427c6936e714d9e6b1f7d5c2a0b319f6e3d7a5b87a12
url    https://….blob.vercel-storage.com/sha256/21a9….knolo
```

`--json` emits the manifest fields plus the local `path`.

### Lockfile

Use one project-level `knolo.lock.json` with a `packs` map:

```json
{
  "registry": "https://hub.knolo.dev",
  "packs": {
    "acme/refund-policy": {
      "version": "1.2.0",
      "sha256": "21a9…",
      "stateRoot": "0x4d19…",
      "license": "Apache-2.0"
    }
  }
}
```

`stateRoot` is optional for V4 manifests. The lockfile must retain the exact
lowercase SHA-256. Adding a different digest for an existing name fails unless
`--force` is present. Recommend refusing to silently mix registries in one
lockfile; changing the lockfile registry requires `--force` and should be
visible in the output.

### Credentials

`knolo login` is a local setup command, not a Hub login exchange:

1. tell the user to create a token at `<registry>/dashboard/tokens`;
2. accept `--token kno_…`, an interactive prompt, or stdin;
3. store the raw token at `~/.config/knolo/credentials.json` with mode `0600`;
4. store only the selected registry and display prefix alongside it;
5. do not call Hub to verify the token yet.

Use `XDG_CONFIG_HOME` as a standard override for tests and Linux operators,
while preserving `~/.config/knolo/credentials.json` as the default path.

`knolo whoami` prints the stored token prefix and registry without contacting
Hub. `knolo logout` removes the local credentials file and reports the local
action. Never print the raw secret.

## Implementation design

The current CLI is a single 1,200-line executable. Keep the published entry
point, but extract registry-specific code into modules under `packages/cli/bin`
so the package tarball still contains the runtime code. A suggested layout is:

```text
packages/cli/bin/
  knolo.mjs
  registry/
    config.mjs       # origin and path resolution
    errors.mjs       # Hub error/status mapping
    http.mjs         # fetch, JSON decoding, timeout, redirects
    specs.mjs        # publisher/slug/version parsing
    manifest.mjs     # manifest schema and identity validation
    cache.mjs        # content-addressed cache and atomic file writes
    lockfile.mjs     # knolo.lock.json read/upsert/write
    credentials.mjs  # login/whoami/logout paths and permissions
    commands.mjs     # search/info/add command orchestration
```

This is a packaging-aware refactor: update `packages/cli/package.json` files
only if necessary, and extend the existing tarball test to assert the new
runtime modules are present while test files remain excluded.

The registry HTTP layer should use native Node 20 APIs and expose injectable
fetch/filesystem seams for deterministic tests. It should validate JSON error
bodies of the form `{ error, code }`, preserve status/code for command logic,
and distinguish HTTP failures from network/TLS failures.

For `add`, stream the Blob response to a staging file while counting bytes and
hashing. Read the staging bytes for core validation only after the size and
digest checks pass. Replace the final cache path with an atomic rename. A
failure at any point must leave both the cache target and lockfile unchanged.

Core validation should use the already exported functions:

- V5: `isKnowledgeImageV5` followed by `verifyKnowledgeImageV5`;
- V4: `isPackV4` followed by `mountPack({ src: bytes })` and the existing local
  validation path;
- otherwise reject the artifact.

Do not inspect or execute agent metadata during installation.

## HTTP and error behavior

Implement the contract’s status/code mapping:

| HTTP | Code | CLI behavior |
| --- | --- | --- |
| 400 | `invalid_body`, `invalid_pathname`, `digest_mismatch` | reject with the Hub message and exit 1 |
| 401 | `unauthenticated` | explain that Hub sign-in/token support is not available for this operation |
| 404 | `not_found` | use command-specific not-found wording |
| 410 | `yanked` | refuse by default; allow only `add --force` with warning |
| 413 | `too_large` | report that the artifact exceeds Hub’s 250 MB limit |
| 503 | `unconfigured` | report that the registry is not configured |

For a non-JSON response, report the HTTP status and a short safe body excerpt.
For network/TLS failures, name the registry or Blob host and suggest
`--registry` only when the failing host is the registry. Never retry an empty
manifest URL against Hub as if Hub were a CDN.

## PR and milestone sequence

### PR 1 — registry foundation

- extract the registry modules;
- add origin resolution and `--registry` parsing;
- add strict spec parsing and URL-safe path construction;
- add typed Hub errors and JSON decoding;
- add command/help registration without changing local command behavior.

Exit gate: parser and HTTP unit tests pass; existing CLI tests pass unchanged.

### PR 2 — discovery commands

- implement `search` and compact table rendering;
- implement `info` human and JSON output;
- preserve Hub response fields in JSON mode;
- document production/local registry configuration.

Exit gate: fixture response tests cover query parameter mapping and rendered
pack names.

### PR 3 — verified installation

- implement manifest-first `add` routing;
- add Blob streaming, HTTPS enforcement, size checks, digest checks, and
  V4/V5 core validation;
- add content-addressed cache and atomic replacement;
- add `knolo.lock.json` upsert and digest-conflict protection;
- add `--out`, `--force`, and `--json`.

Exit gate: all eight contract acceptance cases pass, including no request to
the Hub origin for `/sha256/...`.

### PR 4 — local credentials and capability boundary

- implement `login`, `whoami`, and `logout`;
- enforce credential file and directory permissions;
- add an honest unsupported `publish` message only if the command is exposed;
- document that tokens are not verified until Hub Bearer auth exists.

Exit gate: no raw token appears in normal output, errors, or JSON output.

### PR 5 — docs, integration, and release

- update `packages/cli/README.md`, root CLI references, and V5.2 release notes;
- add an opt-in local-Hub smoke test using the supplied Hub seed/upload flow;
- add manual smoke commands for `https://hub.knolo.dev`;
- extend package tarball and release-preflight checks;
- run the complete V5.2 release gates.

Exit gate: clean package artifact inspection, CLI test suite, core tests, docs
link checks, and release metadata all pass.

## Acceptance tests

The CLI PR must include deterministic tests for:

1. a mocked Hub manifest plus a temporary Blob response writes the cache and a
   lockfile with the matching digest;
2. a manifest/body digest mismatch fails without a lockfile write;
3. an empty manifest URL fails with the stored-bytes message;
4. a 410 yanked manifest fails without `--force` and succeeds with it only
   after printing a warning;
5. a 404 fails with not-found wording;
6. `search refunds` against `{ "packs": [...] }` renders pack names;
7. the three supported spec forms parse and resolve correctly;
8. the Blob host is fetched while the Hub origin is never asked for
   `/sha256/...`;
9. `Content-Length` and body-length mismatches fail;
10. malformed manifests, invalid SHA-256 values, non-HTTPS Blob URLs, invalid
    Knowledge Images, and oversized bodies fail closed;
11. an existing lockfile digest conflict refuses without `--force`;
12. local `knolo add <name> <path>` continues to update `knolo.config.json`;
13. credentials are written with restrictive permissions and `whoami` makes no
    network call;
14. raw token values are absent from stdout/stderr on login and command errors.

Tests should use injected fetch/filesystem seams for the HTTPS Blob cases, plus
the existing subprocess harness for command routing, output, exit codes, and
published-package behavior. An opt-in live-Hub test may run only when all Hub
credentials/environment are explicitly supplied; CI must not depend on the
deployed service.

## Release and version decision

The current `scripts/check-release-metadata.mjs` validates the published
`5.1.0` workspace line plus the explicit CLI-only `5.2.0` wave.
Decision for this workstream: release `@knolo/cli@5.2.0` only, keeping its
compatible `@knolo/core` range at `^5.1.0`. Do not republish the already-live
core, adapters, starter app, Rust crates, or Python distribution.

The release metadata checker now explicitly validates this CLI-only wave and
keeps the other packages on the published `5.1.0` line. The CLI depends on
`@knolo/core@^5.1.0`, which is sufficient because the Hub integration is
implemented in the CLI package.

The Hub read path itself is additive and does not require a core format bump.
`@knolo/core` should only be bumped for unrelated V5.2 interoperability work or
for a required validation/export fix discovered during implementation.

## Hub-owned follow-ups

Track these in `knolo-hub`, not as CLI workarounds:

- Bearer token authentication on upload, publish, and yank APIs;
- CLI-usable upload/signing protocol independent of browser-only
  `@vercel/blob/client` APIs;
- draft, verify-job, release, and yank endpoints;
- manifest `Cache-Control: no-store` and asynchronous pull increments;
- any API/schema changes needed for publish ownership or attestation.

When those contracts ship, add a later CLI workstream for `publish` and
`yank`. The V5.2 read path should not wait for them.

## Start checklist

- [x] Confirm `https://hub.knolo.dev` is the production Hub origin.
- [x] Select a deliberate CLI-only `@knolo/cli@5.2.0` release.
- [x] Confirm the lockfile filename `knolo.lock.json` and registry-mixing rule.
- [x] Implement PR 1 with no Hub dependency in CI.
- [x] Implement PR 2 discovery commands with deterministic fixture coverage.
- [x] Implement PR 3 verified installation with digest, size, and core checks.
- [x] Implement PR 4 local credentials and the write-capability boundary.
- [x] Implement the local PR 5 docs, opt-in smoke harness, and release checks.
- [x] Record the supplied contract and link this plan in the V5.2 release record.
- [x] Run the read-path acceptance tests before any publish/yank work begins.
