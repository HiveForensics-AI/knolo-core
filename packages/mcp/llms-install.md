# Install @knolo/mcp for Cline

`@knolo/mcp@0.2.3` is a read-only stdio server for a pinned Knolo V5
Knowledge Image. It does not listen on a port, does not take an API key, and
does not call a model. Cline launches it with `npx`. Node 20 or newer is
required.

## Pin the image

Use an absolute path for the image, the policy file, and the audit directory.
The file hash and the state root are different values.

Hash the image file. The hash is 64 lowercase hex characters:

```sh
node --input-type=module -e '
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const file = process.argv[1];
console.log(createHash("sha256").update(readFileSync(file)).digest("hex"));
' /absolute/image.v5
```

Read the state root with the published CLI `@knolo/cli@6.2.4`:

```sh
npx -y @knolo/cli@6.2.4 verify /absolute/image.v5
```

Copy `stateRoot` from that JSON. It starts with `sha256-`. `verified` must be
true. Stop when verify fails.

## Write the config

Save this as an absolute `knolo-mcp.json`. Replace every path and pin with
the values from the image you verified. `agentId` defaults to `mcp` and must
appear in `agents`. `principal` must be a principal the policy allows.

```json
{
  "agentId": "mcp",
  "auditDir": "/absolute/audit",
  "mounts": [
    {
      "id": "handbook",
      "path": "/absolute/image.v5",
      "sha256": "<64 hex from the file hash>",
      "stateRoot": "sha256-<64 hex from verify>",
      "policyPath": "/absolute/policy.json",
      "agents": ["mcp"],
      "principal": "mcp:reader"
    }
  ]
}
```

The policy file and `auditDir` are required. `auditDir` must be a directory
the server can write. A hash, state-root, or policy mismatch exits before the
server accepts a connection. An unwritable audit directory returns
`AUDIT_UNAVAILABLE` and no hits.

## Register Cline

Add a stdio server in Cline's MCP settings. The command is `npx`.

```json
{
  "mcpServers": {
    "knolo": {
      "command": "npx",
      "args": ["-y", "@knolo/mcp@0.2.3", "--config", "/absolute/knolo-mcp.json"]
    }
  }
}
```

Ask Cline to call `knolo_search`. A mount without a `kar` block exposes
`knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. Cite the
`imageId`, `objectId`, and `stateRoot` from the result.

A receipt is an integrity check. It does not mean a claim is proven.
Verification checks the image bytes, the state root, and the policy root.
`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the
plan were met. It does not mean a claim is proven.

Each kept search term is a whole word. The server does not download images or
write knowledge.

The 400×400 logo for the marketplace listing is
[logo.png](https://raw.githubusercontent.com/HiveForensics-AI/knolo-core/main/packages/mcp/listings/cline/logo.png).
Server details are in the [README](README.md).
