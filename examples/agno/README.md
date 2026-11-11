# agno

One [Agno](https://docs.agno.com/tools/mcp/overview) process reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.3`. The server is stdio only. The host owns the model. This example does not call one, and it does not read an API key.

`MCPTools` starts `knolo-mcp` with `StdioServerParameters`. The command and argument list are passed separately, so a path that contains spaces stays one argument. A search returns hits and an `openclaw-knolo-query-v1` receipt id. The fixture has no pinned graph, so the server exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met. A receipt is an integrity check. It does not mean a claim is proven.

Search keeps each remaining term as a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built. Python 3.11 or newer:

```bash
python -m pip install -r examples/agno/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/agno/smoke.py
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.3 --config "$KNOLO_MCP_CONFIG"
```

The smoke lists the four tools, checks that the graph tools are absent, then searches for `enterprise refunds`. It expects the refunds excerpt, an object id, a `sha256-` state root, and a `qr_` receipt id. It does not construct an agent and it does not call a model. It also points the server at an unwritable audit directory and checks that `knolo_search` returns `AUDIT_UNAVAILABLE`.

Importing the example sets `AGNO_TELEMETRY` to `false` when that variable is unset. This smoke uses `MCPTools` only.

The integration page is [docs/integrations/agno.md](../../docs/integrations/agno.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
