# @knolo/box

`@knolo/box` builds pinned V5 images of a Grok Bot computer and starts the existing read-only `knolo-mcp` server as one process. It is a builder and a launcher. It does not proxy JSON-RPC, and it does not call a model.

This package is not on npm yet. From this repository, after the workspace build:

```bash
node packages/box/bin/knolo-box.mjs build
node packages/box/bin/knolo-box.mjs status
node packages/box/bin/knolo-box.mjs mcp
```

`mcp` spawns `knolo-mcp --config <output>/knolo-mcp.json` with stdio inherited. The parent does not write to stdout. Logs stay on stderr. A changed image, or a changed `knolo-mcp.json`, is checked on the next tool call. When the file matches the pin in `knolo-mcp.json`, that call serves the new image, `knolo_verify` is valid, and the `knolo_status` `stateRoot` matches `knolo-box status`. A scope removed from that config is no longer served, even when its old image file is still on disk. A file that does not match the pin returns `IMAGE_INVALID` and no hits. An unchanged file stays loaded.

## What gets indexed

The default computer is `$GROK_HOME` or `~/.grok`. Output defaults to `~/.knolo/box/`. Paths in a config file may use `~`, `$GROK_HOME`, and `${GROK_HOME}`.

| Scope         | Default roots                                                                                         | Who can read                      |
| ------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| `skills`      | `skills/` and `bundled/skills/` under the Grok home. Only `SKILL.md`.                                 | Configured agents. Default `box`. |
| `files`       | None. A fresh install does not walk the disk. Add roots yourself. `.md`, `.mdx`, `.txt`, `.markdown`. | Configured agents.                |
| `memory`      | `memory-v2/`. Topic notes and `observations/_inbox/*.md`.                                             | Configured agent. Default `box`.  |
| `transcripts` | `sessions/`. Newest 2,000 `summary.json` files, plus user and assistant text.                         | Configured agent. Default `box`.  |

Empty scopes are omitted. `MEMORY.md` is a generated index and is not indexed. Sqlite files, system prompts, tool definitions, reasoning, tool results, and backend tool calls are left out. Chat history over 8 MiB is skipped, and the summary is still indexed. A turn over 8 KiB is dropped. A session stops after 64 KiB of kept turn text. Other files over 256 KiB are skipped and listed in the build report.

The builder refuses the build before it writes a new image when kept text contains a private-key header or a `ghp_` / `github_pat_` token. The previous images stay in place.

Each chunk starts with `source` and `locator`, plus `when` and `agent` when the source has them. Search excerpts include that header. `locator` is `lines N-M` or `turn N`. `knolo_search` matches whole words and can label a hit `partial`. EQL `SEARCH` still matches every term as a substring. A search receipt records `caller.agentId`, `hitCount`, and `durationMs`. `agentId` comes from `box.config.json` when that field is set, otherwise from `KNOLO_BOX_AGENT_ID`, and otherwise it is `box`. `sessionId` uses the config field, then `KNOLO_BOX_SESSION_ID`. When `sessionId` is unset, the MCP client name remains the session fallback. The client name does not become the agent id. Tool arguments cannot set either value. One shared server process cannot see a different session id per chat. The rules and the stopword list are in [the box doc](../../docs/box/README.md).

## Files

`knolo-box build` writes:

- `skills.v5`, `files.v5`, `memory.v5`, `transcripts.v5` for scopes that had text
- `policy.json` with default deny, and query plus read for principal `box:reader`
- `pins.json` with the file SHA-256, `stateRoot`, `builtAt`, and the source digest
- `knolo-mcp.json` for the configured agent, default `box`, including private mounts, when at least one image was built
- `knolo-mcp-shared.json` when at least one shared mount remains, without memory and transcripts

A later build removes a config that would have no mounts. `knolo-box mcp` stops before starting the server when `knolo-mcp.json` is missing or has no mounts.

- `audit/` beside the images, capped at 10,000 records and 256 MiB

The same source digest keeps the same image bytes, `stateRoot`, and `builtAt`. `knolo-box status` prints `stateRoot`, `builtAt`, `pinMatches`, `stale`, and `lastAutoRebuild`. `stale: true` means the files under that scope changed after `builtAt`, or a root is missing, or indexed text now matches a secret pattern. The pin can still match. `knolo_status` and `knolo_verify` include `builtAt` and `stale` only when the mount records `sourceRoots`. A config without those fields omits them. `knolo_verify` stays `valid: true` when the pin matches and the sources are stale.

`autoRebuild` is off when the field is absent. `KNOLO_BOX_AUTO_REBUILD` is read only when the field is absent: `true` or `1` turns it on, and `false` or `0` leaves it off. While it is off, a source change leaves `stale: true` and does not write a new image or pin. While it is on, the next `knolo-box status`, `knolo_status`, or `knolo_search` that sees a changed source fingerprint rebuilds that scope. A second call inside 2 seconds does not rebuild again. Success writes a new image and a new pin, status reports `stale: false`, and `lastAutoRebuild` records the time and `ok: true`. Failure leaves the previous image and pin, leaves `stale: true`, and records `ok: false` with a short reason. `knolo_status` then shows that new pin, or the previous pin when the rebuild failed. There is no file-watcher daemon. The MCP hook is written when `knolo-box` was started with `--config`, because the hook keeps that config path.

A user crontab can still refresh the images:

```cron
0 3 * * * knolo-box build
```

When the computer is not `~/.grok`, run `knolo-box init --config <file>`. It follows symlinks and keeps one real path for workflows and one for managed skills. It also keeps one memory directory and one sessions directory when exactly one candidate exists. Zero or several candidates leave that scope empty and the reason is printed on stderr. `--skills`, `--managed-skills`, `--memory`, `--transcripts`, and `--files` skip detection for that role. `files` stays empty unless `--files` is set. A hand-written config remains valid. A scope left out of a hand-written file still uses the default roots. The details are in [the box doc](../../docs/box/README.md).

## Plugin

Grok Build can install the skill and the MCP server with `--trust`:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-box --trust
```

The plugin command is `npx -y @knolo/box@0.1.0 mcp`. That package is not published yet, so use the workspace binary until it is. See [the box doc](../../docs/box/README.md) and [the plugin README](../../plugins/knolo-box/README.md).

Repository code stays on [@knolo/code](../code/README.md). This package does not index `.ts`, `.js`, or `.py` trees.
