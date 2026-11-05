# google_adk_python

One [Google ADK](https://github.com/google/adk-python) agent reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.0`. The server is stdio only. ADK owns the model. This example does not call one.

`root_agent` is created only when `KNOLO_MCP_CONFIG` is set. The toolset is `McpToolset` with `StdioConnectionParams`. A search returns hits and an `openclaw-knolo-query-v1` receipt id.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met.

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built:

```bash
python -m pip install -r examples/google_adk_python/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/google_adk_python/smoke.py
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.0 --config "$KNOLO_MCP_CONFIG"
```

The smoke lists `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`, then searches for `enterprise refunds`. It expects the refunds excerpt and a receipt id.

## Run the agent

The same environment is what `adk run` reads. ADK uses the directory name as the agent name, and that name must be letters, digits, and underscores. The model call is the host's, and this repository does not make it.

```bash
adk run examples/google_adk_python
```

The TypeScript example is [examples/google_adk_js](../google_adk_js/README.md). The integration page is [docs/integrations/google-adk.md](../../docs/integrations/google-adk.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
