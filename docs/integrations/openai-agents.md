# OpenAI Agents SDK

The OpenAI Agents SDK can call the published Knolo MCP server over stdio. The TypeScript example is [`examples/openai_agents_js`](../../examples/openai_agents_js/README.md). Knolo does not call a model and does not read an API key. `run()` belongs to the host.

```bash
npx -y @knolo/mcp@0.2.1 --config /absolute/knolo-mcp.json
```

`@knolo/mcp@0.2.1` is the npm release. A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

## What a search returns

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. The offline smoke lists the four tools and runs one search for `enterprise refunds` against a fixture image. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped. The smoke does not call a model.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model.

## TypeScript

Node.js 22 or newer, `@openai/agents` 0.21.0, and `zod` 4.6.7:

```bash
npm ci --prefix examples/openai_agents_js
```

Build a fixture from this repository, or point `KNOLO_MCP_CONFIG` at an image you already pinned:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
```

Continuous integration starts `packages/mcp/bin/knolo-mcp.mjs` with Node so the job does not depend on a registry fetch of Knolo. Set `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` for that path. The default command is `npx` with `@knolo/mcp@0.2.1`. The smoke runs on Node 22 because it uses `node --experimental-strip-types`. The rest of CI stays on Node 20.

This repository does not publish an `@knolo/openai-agents` package. The SDK talks to the MCP server directly.

## Python

`openai-agents-python` can start the same published server. This repository does not ship a Python example or a Python smoke for that SDK. PyPI `knolo` 5.5.1 has no KAR.

```python
from agents.mcp import MCPServerStdio

server = MCPServerStdio(
    name="Knolo",
    params={
        "command": "npx",
        "args": ["-y", "@knolo/mcp@0.2.1", "--config", "/absolute/knolo-mcp.json"],
    },
    client_session_timeout_seconds=60,
)
```

The host lists the tools from that server. A model call, if any, stays in the host.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
