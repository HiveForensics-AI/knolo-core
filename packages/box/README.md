# @knolo/box

`@knolo/box` builds pinned V5 images of a Grok Bot computer and starts the existing read-only `knolo-mcp` server as one process. It is a builder and a launcher. It does not proxy JSON-RPC, and it does not call a model.

This package is not on npm yet. From this repository, after the workspace build:

```bash
node packages/box/bin/knolo-box.mjs build
node packages/box/bin/knolo-box.mjs status
node packages/box/bin/knolo-box.mjs mcp
```

`mcp` spawns `knolo-mcp --config <output>/knolo-mcp.json` with stdio inherited. The parent does not write to stdout. Logs stay on stderr. A changed image is visible the next time the server starts. An unchanged pin needs no restart.

## What gets indexed

The default computer is `$GROK_HOME` or `~/.grok`. Output defaults to `~/.knolo/box/`. Paths in a config file may use `~`, `$GROK_HOME`, and `${GROK_HOME}`.

| Scope         | Default roots                                                                                         | Who can read                      |
| ------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| `skills`      | `skills/` and `bundled/skills/` under the Grok home. Only `SKILL.md`.                                 | Configured agents. Default `box`. |
| `files`       | None. A fresh install does not walk the disk. Add roots yourself. `.md`, `.mdx`, `.txt`, `.markdown`. | Configured agents.                |
| `memory`      | `memory-v2/`. Topic notes and `observations/_inbox/*.md`.                                             | `box` only.                       |
| `transcripts` | `sessions/`. Newest 2,000 `summary.json` files, plus user and assistant text.                         | `box` only.                       |

Empty scopes are omitted. `MEMORY.md` is a generated index and is not indexed. Sqlite files, system prompts, tool definitions, reasoning, tool results, and backend tool calls are left out. Chat history over 8 MiB is skipped, and the summary is still indexed. A turn over 8 KiB is dropped. A session stops after 64 KiB of kept turn text. Other files over 256 KiB are skipped and listed in the build report.

The builder refuses the build before it writes a new image when kept text contains a private-key header or a `ghp_` / `github_pat_` token. The previous images stay in place.

Each chunk starts with `source` and `locator`, plus `when` and `agent` when the source has them. Search excerpts include that header. `locator` is `lines N-M` or `turn N`.

## Files

`knolo-box build` writes:

- `skills.v5`, `files.v5`, `memory.v5`, `transcripts.v5` for scopes that had text
- `policy.json` with default deny, and query plus read for principal `box:reader`
- `pins.json` with the file SHA-256, `stateRoot`, `builtAt`, and the source digest
- `knolo-mcp.json` for agent `box`, including private mounts, when at least one image was built
- `knolo-mcp-shared.json` when at least one shared mount remains, without memory and transcripts

A later build removes a config that would have no mounts. `knolo-box mcp` stops before starting the server when `knolo-mcp.json` is missing or has no mounts.

- `audit/` beside the images, capped at 10,000 records and 256 MiB

The same source digest keeps the same image bytes, `stateRoot`, and `builtAt`. `knolo-box status` prints `stateRoot`, `builtAt`, and whether the pin matches the file. `knolo_status` does not include `builtAt`.

There is no daemon. A user crontab can refresh the images:

```cron
0 3 * * * knolo-box build
```

When the computer is not `~/.grok`, pass `--config` and set every scope. A scope left out still uses the default roots. An empty `roots` list indexes nothing for that scope. The config shape is in [the box doc](../../docs/box/README.md).

## Plugin

Grok Build can install the skill and the MCP server with `--trust`:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-box --trust
```

The plugin command is `npx -y @knolo/box@0.1.0 mcp`. That package is not published yet, so use the workspace binary until it is. See [the box doc](../../docs/box/README.md) and [the plugin README](../../plugins/knolo-box/README.md).

Repository code stays on [@knolo/code](../code/README.md). This package does not index `.ts`, `.js`, or `.py` trees.
