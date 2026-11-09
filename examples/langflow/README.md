# langflow

One [Langflow](https://docs.langflow.org/mcp-client) flow reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.0`. The server is stdio only. The host owns the model. This example does not call one, and it does not read an API key.

Tested with Langflow 1.13.1 and `lfx` 1.13.1. The smoke loads `flow.json` through `Graph.from_payload`, then asks the MCP Tools component for its tools and runs one search. It does not run the Agent and it does not open the playground.

`flow.json` wires Chat Input to the Agent, the Agent response to Chat Output, and the MCP Tools toolset to the Agent tools port. The MCP server value is stdio: command `npx`, arguments `-y @knolo/mcp@0.2.0 --config /absolute/knolo-mcp.json`. The Tool field stays blank, so the component lists every tool. Use Cached Server stays off. The Agent model and API key stay empty.

The fixture has no pinned graph, so the server exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met. A receipt is an integrity check. It does not mean a claim is proven. A policy denial returns `ACCESS_DENIED`. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

Search keeps each remaining term as a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

This repository does not include playground screenshots. A playground run needs a model the host configures on the Agent.

## Import the flow

Langflow 1.13.1:

1. Build or reuse a `knolo-mcp.json` whose image, policy, and audit paths are absolute. The fixture command is in the next section.
2. Import `examples/langflow/flow.json`.
3. Open MCP Tools. Replace `/absolute/knolo-mcp.json` with that config path. Leave Tool blank and leave Use Cached Server off.
4. You can register the same process under Settings, then MCP Servers, in STDIO mode, and select that server on the component. Name `knolo`, command `npx`, arguments `-y`, `@knolo/mcp@0.2.0`, `--config`, and the absolute config path.
5. Leave the Agent model and API key empty until the host chooses a model. This repository does not run that step.

`npx` needs Node on the host. A Langflow container needs Node inside the image. This example does not add a container. If `mcp_server_allowed_packages` is set, include `@knolo/mcp`. The default leaves that list unset. Langflow rejects `node` when the first argument is an option, so a local server uses command `node` and the script path as the first argument. The config path stays on the argument list. It is not an environment variable.

The integration page is [docs/integrations/langflow.md](../../docs/integrations/langflow.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built. Python 3.11 or newer:

```bash
python -m pip install -r examples/langflow/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/langflow/smoke.py
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.0 --config "$KNOLO_MCP_CONFIG"
```

The smoke checks the published pin in `flow.json`, loads the four components, lists the four tools, checks that the graph tools are absent, then searches for `enterprise refunds`. It expects the refunds excerpt, an object id, a `sha256-` state root, and a `qr_` receipt id. It does not construct a Langflow model and it does not call one.

A host that does call a model fills the Agent language model in Langflow. That call stays outside this repository.

---

## License

Apache-2.0
