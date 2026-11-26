# mcp-stdio-client

Zero-dependency Node.js smoke client that speaks JSON-RPC over stdio to
`@knolo/mcp` (`knolo-mcp`). The host owns the model; this smoke does not call an
LLM and does not require an API key.

It verifies the full local MCP loop against a pinned Knowledge Image fixture:

1. `initialize` + `notifications/initialized`
2. `tools/list` (`knolo_get`, `knolo_search`, `knolo_status`, `knolo_verify`)
3. `tools/call` on `knolo_status`
4. `tools/call` on `knolo_search` for `enterprise refunds`, asserting the
   refunds excerpt and a `qr_` receipt id

## Run the smoke

From the repository root (Node.js 22.13+):

```bash
npm install
npm run build --workspace @knolo/core
npm run build --workspace @knolo/tools
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
node examples/mcp-stdio-client/smoke.mjs
```

`prepare-fixture.mjs` writes a temporary two-chunk `.v5` Knowledge Image,
deny-default policy, and `knolo-mcp.json`. The smoke spawns
`packages/mcp/bin/knolo-mcp.mjs` over stdio and prints a JSON summary with
`modelCalled: false`.

See [packages/mcp/README.md](../../packages/mcp/README.md) for full server options and host setup guides.
