# google_adk_js

One [Google ADK](https://github.com/google/adk-js) agent reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.0`. The server is stdio only. ADK owns the model. This example does not call one.

`rootAgent` is created only when `KNOLO_MCP_CONFIG` is set. The toolset is `MCPToolset` with `StdioConnectionParams`. A search returns hits and an `openclaw-knolo-query-v1` receipt id.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met.

The directory name uses an underscore. ADK uses that name as the agent name, and a hyphen is rejected. The Python example is [`examples/google_adk_python`](../google_adk_python/README.md).

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built. Node.js 22 or newer:

```bash
npm ci --prefix examples/google_adk_js
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
node --experimental-strip-types examples/google_adk_js/smoke.ts
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.0 --config "$KNOLO_MCP_CONFIG"
```

The smoke lists `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`, then searches for `enterprise refunds`. It expects the refunds excerpt and a receipt id. It does not call a model.

## Run the agent

The same environment is what `npx adk run` reads. The model call is the host's, and this repository does not make it. `@google/adk-devtools` supplies the `adk` command:

```bash
cd examples/google_adk_js
npx adk run agent.ts
```

The integration page is [docs/integrations/google-adk.md](../../docs/integrations/google-adk.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
