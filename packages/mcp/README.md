# @knolo/mcp

`@knolo/mcp` is a read-only [MCP](https://modelcontextprotocol.io) server for
pinned Knolo V5 Knowledge Images. It exposes the same four tools as
`@knolo/openclaw`: `knolo_search`, `knolo_get`, `knolo_verify`, and
`knolo_status`. Pins, policy checks, and query receipts come from
`@knolo/tools`.

The server speaks stdio only. It does not download images, open a runtime
network connection, write or compile knowledge, or expose MCP resources or
prompts. Install and pin each image before starting it. A hash, state-root,
or policy-root mismatch exits non-zero before the MCP connection starts.

Caller identity is `agentId` in the config file, default `mcp`. That id must
be listed in the mount's `agents` array. Tool arguments cannot set it. The
MCP client's `clientInfo.name` is stored on the receipt as `sessionId` and is
not used for authorization. One `principal` per mount is what policy
evaluation sees.

Every search writes an `openclaw-knolo-query-v1` receipt before it returns
hits. An unwritable `auditDir` returns `AUDIT_UNAVAILABLE` and no hits.
Restart the process to change pins. There is no hot reload.

`@knolo/mcp@0.1.0` is not published to npm or the MCP Registry yet. The
registry name in `server.json` is `io.github.HiveForensics-AI/knolo`.

## Config

Paths are absolute. `sha256` is 64 lowercase hex characters. `stateRoot` is
`sha256-` plus 64 lowercase hex characters.

```json
{
  "agentId": "mcp",
  "auditDir": "/var/lib/knolo/receipts",
  "mounts": [
    {
      "id": "handbook",
      "path": "/opt/knolo/handbook.knolo",
      "sha256": "<64 hex>",
      "stateRoot": "sha256-<64 hex>",
      "policyPath": "/opt/knolo/handbook.policy.json",
      "agents": ["mcp"],
      "principal": "<policy principal>"
    }
  ]
}
```

Start it with `knolo-mcp --config /absolute/knolo-mcp.json` or
`KNOLO_MCP_CONFIG`. Logs go to stderr. Stdout is JSON-RPC only.

## Clients

Claude Desktop, Claude Code, and Cursor:

```json
{
  "mcpServers": {
    "knolo": {
      "command": "npx",
      "args": ["-y", "@knolo/mcp", "--config", "/absolute/knolo-mcp.json"]
    }
  }
}
```

Claude Code CLI:

```sh
claude mcp add knolo -- npx -y @knolo/mcp --config /absolute/knolo-mcp.json
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "knolo": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@knolo/mcp",
        "--config",
        "${workspaceFolder}/knolo-mcp.json"
      ]
    }
  }
}
```

The package requires Node 20 or newer and `@knolo/core` `^6.0.0`. It does not
implement KAR, coverage, or composition.
