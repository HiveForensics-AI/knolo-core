# Gemini CLI and Antigravity CLI

Gemini CLI and Antigravity CLI can launch the published Knolo MCP server over stdio. Knolo does not call a model and does not read an API key. The host owns the model.

Gemini CLI still serves API-key and Vertex users. Antigravity CLI (`agy`) is the client for individual Google accounts.

The Gemini CLI extension manifest is [`examples/gemini/gemini-extension.json`](../../examples/gemini/gemini-extension.json). The gallery copy is [`gemini-extension.json`](../../gemini-extension.json) at the repository root. The GitHub topic is `gemini-cli-extension`. That manifest starts `npx -y @knolo/mcp@0.2.4` and declares a `KNOLO_MCP_CONFIG` setting. Gemini CLI asks for the absolute path of `knolo-mcp.json` at install time and passes that variable to the server. The manifest does not pass `--config`, because an explicit `--config` argument overrides the setting. Install the examples directory with the current `gemini extensions install` command, or copy the block below into Gemini CLI settings. Antigravity reads the same command from [`examples/antigravity/mcp_config.json`](../../examples/antigravity/mcp_config.json). The global file is `~/.gemini/config/mcp_config.json`. A workspace file is `.agents/mcp_config.json`. The Antigravity App, IDE, and CLI read that shape. In the CLI, `/mcp` opens the MCP manager.

```json
{
  "mcpServers": {
    "knolo": {
      "command": "npx",
      "args": ["-y", "@knolo/mcp@0.2.4", "--config", "/absolute/knolo-mcp.json"]
    }
  }
}
```

Replace `/absolute/knolo-mcp.json` in that block with the absolute path of a Knolo MCP config that points at a pinned local Knowledge Image. A gallery install uses the `KNOLO_MCP_CONFIG` setting instead of this placeholder. An empty value fails closed. A missing or invalid config fails closed. `npx` and Node must be on the PATH the client uses. `@knolo/mcp@0.2.4` is the npm release. The server does not listen on a port. There is no remote URL.

A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller, the image, or the policy.

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

Continuous integration starts `npx -y @knolo/mcp@0.2.4 --config` against a pinned fixture, lists the four core tools, and checks that a search returns a receipt. A missing config exits before a tool call. It does not install Gemini CLI or Antigravity CLI. The Gemini CLI gallery reads the root manifest and the `gemini-cli-extension` topic. Antigravity Marketplace stays a partner interest form.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
