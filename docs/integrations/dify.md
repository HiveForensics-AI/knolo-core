# Dify

Dify 1.19.0 can register an MCP server when that server has an `http` or `https` URL. The Python example is [`examples/dify`](../../examples/dify/README.md). Knolo's server speaks stdio. Knolo does not call a model and does not read an API key. A Dify app run belongs to the host.

The [Dify tools documentation](https://docs.dify.ai/en/use-dify/build/mcp) says only MCP servers with HTTP transport are supported. In the Dify 1.19.0 API, `MCPProviderEntity` stores `server_url`, and `MCPToolManageService` accepts a URL whose scheme is `http` or `https`. This repository does not open a port and does not put Knolo behind a proxy.

```bash
npx -y @knolo/mcp@0.2.3 --config /absolute/knolo-mcp.json
```

`@knolo/mcp@0.2.3` is the npm release. A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

`examples/dify/mcp.json` records that stdio command for a host that can launch a process: command `npx`, arguments `-y @knolo/mcp@0.2.3 --config /absolute/knolo-mcp.json`. Dify's built-in screen asks for a URL, a name, and a server identifier. Apps and exported apps refer to the server by that identifier, so another workspace recreates the same identifier. This repository does not register a server and does not commit a Dify app export, because that export cannot store this stdio command and a live run needs a host model.

`npx` needs Node on the host. The config path stays on the argument list. It is not an environment variable. This repository does not ship a container. Third-party plugins that spawn stdio, or that publish this server on a port, are outside this example.

## What a search returns

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. The offline smoke checks the published pin, lists the four tools, and runs one search for `enterprise refunds` against a fixture image. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped. The smoke does not call a model and does not start Dify.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root. A policy denial returns `ACCESS_DENIED`. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits. A hash, state-root, or policy-root mismatch stops the server before it accepts the MCP connection.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model.

## Python

Python 3.10 or newer and the `mcp` package 2.3.0:

```bash
python -m pip install -r examples/dify/requirements.txt
```

Build a fixture from this repository, or point `KNOLO_MCP_CONFIG` at an image you already pinned:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/mcp
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
```

Continuous integration starts `packages/mcp/bin/knolo-mcp.mjs` with Node so the job does not depend on a registry fetch of Knolo. Set `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` for that path. The default command is `npx` with `@knolo/mcp@0.2.3`. The smoke runs on Python 3.12. The Node half of that job stays on Node 20.

The smoke uses `Client` with `StdioServerParameters` from `mcp` 2.3.0. `list_tools` lists the tools, and `call_tool` runs `knolo_search`. The smoke does not import Dify.

This repository does not publish a Dify tool plugin. PyPI `knolo` 5.5.1 has no KAR.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
