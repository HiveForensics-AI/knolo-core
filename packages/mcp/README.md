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
Optional mount fields `builtAt`, `sourceDigest`, and `sourceRoots`, plus
`grokHome`, let `knolo_status` and `knolo_verify` report a stale source tree.
Without those fields the status object stays `imageId`, `stateRoot`, `source`,
and `status`. A stale source does not make a matching pin invalid.

Caller identity is `agentId` in the config file, default `mcp`. That id must
be listed in the mount's `agents` array. Tool arguments cannot set it. An
optional config `sessionId` is stored on the receipt instead of the MCP
client name when it is set. Otherwise the client's `clientInfo.name` is
stored as `sessionId`. Neither value is used for authorization. `sessionId`
is captured when the process starts. One shared stdio process cannot see a
different session id for each chat. One `principal` per mount is what policy
evaluation sees.

`knolo_search` lowercases the query. A quoted phrase is one contiguous whole
phrase. Unquoted `OR` selects any remaining term. Unquoted stopwords and terms
shorter than 3 characters are dropped. A query that drops every term matches
nothing. Each kept term must appear as a whole word. `match` is `all`, `any`,
`partial`, or `none`. Hits with more matched terms come first, then matches in
the path's final segment and the first line, then matches in the rest of the
text, then object id. The stopword list is in the
[box doc](../../docs/box/README.md). A direct EQL `SEARCH` string is a
different matcher: every space-separated term is a substring, in object id
order.

Every search writes an `openclaw-knolo-query-v1` receipt before it returns
hits. The receipt records `match`, `hitCount`, `durationMs`, and the plan.
`hitCount` is the number of allowed hits. `durationMs` times the query and
the policy check, not the audit write. Verify checks `hitCount` against the
stored result and does not replay the clock. Older receipts without those
fields still verify. An unwritable `auditDir` returns `AUDIT_UNAVAILABLE` and
no hits.
Before each tool call, a server started from a config file stats that config,
every mounted image, and any pinned KAR graph. An unchanged size and
modification time keeps the loaded image. A changed file is checked against
the pin in that config. A match replaces the loaded image. A mount removed
from the config is no longer served, even when its image file is still on
disk. A mismatch returns `IMAGE_INVALID` and does not serve the previous
image. A config file that cannot be read fails that call. `agentId`,
`sessionId`, and `maxHits` stay at the values from process start. KAR graphs
are authorized with that same startup `agentId`.

`@knolo/mcp@0.2.1` is published on npm. This tree sets `server.json` and the
MCP server version to `0.2.1`. The published `0.2.1` tarball still reports
`0.2.0` in those two fields. A mount without a `kar` block exposes
the four tools above. A mount with a `kar` block also exposes
`knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. The
registry name in `server.json` is `io.github.HiveForensics-AI/knolo`.
Published `@knolo/mcp@0.1.0` remains the four-tool server.

The [Google ADK examples](../../docs/integrations/google-adk.md) start this
server over stdio and run one search.
[Python](../../examples/google_adk_python/README.md) and
[TypeScript](../../examples/google_adk_js/README.md) both use MCP. The
[OpenAI Agents SDK example](../../docs/integrations/openai-agents.md) uses the
same server. The
[Pydantic AI example](../../docs/integrations/pydantic-ai.md), the
[Langflow example](../../docs/integrations/langflow.md), and the
[Dify example](../../docs/integrations/dify.md) use the same
server. The
[Vercel AI SDK example](../../docs/integrations/ai-sdk.md) calls the same
service through `@knolo/ai-sdk`. `@knolo/ai-sdk@0.1.0` is published.

The stdio image is built from
[`packages/mcp/Dockerfile`](Dockerfile) in this repository. It is not on
Docker Hub. The container reads `KNOLO_MCP_CONFIG`, does not listen on a
port, and runs as a non-root user. A bad pin exits before the server accepts
a tool call. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and
no hits. Publishing the image and opening the `docker/mcp-registry` pull
request are separate steps. The draft catalog entry is
[`listings/docker/server.yaml`](listings/docker/server.yaml). The integration
note is [Docker](../../docs/integrations/docker.md).

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

The package requires Node 20 or newer, `@knolo/core` `^6.2.1`, and
`@knolo/tools` `^0.2.1`. Coverage, composition, and authoring stay outside
this server. Verification checks integrity. It does not decide that a claim
or an answer is true.
