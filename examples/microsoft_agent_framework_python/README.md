# microsoft_agent_framework_python

One [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) agent reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.4`. The server is stdio only. The host owns the model. This example does not call one.

The pinned packages are `agent-framework-core==1.26.0`, `mcp==2.3.0`, and `tenacity==9.2.1`. Agent Framework imports `tenacity` when the stdio client connects. `agent-framework-core` 1.26.0 is the Agent Framework distribution that exports `MCPStdioTool` and `Agent`. Release 1.26.0 does not export `ChatAgent`. The umbrella package `agent-framework==1.26.0` depends on `agent-framework-core[all]` and installs every host extra, so this example pins the core distribution instead.

`build_agent` attaches the stdio tool to `Agent`. The smoke does not construct a chat client. It calls `knolo_search` and `knolo_verify` on the tool object.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met.

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built:

```bash
python -m pip install -r examples/microsoft_agent_framework_python/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/microsoft_agent_framework_python/smoke.py
```

The fixture script is shared with the Google ADK example. It writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.4 --config "$KNOLO_MCP_CONFIG"
```

The smoke lists `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`, then searches for `enterprise refunds`. It expects the refunds excerpt, an object id, and a receipt file in `auditDir`. It then runs `knolo_verify`. It also points the server at an unwritable audit directory and checks that `knolo_search` returns `AUDIT_UNAVAILABLE`. A config whose image SHA-256 does not match the file makes `knolo-mcp` exit with `IMAGE_INVALID` before it prints `serving stdio`.

## Run the agent

Pass the host's chat client to `build_agent`. This repository does not call a model.

From `examples/microsoft_agent_framework_python`, with `KNOLO_MCP_CONFIG` set:

```python
from agent import build_agent, knolo_tool

async with knolo_tool() as tool:
    agent = build_agent(client, tool)
```

The integration page is [docs/integrations/microsoft-agent-framework.md](../../docs/integrations/microsoft-agent-framework.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
