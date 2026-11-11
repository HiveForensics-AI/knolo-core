# Community hub and one install path

**Status:** install path for [knolo-core#143](https://github.com/HiveForensics-AI/knolo-core/issues/143). `knolo setup`, public skill install, `knolo skill search`, and `knolo skill info` are commands. Skill versions, the skill secret scan, and skill yank stay hub work.
**Prepared:** 2026-11-10

This document is the product plan for hub.knolo.dev and for the core, CLI, Box, MCP, and SDK work that belongs in knolo-core. It does not change a package version and it does not publish to npm. Hub HTTP stays in the hub repo: `docs/cli-contract.md` and `docs/registry-api.md`. This file does not copy those tables.

## Product rule

Knolo has two catalogs. They stay separate.

| Catalog | Identity | Artifact | Commands |
| --- | --- | --- | --- |
| Knowledge packs | `publisher/slug@version` | `.knolo` | `knolo search`, `info`, `add`, `publish`, `yank` |
| Skill packs | `publisher/name` | `knolo-skill-pack-v1` | `knolo skill init`, `check`, `pack`, `publish`, `install`, `search`, `info`, `list` |

The hub stores packs and pins. It does not run a model, and it does not answer questions. Installing a pack is a local decision by whoever runs the agent. A search hit is data. A receipt is an integrity check. `SATISFIED` means the evidence requirements were met. It does not mean a claim is proven.

`@knolo/mcp` and `@knolo/ai-sdk` stay read-only. They search, fetch, and verify mounts that are already on disk. They do not download a catalog pack, and they do not publish. See [MCP](../../packages/mcp/README.md) and [the AI SDK](../../packages/ai-sdk/README.md).

`create-knolo-app` scaffolds a Next.js app. It is not the agent-host install.

## What already ships

Knowledge packs on the hub have a catalog, search, versions, stars, yank, reports, a secret scan, and GitHub login that mints `kno_…` publish tokens. The CLI searches that catalog, installs through the manifest plus a direct Blob download, and records the pin in `knolo.lock.json`. A pin mismatch writes nothing. Current `@knolo/cli` implements `knolo publish` and `knolo yank` against the live hub routes. `@knolo/cli@5.2.0` was the stub.

Skill packs ship as [Skills](../skills/README.md). `publish` sends the pack to `https://hub.knolo.dev` unless `--hub` names a local directory. The same pin republishes as unchanged. A different pin for the same name is refused, and the catalog row stays. `install <publisher>/<name>` checks the archive pin and the pins inside it, then writes `<dir>/<name>/`. `--dir` defaults to `~/.knolo/skills`. A mismatch writes nothing. Install refuses to replace an existing directory. The site lists skills at `/skills` and `/skills/<publisher>/<name>`.

`@knolo/box` builds pinned images of skills, memory, and transcripts and starts read-only `knolo-mcp`. The default computer is `$GROK_HOME` or `~/.grok`. Output is `~/.knolo/box/`. The Grok plugin is `plugins/knolo-box`. Its MCP command is `npx -y @knolo/box@0.1.1 mcp`. npm `latest` for Box is `0.1.1`. The published CLI release that includes `knolo setup` and `knolo skill` is `npx -y @knolo/cli@6.2.3`. `@knolo/cli` depends only on `@knolo/core`. It does not depend on Box. npm `latest` for the server is `@knolo/mcp@0.2.3`.

## Install

The single entry point is `knolo setup`. It is one command in `@knolo/cli`, not a new package. The contract is:

1. Resolve the registry the same way as the other hub commands. `--registry` wins over `KNOLO_HUB_URL`. When neither is set, development mode (`NODE_ENV=development` or `KNOLO_ENV=development`) uses `http://localhost:3000`. Otherwise the default is `https://hub.knolo.dev`.
2. If `knolo-box` is on `PATH` and `~/.knolo/box/box.config.json` is absent, run `knolo-box init --tolerant` and then `knolo-box build --config ~/.knolo/box/box.config.json`. When that file already exists, keep it and run the build. `--reset` replaces it. `--root`, `--agent`, `--auto-rebuild`, `--skills`, `--managed-skills`, `--memory`, and `--transcripts` merge into the existing file. A plain run also merges `~/.knolo/skills` when that root is missing. Scan `~/.grok` when that directory exists, plus every `--root`. `--root` may be the parent of `agent-data` or `sand-data`, or that directory itself. Do not require `~/.grok`. Do not scan the whole home directory. Always include `~/.knolo/skills` as a skills root. `--agent <id>` writes `agentId`. `--auto-rebuild` writes `autoRebuild: true`. Omitting those flags on a new file leaves the caller as `box` and leaves auto-rebuild off. On an existing file, omitting them keeps the current caller and auto-rebuild setting. Setup does not prompt. Zero detected Grok skill folders still writes the config and prints the scanned roots and that none was found. More than one folder for a role prints one line naming `--skills` or `--managed-skills` and does not guess. A direct `knolo-box init` stays strict: zero or several skill folders stop with `BOX_CONFIG` and the count of matches, and write no file. An existing config is left unchanged unless `--force` replaces it or `--merge` adds roots.
3. If `knolo-box` is missing, print that and continue. Do not run `init` or `build`. Setup exits 0.
4. Print the config path, `knolo skill install <publisher>/<name>`, and `knolo-box mcp --config <absolute box.config.json>`. Also print that publish needs a token from `<resolved>/dashboard/tokens`. `knolo login` without `--registry` stores the token for the process default, and a later call refuses to send that token anywhere else. Install does not read a stored token. The download does not send one.
5. Do not install a community pack. Do not call a hub write API. Do not add tools to MCP.

Tests for that command use a temporary `PATH`. A fake `knolo-box` accepts `init` and then `build`. They do not use the network, and the CLI does not depend on `@knolo/box`.

The Grok connector stays:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-box --trust
```

`@knolo/box@0.1.1` is on npm. The plugin command is `npx -y @knolo/box@0.1.1 mcp`.

## Auth

GitHub sign-in is for the hub dashboard. The dashboard mints a `kno_…` token. `knolo login` stores that token for one registry and does not call a hub login route. The stored registry is the `--registry` value, or the same default as the other hub commands. Reads of both catalogs are public. `knolo skill install <publisher>/<name>`, `knolo skill search`, and `knolo skill info` do not read that token, and their downloads do not send it. Publish and yank send `Authorization: Bearer kno_…` and require the publish scope. A 401 means the scheme is missing or the token was revoked. It does not mean the write API requires a browser session.

`knolo setup` does not mint a token and does not publish.

## Sharing

Browse knowledge packs at `/explore` and with `knolo search` / `knolo info`. Browse skill packs at `/skills`, or with `knolo skill search`, `knolo skill list`, and `knolo skill info`. Skill search and skill list read `GET /api/v1/skills`. Search filters on this machine. List prints every `publisher/name`. The list has no `q` parameter. Skill info reads one detail row. None of these commands send a token.

A skill catalog row carries the name (`publisher/name`), description, publisher, skill SHA-256, and policy SHA-256. When the pack includes an image, it also carries the image SHA-256 and state root. The detail response adds the archive SHA-256, the Blob URL, and the size. The list omits the archive URL. The hub does not search the image.

Install writes `<dir>/<name>/`. `--dir` defaults to `~/.knolo/skills`. When that folder is a skills root in the box config and `knolo-box` is on `PATH`, install runs one build so the next search can see the skill. A root written as `~/...` or `$GROK_HOME/...` counts, and a skills scope left out of the file uses the default `~/.grok` skill folders. A folder outside those roots is still written, and install prints that it was not indexed. A failed build leaves the installed files in place and prints that the install was not indexed. Setup does not copy a skill into a Grok skills directory by itself. The hub skills root is indexed because setup adds it.

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

These are the commands that exist in this tree. `knolo setup` runs when `knolo-box` is on `PATH`, then prints the connector command. A custom registry uses `--registry <url>` on `setup`, `login`, `publish`, and `yank`.

1. Install with `npx -y @knolo/cli@6.2.3`. The connector package on npm is `npx -y @knolo/box@0.1.1`.
2. Build a local index: `knolo setup --root <dir> --agent <id> --auto-rebuild`. `--root` and `--agent` and `--auto-rebuild` are optional. Setup scans `~/.grok` when it exists and does not require it. The printed connector command is `knolo-box mcp --config <path>`. The host then calls `knolo_search`. For a `.knolo` file already on disk, `knolo query` or `knolo verify` is the local check.
3. Browse skills at `https://hub.knolo.dev/skills`, or run `knolo skill list` or `knolo skill search "refund"`. Knowledge packs: `knolo search "refund policy"`. None of these require login.
4. Install one skill: `knolo skill install <publisher>/<name>`. That writes `~/.knolo/skills/<name>` unless `--dir` is set, then rebuilds the local index when that folder is configured. This does not require `knolo login`.
5. Publish: create a token at `https://hub.knolo.dev/dashboard/tokens`, run `knolo login --token kno_…`, then `knolo skill publish <pack>` or `knolo publish <pack.knolo>`.
6. Verify a skill you are authoring with `knolo skill check <dir>`. That command reads a `knowledge/` directory. An installed pack already passed its pin check and contains `knowledge.v5`. `knolo verify <pack.knolo>` checks a knowledge pack.

## Follow-up checklist

File these only when asked. The acceptance notes are the scope. Do not start a blocked item early.

### knolo-core

1. **`knolo setup`.** Implemented. The contract is in [Install](#install).
2. **Public skill install.** Implemented. `knolo skill install <publisher>/<name>` resolves the registry with `resolveRegistryUrl` and does not call `loadCredentials()`.
3. **`knolo skill search` and `knolo skill info`.** Implemented. Search reads `GET /api/v1/skills` and filters on this machine. Info reads one detail row.
4. **Skill install `@version` and `knolo-skills.lock.json`.** Wait for hub item 6. `--force` replaces a directory only when the downloaded pin matches. A mismatch writes nothing.
5. **Box npm release.** `@knolo/box@0.1.1` is published. The plugin command is `npx -y @knolo/box@0.1.1 mcp`.

### knolo-hub

6. **Skill versions.** Add `skill_pack_versions` and a latest pointer. `GET /api/v1/skills/:publisher/:name/:version` returns one version. The same version and the same pin return unchanged. The same version and a different pin return `409`. The Blob path stays content-addressed. Blocks core item 4.
7. **Skill secret scan.** Run the pack scanner (`lib/verify/secret-scan.ts`) on `SKILL.md` and packed knowledge text inside skill registration, before insert. A hit fails closed and does not list the pack. Can start in parallel with item 6.
8. **Skill yank and report.** Owner yank and signed-in report. New target type. Do not point `reports.pack_id` at a skill row. Admin list and staff yank. `410` keeps the digest visible. Blob bytes stay. Start after item 6 so yank has a version to target.
9. **Publisher profile and skill page.** The publisher profile lists that publisher's skills. The skill page shows version, yank state, and `knolo skill install <publisher>/<name> --dir <path>`. It does not suggest a host-private path. Start after item 6.
10. **Contract docs in the same PR.** Update `docs/registry-api.md` and `docs/cli-contract.md` with each API change in items 6 through 9. Do not leave the HTTP docs on the one-pin rule after versions exist.

Core items 1, 2, and 3 are implemented. Hub items 6 and 7 can proceed on their own. Core item 4 waits on hub item 6. Hub items 8 and 9 follow item 6.

## Out of scope

- Skill versions, the skill secret scan, and skill yank. Those belong in the hub repository.
- A version bump, tag, or npm publish.
- Changing the read-only tools in `@knolo/mcp` or `@knolo/ai-sdk`.
- Calling a model from Knolo, or answering a question on the hub.
- Merging skill packs into `knolo publish` or `knolo add`.
- A publisher signature format.
- Host-specific private paths, rosters, or one person's computer layout.
- Installing a community skill into a Grok skills directory without `--dir`.
- Proxying pack bytes through the hub. Clients download Blob URLs directly.
