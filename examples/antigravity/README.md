# antigravity

MCP config for [Antigravity CLI](https://docs.antigravity.dev), the
Antigravity App, and the Antigravity IDE. All three read the same
`mcpServers` shape. The Knolo MCP server runs over stdio and does not
need an API key.

## Configuration

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

Replace `/absolute/knolo-mcp.json` with the path to a Knolo MCP config
pointing at a pinned local Knowledge Image. The config must be an absolute
path. `npx` and Node 20+ must be on the PATH.

## Install

Copy the `mcpServers.knolo` block into the Antigravity global config at
`~/.gemini/config/mcp_config.json`, or place `mcp_config.json` in
`.agents/` at the workspace root. In the CLI, `/mcp` opens the MCP manager.

## Tools

Without a `kar` block the server exposes `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status`. Adding a `kar` block also exposes
`knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`.

Receipts are integrity checks, not truth claims.

## Related

- [Gemini CLI and Antigravity CLI integration](../../docs/integrations/gemini-cli.md)
- [`@knolo/mcp` README](../../packages/mcp/README.md) for server config details
- [`examples/gemini`](../gemini) for the Gemini CLI extension manifest

---

## License

Apache-2.0
