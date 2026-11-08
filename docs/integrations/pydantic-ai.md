# Pydantic AI

Pydantic AI can call the published Knolo MCP server over stdio. The Python example is [`examples/pydantic_ai`](../../examples/pydantic_ai/README.md). Knolo does not call a model and does not read an API key. An `Agent` run belongs to the host.

```bash
npx -y @knolo/mcp@0.2.0 --config /absolute/knolo-mcp.json
```

`@knolo/mcp@0.2.0` is the npm release. A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

## What a search returns

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. The offline smoke lists the four tools and runs one search for `enterprise refunds` against a fixture image. Every space-separated term is matched as a substring. The smoke does not call a model.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model.

## Python

Python 3.11 or newer, `pydantic-ai-slim[mcp]` 2.66.0, and `fastmcp-slim[client]` 4.1.6:

```bash
python -m pip install -r examples/pydantic_ai/requirements.txt
```

Build a fixture from this repository, or point `KNOLO_MCP_CONFIG` at an image you already pinned:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
```

Continuous integration starts `packages/mcp/bin/knolo-mcp.mjs` with Node so the job does not depend on a registry fetch of Knolo. Set `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` for that path. The default command is `npx` with `@knolo/mcp@0.2.0`. The smoke runs on Python 3.12. The Node half of that job stays on Node 20.

`MCPToolset` wraps FastMCP `StdioTransport`. The smoke calls `list_tools` and `direct_call_tool`. It does not construct an `Agent`.

This repository does not publish a `knolo-pydantic-ai` package. Pydantic AI talks to the MCP server directly. PyPI `knolo` 5.5.1 has no KAR.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
