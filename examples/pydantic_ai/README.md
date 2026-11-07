# pydantic_ai

One [Pydantic AI](https://pydantic.dev/docs/ai/mcp/client/) process reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.0`. The server is stdio only. The host owns the model. This example does not call one, and it does not read an API key.

`MCPToolset` starts `knolo-mcp` with FastMCP `StdioTransport`. A search returns hits and an `openclaw-knolo-query-v1` receipt id. The fixture has no pinned graph, so the server exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met. A receipt is an integrity check. It does not mean a claim is proven.

Search matches every space-separated term as a substring.

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built. Python 3.11 or newer:

```bash
python -m pip install -r examples/pydantic_ai/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/pydantic_ai/smoke.py
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.0 --config "$KNOLO_MCP_CONFIG"
```

The smoke lists the four tools, checks that the graph tools are absent, then searches for `enterprise refunds`. It expects the refunds excerpt, an object id, a `sha256-` state root, and a `qr_` receipt id. It does not construct an `Agent` and it does not call a model.

A host that does call a model passes the same toolset on `toolsets`. That call stays outside this repository.

The integration page is [docs/integrations/pydantic-ai.md](../../docs/integrations/pydantic-ai.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
