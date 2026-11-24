# Zed

Zed can launch the published Knolo MCP server over stdio. Knolo does not call a model and does not read an API key. The host owns the model.

Put the `context_servers.knolo` block from [`examples/zed/settings.json`](../../examples/zed/settings.json) in Zed settings. The `args` array is required. The server does not listen on a port. There is no remote URL.

```json
{
  "context_servers": {
    "knolo": {
      "command": "npx",
      "args": ["-y", "@knolo/mcp@0.2.4", "--config", "/absolute/knolo-mcp.json"]
    }
  }
}
```

Replace `/absolute/knolo-mcp.json` with the absolute path of a Knolo MCP config that points at a pinned local Knowledge Image. A missing or invalid config fails closed. `npx` and Node must be on the PATH Zed uses. `@knolo/mcp@0.2.4` is the npm release.

The extension in [`packages/zed-extension`](../../packages/zed-extension) returns that same pinned command. Its settings schema requires `config_path`. A missing or empty `config_path` fails closed. The extension does not install a newer npm release. Zed is moving context-server extensions toward the official MCP Registry. Knolo is already listed there as `io.github.HiveForensics-AI/knolo` at 0.2.4. Publishing the extension upstream is a separate human step.

A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller, the image, or the policy.

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

Continuous integration starts `npx -y @knolo/mcp@0.2.4 --config` against a pinned fixture, lists the four core tools, and checks that a search returns a receipt. A missing config exits before a tool call. A separate job builds the extension for `wasm32-wasip2`. Neither job installs Zed. A catalog or extension-repository submission is a separate human step.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
