# Docker

`packages/mcp/Dockerfile` builds `@knolo/mcp` from this repository. The image
speaks stdio only. It does not listen on a port, and it does not download a
Knowledge Image. The process runs as a non-root user.

The image is not on Docker Hub. A pull request to `docker/mcp-registry` is a
separate manual step. That pull request is what publishes the catalog entry.
This repository keeps a draft at
[`packages/mcp/listings/docker/server.yaml`](../../packages/mcp/listings/docker/server.yaml).

## Build

From the repository root:

```bash
docker build -f packages/mcp/Dockerfile -t knolo-mcp:local .
```

The build uses the server in this tree, including the `0.2.3` handshake.
It does not install the published npm tarball.

## Run

Mount the config and the Knowledge Image read-only. Mount the audit directory
writable. `KNOLO_MCP_CONFIG` is the absolute path of the config inside the
container. The paths in that file are container paths.

```bash
docker run -i --rm \
  -e KNOLO_MCP_CONFIG=/config/knolo-mcp.json \
  -v /absolute/config:/config:ro \
  -v /absolute/images:/images:ro \
  -v /absolute/audit:/audit \
  knolo-mcp:local
```

```json
{
  "agentId": "mcp",
  "auditDir": "/audit",
  "mounts": [
    {
      "id": "handbook",
      "path": "/images/handbook.knolo",
      "sha256": "<64 hex>",
      "stateRoot": "sha256-<64 hex>",
      "policyPath": "/images/handbook.policy.json",
      "agents": ["mcp"],
      "principal": "mcp:reader"
    }
  ]
}
```

A bad hash, state root, or policy root exits non-zero before the server
accepts a tool call. An unwritable audit directory returns `AUDIT_UNAVAILABLE`
and no hits. A search that can write the audit directory returns a `qr_`
receipt. A receipt is an integrity check. It does not mean a claim is proven.

`knolo_search` keeps each remaining term as a whole word. EQL `SEARCH` is a
different matcher: every space-separated term is a substring.

The server configuration is in the
[`@knolo/mcp` README](../../packages/mcp/README.md).
