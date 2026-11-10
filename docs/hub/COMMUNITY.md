# Community hub and one install path

**Status:** design for [knolo-core#143](https://github.com/HiveForensics-AI/knolo-core/issues/143). The commands below that already ship stay as they are. `knolo setup` is specified here and is not a command yet.
**Prepared:** 2026-11-10

This document is the product plan for hub.knolo.dev and for the core, CLI, Box, MCP, and SDK work that belongs in knolo-core. It does not change a package version and it does not publish to npm. Hub HTTP stays in the hub repo: `docs/cli-contract.md` and `docs/registry-api.md`. This file does not copy those tables.

## Product rule

Knolo has two catalogs. They stay separate.

| Catalog | Identity | Artifact | Commands |
| --- | --- | --- | --- |
| Knowledge packs | `publisher/slug@version` | `.knolo` | `knolo search`, `info`, `add`, `publish`, `yank` |
| Skill packs | `publisher/name` | `knolo-skill-pack-v1` | `knolo skill init`, `check`, `pack`, `publish`, `install` |

The hub stores packs and pins. It does not run a model, and it does not answer questions. Installing a pack is a local decision by whoever runs the agent. A search hit is data. A receipt is an integrity check. `SATISFIED` means the evidence requirements were met. It does not mean a claim is proven.

`@knolo/mcp` and `@knolo/ai-sdk` stay read-only. They search, fetch, and verify mounts that are already on disk. They do not download a catalog pack, and they do not publish. See [MCP](../../packages/mcp/README.md) and [the AI SDK](../../packages/ai-sdk/README.md).

`create-knolo-app` scaffolds a Next.js app. It is not the agent-host install.

## What already ships

Knowledge packs on the hub have a catalog, search, versions, stars, yank, reports, a secret scan, and GitHub login that mints `kno_…` publish tokens. The CLI searches that catalog, installs through the manifest plus a direct Blob download, and records the pin in `knolo.lock.json`. A pin mismatch writes nothing. Current `@knolo/cli` implements `knolo publish` and `knolo yank` against the live hub routes. `@knolo/cli@5.2.0` was the stub.

Skill packs ship as [Skills](../skills/README.md). `publish` sends the pack to `https://hub.knolo.dev` unless `--hub` names a local directory. The same pin republishes as unchanged. A different pin for the same name is refused, and the catalog row stays. `install <publisher>/<name> --dir <path>` checks the archive pin and the pins inside it, then writes only `<path>/<name>/`. A mismatch writes nothing. Install refuses to replace an existing directory. The site lists skills at `/skills` and `/skills/<publisher>/<name>`.

`@knolo/box` builds pinned images of skills, memory, and transcripts and starts read-only `knolo-mcp`. The default computer is `$GROK_HOME` or `~/.grok`. Output is `~/.knolo/box/`. The Grok plugin is `plugins/knolo-box`. Its MCP command is `npx -y @knolo/box@0.1.0 mcp`. That package is not on npm, so the plugin install fails until a later release. Until then, use the workspace binary in [the Box README](../../packages/box/README.md). `@knolo/cli` depends only on `@knolo/core`. It does not depend on Box.

## Install

The single entry point is `knolo setup`. It is one command in `@knolo/cli`, not a new package. A follow-up issue implements it. The contract is:

1. Resolve the registry the same way as the other hub commands. `--registry` wins over `KNOLO_HUB_URL`. When neither is set, development mode (`NODE_ENV=development` or `KNOLO_ENV=development`) uses `http://localhost:3000`. Otherwise the default is `https://hub.knolo.dev`.
2. If `knolo-box` is on `PATH` and a Grok home exists, run `knolo-box build` with the default config. That config uses `$GROK_HOME` or `~/.grok`, and its skill roots are `skills/` and `bundled/skills/`. Do not run `knolo-box init`. `init` requires exactly one `agent-data/workflows` or `sand-data/workflows` directory and does not look at those default skill roots, so it fails on a normal Grok home and never reaches `build`. A computer that is not `~/.grok` keeps the existing `knolo-box init --config <file>` step in the Box README. Setup does not invent a computer layout. Writes stay under the Box output directory, `~/.knolo/box/` unless that config says otherwise.
3. If `knolo-box` is missing, or no Grok home exists, print that and continue. Do not run `build`. Setup exits 0. Empty scopes stay empty.
4. Print three next steps and do not write anything else. Every registry URL in those steps is the registry resolved in step 1. `knolo login`, `knolo skill publish`, `knolo publish`, and `knolo yank` include `--registry <resolved>` so they do not store or send a token for a different origin. `knolo login` without `--registry` stores the token for the process default, and a later call refuses to send that token anywhere else.
   - First search: the Box MCP config path, or `knolo-mcp` when a mount already exists.
   - First install: `knolo skill install <publisher>/<name> --dir <path>`. Today's command calls `loadCredentials()` before the public download and exits with `Not logged in` until `knolo login --registry <resolved>` has run. The download does not send the token. Follow-up 2 removes that credential check.
   - First publish: mint a token at `<resolved>/dashboard/tokens`, then `knolo login --registry <resolved>`, then `knolo skill publish` or `knolo publish` with the same `--registry`.
5. Do not install a community pack. Do not call a hub write API. Do not add tools to MCP.

Tests for that command use a temporary `PATH` and a fake `knolo-box`. The fake accepts `build` and fails the test if setup runs `init`. They do not use the network, and they do not add a dependency on `@knolo/box`.

The Grok connector stays:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-box --trust
```

Publishing `@knolo/box` is a release task. It is not part of #143. The plugin README already says the `npx` command fails until that package is on npm.

## Auth

GitHub sign-in is for the hub dashboard. The dashboard mints a `kno_…` token. `knolo login` stores that token for one registry and does not call a hub login route. The stored registry is the `--registry` value, or the same default as the other hub commands. Reads of both catalogs are public. Publish and yank send `Authorization: Bearer kno_…` and require the publish scope. A 401 means the scheme is missing or the token was revoked. It does not mean the write API requires a browser session. Today's `knolo skill install <publisher>/<name>` still calls `loadCredentials()` before its public download. That check is follow-up 2.

`knolo setup` does not mint a token and does not publish.

## Sharing

Browse knowledge packs at `/explore` and with `knolo search` / `knolo info`. Browse skill packs at `/skills`. The CLI cannot search skills yet. That is follow-up 3.

A skill catalog row carries the name (`publisher/name`), description, publisher, skill SHA-256, and policy SHA-256. When the pack includes an image, it also carries the image SHA-256 and state root. The detail response adds the archive SHA-256, the Blob URL, and the size. The list omits the archive URL. The hub does not search the image.

Install still requires `--dir`. The destination is only `<dir>/<name>/`. Setup does not copy a skill into a Grok skills directory.

Publish stays explicit. `knolo skill publish <pack>` uses the stored token. `knolo publish` remains the command for a `.knolo` knowledge pack. `--hub <dir>` is an offline directory, and it cannot be combined with `--registry`.

## Trust

The install pin check is the rule for both catalogs. A mismatch refuses the install and writes nothing.

Knowledge packs are already secret-scanned during hub verification. Owners can yank a version. A signed-in user can report a pack. Yank returns `410` and leaves the Blob in place.

Skill trust in this design is the pin plus the hub account that published it. There is no new publisher signature. A pin does not prove that the text is true.

Follow-ups add the existing pack secret scanner to skill text before a skill is listed, and add yank and report for skills. A yanked skill returns `410` with the digest still visible. The Blob stays. Skill reports use their own target. They do not reuse `reports.pack_id`.

## Versions

Knowledge packs are already versioned. `knolo add` records the pin in `knolo.lock.json`. `--force` is required for a yanked version or a conflicting pin, and it cannot skip the digest check.

A skill name has one pin today. Republishing that pin leaves the row unchanged. A different pin returns `409 pin_conflict`. The upgrade path until hub item 6 is a new skill name. Do not overwrite a published pin.

The follow-up adds `@version`, a latest pointer, and `GET /api/v1/skills/:publisher/:name/:version`. The same version and the same pin return unchanged. The same version and a different pin stay `409`. The Blob path stays content-addressed. After that API exists, `knolo skill install` accepts `@version`, writes `knolo-skills.lock.json` in `--dir`, and replaces an existing directory only with `--force` after the new pin matches. A mismatch still writes nothing.

New skill images are built with `@knolo/core` `^6.2.0`, the same floor as `@knolo/cli`. The hub does not transcode an older image. Verifying an older image is the caller's local tool.

## First session

These are the commands that exist today on the production hub. `knolo setup` will replace the Box build and the printed next steps. It is not implemented yet. A custom registry uses the same commands with `--registry <url>` on `login`, `publish`, and `yank`.

1. Install the CLI: `npm install -g @knolo/cli`.
2. Build a local index when this checkout is available and a Grok home exists: `node packages/box/bin/knolo-box.mjs build`, then `node packages/box/bin/knolo-box.mjs mcp`. Do not run `init` for this default layout. Skip this step when there is no Grok home. The host then calls `knolo_search`. For a `.knolo` file already on disk, `knolo query` or `knolo verify` is the local check.
3. Browse skills at `https://hub.knolo.dev/skills`. Knowledge packs: `knolo search "refund policy"`. `knolo search` does not require login.
4. Log in before a registry skill install. Create a token at `https://hub.knolo.dev/dashboard/tokens`, then `knolo login --token kno_…`. `knolo skill install <publisher>/<name>` calls `loadCredentials()` before the public download and exits with `Not logged in` until that file exists. The download does not send the token. `--hub` and `--pack` do not use it.
5. Install one skill into a directory you choose: `knolo skill install <publisher>/<name> --dir ./skills`.
6. Publish with the stored token: `knolo skill publish <pack>` or `knolo publish <pack.knolo>`.
7. Verify: `knolo skill check <dir>` for a skill directory, or `knolo verify <pack.knolo>` for a knowledge pack.

## Follow-up checklist

File these only when asked. The acceptance notes are the scope. Do not start a blocked item early.

### knolo-core

1. **`knolo setup`.** Implement the contract in [Install](#install). Tests use a temporary `PATH` and a fake `knolo-box` that accepts `build` and fails if setup runs `init`. No network. No new dependency on `@knolo/box`. Can start now.
2. **Public skill install.** `knolo skill install <publisher>/<name>` resolves the registry with `resolveRegistryUrl` and does not call `loadCredentials()`. A stored credential for another registry is not consulted. `--hub` and `--pack` stay local. Can start now.
3. **`knolo skill search` and `knolo skill info`.** Read `GET /api/v1/skills` with the same registry flags as `knolo search`. Read-only. Can start now. The hub list route already exists.
4. **Skill install `@version` and `knolo-skills.lock.json`.** Wait for hub item 6. `--force` replaces a directory only when the downloaded pin matches. A mismatch writes nothing.
5. **Box npm release.** Keep the plugin README accurate: `grok plugin install` works only after `@knolo/box` is published. Publishing that package is a release task, not part of #143.

### knolo-hub

6. **Skill versions.** Add `skill_pack_versions` and a latest pointer. `GET /api/v1/skills/:publisher/:name/:version` returns one version. The same version and the same pin return unchanged. The same version and a different pin return `409`. The Blob path stays content-addressed. Can start in parallel with core items 1, 2, and 3. Blocks core item 4.
7. **Skill secret scan.** Run the pack scanner (`lib/verify/secret-scan.ts`) on `SKILL.md` and packed knowledge text inside skill registration, before insert. A hit fails closed and does not list the pack. Can start in parallel with item 6.
8. **Skill yank and report.** Owner yank and signed-in report. New target type. Do not point `reports.pack_id` at a skill row. Admin list and staff yank. `410` keeps the digest visible. Blob bytes stay. Start after item 6 so yank has a version to target.
9. **Publisher profile and skill page.** The publisher profile lists that publisher's skills. The skill page shows version, yank state, and `knolo skill install <publisher>/<name> --dir <path>`. It does not suggest a host-private path. Start after item 6.
10. **Contract docs in the same PR.** Update `docs/registry-api.md` and `docs/cli-contract.md` with each API change in items 6 through 9. Do not leave the HTTP docs on the one-pin rule after versions exist.

Order: this document first. Hub items 6 and 7 can proceed with core items 1, 2, and 3. Core item 4 waits on hub item 6. Hub items 8 and 9 follow item 6.

## Out of scope

- Implementing setup, public skill install, skill search, skill versions, secret scan, or yank in the pull request that adds this document.
- A version bump, tag, or npm publish.
- Changing the read-only tools in `@knolo/mcp` or `@knolo/ai-sdk`.
- Calling a model from Knolo, or answering a question on the hub.
- Merging skill packs into `knolo publish` or `knolo add`.
- A publisher signature format.
- Host-specific private paths, rosters, or one person's computer layout.
- Installing a community skill into a Grok skills directory without `--dir`.
- Proxying pack bytes through the hub. Clients download Blob URLs directly.
