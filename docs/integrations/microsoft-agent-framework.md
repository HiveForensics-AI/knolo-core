# Microsoft Agent Framework

Microsoft Agent Framework can call the published Knolo MCP server over stdio. The Python example is [`examples/microsoft_agent_framework_python`](../../examples/microsoft_agent_framework_python/README.md). The command a host runs is:

```bash
npx -y @knolo/mcp@0.2.4 --config /absolute/knolo-mcp.json
```

`@knolo/mcp@0.2.4` is the npm release. A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

Agent Framework 1.26.0 exposes `MCPStdioTool` and `Agent` from `agent-framework-core`. That release does not export `ChatAgent`. The example pins `agent-framework-core==1.26.0`, `mcp==2.3.0`, and `tenacity==9.2.1`. Agent Framework imports `tenacity` when the stdio client connects.

```python
from agent_framework import Agent, MCPStdioTool

tool = MCPStdioTool(
    name="knolo",
    command="npx",
    args=[
        "-y",
        "@knolo/mcp@0.2.4",
        "--config",
        "/absolute/knolo-mcp.json",
    ],
    load_prompts=False,
)

async with tool:
    agent = Agent(
        client=client,
        name="knolo_reader",
        instructions=(
            "Answer from knolo_search only. Include each receipt id and "
            "object id. A receipt checks integrity. It does not mean a "
            "claim is proven."
        ),
        tools=tool,
    )
```

`client` is the host's chat client. Knolo does not choose it and does not call it.

## What a search returns

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit includes an `objectId`. The offline smoke lists the four tools, searches for `enterprise refunds` against a fixture image, and checks that the receipt file is in `auditDir`. It then runs `knolo_verify` and expects `valid: true`. The smoke does not call a model. It also points the server at an unwritable audit directory and checks that `knolo_search` returns `AUDIT_UNAVAILABLE`.

## What a pass means

Verification checks the image bytes, the state root, and the policy root. A valid receipt means that check ran for the query. It does not mean a passage is true, safe, or complete.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model. A pin mismatch makes `knolo-mcp` exit with `IMAGE_INVALID` before it prints `serving stdio` and before it serves tools. The smoke checks that exit.

## Install

Python 3.11 or newer:

```bash
python -m pip install -r examples/microsoft_agent_framework_python/requirements.txt
```

Build a fixture from this repository, or point `KNOLO_MCP_CONFIG` at an image you already pinned:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
```

Continuous integration starts `packages/mcp/bin/knolo-mcp.mjs` with Node so the job does not depend on a registry fetch. Set `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` for that path. The default command is `npx` with `@knolo/mcp@0.2.4`.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
