# Langflow

Langflow can call the published Knolo MCP server over stdio. The Python example is [`examples/langflow`](../../examples/langflow/README.md). Knolo does not call a model and does not read an API key. An Agent run belongs to the host.

Tested with Langflow 1.13.1 and `lfx` 1.13.1.

```bash
npx -y @knolo/mcp@0.2.1 --config /absolute/knolo-mcp.json
```

`@knolo/mcp@0.2.1` is the npm release. A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

`examples/langflow/flow.json` is a Langflow 1.13.1 flow. Chat Input connects to the Agent, the Agent response connects to Chat Output, and MCP Tools in tool mode connects its toolset to the Agent tools port. The MCP server value is STDIO, command `npx`, arguments `-y @knolo/mcp@0.2.1 --config /absolute/knolo-mcp.json`. The Tool field is blank, so every tool is listed. Use Cached Server is off. The Agent model and API key are empty.

Import that file in Langflow 1.13.1 and replace `/absolute/knolo-mcp.json` with the absolute config path. The same command can be registered under Settings, then MCP Servers, in STDIO mode. `npx` needs Node on the host. A container needs Node in the image. This repository does not ship a container or a custom Langflow component.

If `mcp_server_allowed_packages` is set, include `@knolo/mcp`. The default leaves that list unset. Langflow rejects `node` when the first argument is an option. A checkout uses command `node` and puts `packages/mcp/bin/knolo-mcp.mjs` first in the argument list, then `--config` and the absolute config path.

## What a search returns

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. The offline smoke loads the flow, lists the four tools, and runs one search for `enterprise refunds` against a fixture image. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped. The smoke does not call a model and does not run the Agent.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root. A policy denial returns `ACCESS_DENIED`. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits. A hash, state-root, or policy-root mismatch stops the server before it accepts the MCP connection.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model.

## Python

Python 3.11 or newer and `lfx` 1.13.1:

```bash
python -m pip install -r examples/langflow/requirements.txt
```

Build a fixture from this repository, or point `KNOLO_MCP_CONFIG` at an image you already pinned:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
```

Continuous integration starts `packages/mcp/bin/knolo-mcp.mjs` with Node so the job does not depend on a registry fetch of Knolo. Set `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` for that path. The default command is `npx` with `@knolo/mcp@0.2.1`. The smoke runs on Python 3.12. The Node half of that job stays on Node 20.

`Graph.from_payload` checks that the flow loads. `MCPToolsComponent.update_tool_list` lists the tools, and the stdio client runs `knolo_search`. The smoke does not run the Agent.

This repository does not publish a Langflow custom component. Langflow talks to the MCP server directly. PyPI `knolo` 5.5.1 has no KAR.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
