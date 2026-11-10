# smolagents

One [smolagents](https://huggingface.co/docs/smolagents) process reads a pinned Knolo V5 Knowledge Image through `@knolo/mcp@0.2.1`. The server is stdio only. The host owns the model. This example does not call one, and it does not read an API key.

`ToolCollection.from_mcp` starts `knolo-mcp` with `StdioServerParameters`. The command and argument list are passed separately, so a path that contains spaces stays one argument. The library requires `trust_remote_code=True` before it will load tool code, including a server that this machine starts over local stdio. That flag is the library's gate for trusting the tool code. A `CodeAgent` still belongs in a sandbox. This smoke calls `knolo_search` directly and does not construct a code agent. `structured_output` is false so the tool returns the receipt text. A search returns hits and an `openclaw-knolo-query-v1` receipt id. The fixture has no pinned graph, so the server exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

Verification checks the image pin and policy. It does not decide that a claim is true. `SATISFIED`, on the KAR tools, means evidence requirements were met. A receipt is an integrity check. It does not mean a claim is proven.

Search keeps each remaining term as a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

## Run the offline smoke

From the repository root, with `@knolo/core` and `@knolo/mcp` already built. Python 3.11 or newer:

```bash
python -m pip install -r examples/smolagents/requirements.txt
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
export KNOLO_MCP_COMMAND=node
export KNOLO_MCP_ARGS="[\"$(pwd)/packages/mcp/bin/knolo-mcp.mjs\"]"
python examples/smolagents/smoke.py
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and `knolo-mcp.json` under a temporary directory. Omit `KNOLO_MCP_COMMAND` and `KNOLO_MCP_ARGS` to start the published server instead:

```bash
npx -y @knolo/mcp@0.2.1 --config "$KNOLO_MCP_CONFIG"
```

The requirements pin `smolagents[mcp]==1.26.0` and `mcp[ws]==1.26.0`. The smoke lists the four tools, checks that the graph tools are absent, then searches for `enterprise refunds`. It expects the refunds excerpt, an object id, a `sha256-` state root, and a `qr_` receipt id. It does not call a model. It also points the server at an unwritable audit directory and checks that `knolo_search` returns `AUDIT_UNAVAILABLE`.

The integration page is [docs/integrations/smolagents.md](../../docs/integrations/smolagents.md). Server config is in the [`@knolo/mcp` README](../../packages/mcp/README.md).

---

## License

Apache-2.0
