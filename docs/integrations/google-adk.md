# Google ADK

Google ADK can call the published Knolo MCP server as a toolset. The Python example is [`examples/google_adk_python`](../../examples/google_adk_python/README.md). The TypeScript example is [`examples/google_adk_js`](../../examples/google_adk_js/README.md). Both use stdio. The command a host runs is:

```bash
npx -y @knolo/mcp@0.2.0 --config /absolute/knolo-mcp.json
```

`@knolo/mcp@0.2.0` is the npm release. A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

## What a search returns

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. The example agent is instructed to include those receipt ids in its reply. Each offline smoke lists the four tools and runs one search for `enterprise refunds` against a fixture image. Those smokes do not call a model.

## What a pass means

Verification checks the image bytes, the state root, and the policy root. A valid receipt means that check ran for the query. It does not mean a passage is true, safe, or complete.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven. `UNSATISFIED_EVIDENCE_REQUIREMENTS` is a completed evaluation.

The server does not download images, write knowledge, or call a model. A running server reloads on the next tool call when the config file and the image match the pin. A pin mismatch is `IMAGE_INVALID` and returns no hits. Reconnecting the host without replacing the process does not repair a failed pin check.

## Install

Python 3.11 or newer:

```bash
python -m pip install -r examples/google_adk_python/requirements.txt
```

That installs `google-adk[mcp]`.

TypeScript uses Node.js 22 or newer and `@google/adk` 2.4.0:

```bash
npm ci --prefix examples/google_adk_js
```

Build a fixture from this repository, or point `KNOLO_MCP_CONFIG` at an image you already pinned:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
```

Both examples share that fixture script. Continuous integration starts `packages/mcp/bin/knolo-mcp.mjs` with Node so the job does not depend on a registry fetch. Set `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` for that path. The default command is `npx` with `@knolo/mcp@0.2.0`. The TypeScript smoke runs on Node 22. The rest of CI stays on Node 20.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
