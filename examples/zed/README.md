# zed

MCP server config for the [Zed](https://zed.dev) editor. The server runs
over stdio and does not need an API key.

## Configuration

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

Replace `/absolute/knolo-mcp.json` with the path to a Knolo MCP config
pointing at a pinned local Knowledge Image. The config must be an absolute
path. `npx` and Node 20+ must be on the PATH.

## Install

Add the `context_servers.knolo` block from `settings.json` into your Zed
settings. The `args` array is required.

The extension in [`packages/zed-extension`](../../packages/zed-extension)
returns the same pinned command. Its settings schema requires `config_path`.
Knolo is also listed in the MCP Registry as
`io.github.HiveForensics-AI/knolo` at version 0.2.4.

## Tools

Without a `kar` block the server exposes `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status`. Adding a `kar` block also exposes
`knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`.

Receipts are integrity checks, not truth claims.

## Related

- [Zed integration](../../docs/integrations/zed.md)
- [`@knolo/mcp` README](../../packages/mcp/README.md) for server config details
- [`packages/zed-extension`](../../packages/zed-extension) for the Zed extension

---

## License

Apache-2.0
