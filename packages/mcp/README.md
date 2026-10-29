# @knolo/mcp

`@knolo/mcp` is a read-only [MCP](https://modelcontextprotocol.io) server for
pinned Knolo V5 Knowledge Images. It exposes the same four tools as
`@knolo/openclaw`: `knolo_search`, `knolo_get`, `knolo_verify`, and
`knolo_status`. Pins, policy checks, and query receipts come from
`@knolo/tools`. When at least one mount includes a `kar` block, the server
also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and
`knolo_cortex_verify`.

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

`@knolo/mcp@0.2.0` is the in-tree server. This change does not publish it to
npm or the MCP Registry. The registry name in `server.json` is
`io.github.HiveForensics-AI/knolo`. Published `@knolo/mcp@0.1.0` remains the
four-tool server.

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
      "principal": "<policy principal>",
      "kar": {
        "graphPath": "/opt/knolo/handbook.kar.json",
        "graphSha256": "<64 hex>"
      }
    }
  ]
}
```

`kar` is optional. `graphSha256` is the raw file SHA-256, 64 lowercase hex
characters, without a `sha256-` prefix. The server hashes that file and binds
it to the mount before it accepts a connection. A hash or binding mismatch
exits before MCP starts. A call for a mount that has no `kar` block fails
closed when the three tools are enabled by another mount.

`knolo_kar_evaluate` takes `mountId`, `proposition`, and an inline `plan`
object of at most 65536 UTF-8 bytes. `SATISFIED` means evidence requirements
were met. It does not mean a claim is proven.
`UNSATISFIED_EVIDENCE_REQUIREMENTS` is a completed evaluation. The plan is
parsed by the KAR plan parser. Domain Pack template names are not accepted.

`knolo_kar_verify` takes the same mount, proposition, and plan, plus exactly
one of `result` or `dossier`. `knolo_cortex_verify` takes `mountId`, an
`answer` trace, and an optional `question`. It uses the pinned graph when the
trace references KAR. These tools do not call a model and do not run
`askCortex`.

Query receipts stay `openclaw-knolo-query-v1`. KAR and Cortex tools write
`knolo-mcp-evidence-receipt-v1` in `auditDir` before they return a result. An
unwritable audit directory returns `AUDIT_UNAVAILABLE` and no result.

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

The package requires Node 20 or newer, `@knolo/core` `^6.2.0`, and
`@knolo/tools` `^0.2.0`. Coverage, composition, and authoring stay outside
this server. Verification checks integrity. It does not decide that a claim
or an answer is true.
