# dify

One stdio command reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.1`. The server is stdio only. The host owns the model. This example does not call one, and it does not read an API key.

Dify 1.19.0's built-in MCP client accepts an `http` or `https` server URL. The [Dify tools documentation](https://docs.dify.ai/en/use-dify/build/mcp) says only MCP servers with HTTP transport are supported. `mcp.json` is the stdio command a host launches. It is not a Dify server registration, and this example does not open a port, add a proxy, or install Dify.

The smoke checks that published pin, then starts the server with the MCP Python SDK `Client` and runs one search. It does not start Dify and it does not call a model.

The fixture has no pinned graph, so the server exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met. A receipt is an integrity check. It does not mean a claim is proven. A policy denial returns `ACCESS_DENIED`. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

Search keeps each remaining term as a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

## What Dify can register

In Dify 1.19.0, Integrations, then Tools, then MCP, asks for a server URL, a name, and a server identifier. Apps and exported apps refer to that server by its identifier. A second workspace needs the same identifier on a server registered there. Knolo does not publish an HTTP endpoint, so this repository does not register `knolo` and does not commit a Dify app export. A live Dify app run needs a model the host configures.

`npx` needs Node on the host. The config path stays on the argument list. It is not an environment variable. This example does not add a container. Third-party plugins that spawn a process, or that publish the stdio server on a port, are outside this example.

The integration page is [docs/integrations/dify.md](../../docs/integrations/dify.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built. Python 3.10 or newer:

```bash
python -m pip install -r examples/dify/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/dify/smoke.py
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.1 --config "$KNOLO_MCP_CONFIG"
```

The smoke checks the published pin in `mcp.json`, lists the four tools, checks that the graph tools are absent, then searches for `enterprise refunds`. It expects the refunds excerpt, an object id, a `sha256-` state root, and a `qr_` receipt id. It does not construct a Dify app and it does not call a model.

A host that does call a model uses the same stdio command from its own MCP client. That call stays outside this repository.

---

## License

Apache-2.0
