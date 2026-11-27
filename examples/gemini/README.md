# gemini

[Gemini CLI](https://github.com/google-gemini/gemini-cli) extension manifest
for the Knolo MCP server. The server runs over stdio and does not need an
API key.

## Extension manifest

```json
{
  "name": "knolo",
  "version": "0.2.4",
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

Install the extension directory:

```bash
gemini extensions install ./examples/gemini
```

Or copy the `mcpServers.knolo` block into Gemini CLI settings directly.

## Tools

Without a `kar` block the server exposes `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status`. Adding a `kar` block also exposes
`knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`.

Receipts are integrity checks, not truth claims.

## Related

- [Gemini CLI and Antigravity CLI integration](../../docs/integrations/gemini-cli.md)
- [`@knolo/mcp` README](../../packages/mcp/README.md) for server config details
- [`examples/antigravity`](../antigravity) for the Antigravity CLI config

---

## License

Apache-2.0
