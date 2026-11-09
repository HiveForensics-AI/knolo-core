# openai_agents_js

One [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) process reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.1`. The server is stdio only. The SDK owns the model. This example does not call one, and it does not read an API key.

`MCPServerStdio` starts `knolo-mcp`. A search returns hits and an `openclaw-knolo-query-v1` receipt id. The fixture has no pinned graph, so the server exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met. A receipt is an integrity check. It does not mean a claim is proven.

Search keeps each remaining term as a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built. Node.js 22 or newer:

```bash
npm ci --prefix examples/openai_agents_js
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
node --experimental-strip-types examples/openai_agents_js/smoke.ts
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.1 --config "$KNOLO_MCP_CONFIG"
```

The smoke lists the four tools, checks that the graph tools are absent, then searches for `enterprise refunds`. It expects the refunds excerpt and a `qr_` receipt id. It does not call `run()` and it does not construct an `Agent`.

A host that does call a model passes the same server on `mcpServers`. That call stays outside this repository.

The integration page is [docs/integrations/openai-agents.md](../../docs/integrations/openai-agents.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
