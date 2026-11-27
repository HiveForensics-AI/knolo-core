# openai_agents_python

One [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) process reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.4`. The server is stdio only. The SDK owns the model. This example does not call one, and it does not read an API key.

`MCPServerStdio` starts `knolo-mcp`. A search returns hits and an `openclaw-knolo-query-v1` receipt id. The fixture has no pinned graph, so the server exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met. A receipt is an integrity check. It does not mean a claim is proven.

Search keeps each remaining term as a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

## Run the offline smoke

From the repository root. Python 3.12. Install the workspace and build the two packages the fixture and local server use. The same npm commands work in PowerShell:

```bash
npm ci
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
python -m pip install -r examples/openai_agents_python/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/openai_agents_python/smoke.py
```

On Windows PowerShell, `python` may be the Microsoft Store stub. Use `py -3.12` and set the same variables:

```powershell
py -3.12 -m pip install -r examples/openai_agents_python/requirements.txt
$config = (node examples/google_adk_python/prepare-fixture.mjs).Trim()
$env:KNOLO_MCP_CONFIG = $config
$env:KNOLO_MCP_COMMAND = "node"
$mcp = (Resolve-Path "packages\mcp\bin\knolo-mcp.mjs").Path
$env:KNOLO_MCP_ARGS = ConvertTo-Json -Compress -InputObject @($mcp)
py -3.12 examples/openai_agents_python/smoke.py
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.4 --config "$KNOLO_MCP_CONFIG"
```

The local commands above start `node` with `packages/mcp/bin/knolo-mcp.mjs`. That path does not fetch the package from the registry. Omitting `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` starts the published `@knolo/mcp@0.2.4` package with `npx`.

The smoke expects the four tool names, then searches for `enterprise refunds`. It expects the refunds excerpt, an object id, a `sha256-` state root, and a `qr_` receipt id. It does not call `Runner.run` and it does not construct an `Agent`. It also points the server at an unwritable audit directory and checks that `knolo_search` returns `AUDIT_UNAVAILABLE`.

A host that does call a model passes the same server on `mcp_servers`. That call stays outside this repository.

Native tools that do not start a subprocess are `@knolo/openai-agents`. `@knolo/openai-agents@0.1.1` is on npm. `@knolo/openai-agents@0.1.0` does not include the KITE host tools. This example stays on the MCP server.

The integration page is [docs/integrations/openai-agents.md](../../docs/integrations/openai-agents.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
