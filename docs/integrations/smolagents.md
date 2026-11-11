# smolagents

smolagents can call the published Knolo MCP server over stdio. The Python example is [`examples/smolagents`](../../examples/smolagents/README.md). Knolo does not call a model and does not read an API key. An agent run belongs to the host.

```bash
npx -y @knolo/mcp@0.2.3 --config /absolute/knolo-mcp.json
```

`@knolo/mcp@0.2.3` is the npm release. A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

## What a search returns

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. The offline smoke lists the four tools and runs one search for `enterprise refunds` against a fixture image. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped. The smoke does not call a model. It also points the server at an unwritable audit directory and checks that `knolo_search` returns `AUDIT_UNAVAILABLE`.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model.

## Python

Python 3.11 or newer, `smolagents[mcp]` 1.26.0, and `mcp[ws]` 1.26.0:

```bash
python -m pip install -r examples/smolagents/requirements.txt
```

`ToolCollection.from_mcp` requires `trust_remote_code=True` before it loads tool code. That flag is the library's gate. It is still required when the server is a local stdio process that this machine starts. The smoke sets it and calls `knolo_search` directly. A `CodeAgent` that runs generated code still belongs in a sandbox. This repository does not start one.

Build a fixture from this repository, or point `KNOLO_MCP_CONFIG` at an image you already pinned:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
```

Continuous integration starts `packages/mcp/bin/knolo-mcp.mjs` with Node so the job does not depend on a registry fetch of Knolo. Set `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` for that path. The default command is `npx` with `@knolo/mcp@0.2.3`. The smoke runs on Python 3.12. The Node half of that job stays on Node 20.

`structured_output` is false so the tool returns the receipt text. The smoke does not construct a model agent.

This repository does not publish a smolagents package. smolagents talks to the MCP server directly. PyPI `knolo` 5.5.1 has no KAR.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
