# OpenCode

OpenCode can launch the published Knolo MCP server over stdio. The example is [`examples/opencode/opencode.json`](../../examples/opencode/opencode.json). Knolo does not call a model and does not read an API key. The host owns the model.

Put that `mcp.servers.knolo` entry in the project `opencode.json`, or add the server from the project directory:

```sh
opencode mcp add knolo -- npx -y @knolo/mcp@0.2.4 --config /absolute/knolo-mcp.json
```

Replace `/absolute/knolo-mcp.json` with the absolute path of a Knolo MCP config that points at a pinned local Knowledge Image. A missing or invalid config fails closed. `npx` and Node must be on the PATH OpenCode uses. `@knolo/mcp@0.2.4` is the npm release. The server does not listen on a port. There is no remote URL.

`codemode` is `false` so the Knolo tools stay on the tool list. OpenCode names a tool with the server name in front, so the session shows `knolo_knolo_search`, `knolo_knolo_get`, `knolo_knolo_verify`, and `knolo_knolo_status`. Those names call `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`.

```json
{
  "mcp": {
    "servers": {
      "knolo": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "@knolo/mcp@0.2.4",
          "--config",
          "/absolute/knolo-mcp.json"
        ],
        "codemode": false
      }
    }
  }
}
```

A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller, the image, or the policy.

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

Continuous integration starts `npx -y @knolo/mcp@0.2.4 --config` against a pinned fixture, lists the four core tools, and checks that a search returns a receipt. A missing config exits before a tool call. It does not install the OpenCode app.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
