# Glama catalog demo

This directory is a pinned V5 Knowledge Image for the Glama startup check.
It is not a default for `knolo-mcp`. A start with no `--config` and no
`KNOLO_MCP_CONFIG` still fails closed.

`demo.v5` is built from `docs/` by `prepare.mjs`. `pins.json` records the
SHA-256 and state root. `start.mjs` writes an absolute config under
`/tmp/knolo-audit` and starts the stdio server. The server does not listen
on a port.

Glama's check currently runs `node packages/mcp/bin/knolo-mcp.mjs` and exits
before it can list tools. In the Dockerfile admin page, keep the build steps
and replace the start command with:

```json
["node", "examples/glama/start.mjs"]
```

The build steps stay:

```json
[
  "npm ci",
  "npm run build --workspace @knolo/core",
  "npm run build --workspace @knolo/mcp"
]
```

Rebuild the image after changing `docs/`:

```bash
npm run build --workspace @knolo/core
node examples/glama/prepare.mjs
```

Commit `demo.v5`, `policy.json`, and `pins.json` with the docs.
