# opencode

MCP server config for [OpenCode](https://opencode.ai). The server runs
over stdio and does not need an API key.

## Configuration

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

Replace `/absolute/knolo-mcp.json` with the path to a Knolo MCP config
pointing at a pinned local Knowledge Image. The config must be an absolute
path. `npx` and Node 20+ must be on the PATH.

## Install

Add the `mcp.servers.knolo` entry to your project `opencode.json`, or use
the CLI:

```bash
opencode mcp add knolo -- npx -y @knolo/mcp@0.2.4 --config /absolute/knolo-mcp.json
```

Set `codemode` to `false` so the Knolo tools stay on the tool list.
OpenCode prefixes tool names with the server name, so the session shows
`knolo_knolo_search`, `knolo_knolo_get`, `knolo_knolo_verify`, and
`knolo_knolo_status`.

## Tools

Without a `kar` block the server exposes `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status`. Adding a `kar` block also exposes
`knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`.

Receipts are integrity checks, not truth claims.

## Related

- [OpenCode integration](../../docs/integrations/opencode.md)
- [`@knolo/mcp` README](../../packages/mcp/README.md) for server config details

---

## License

Apache-2.0
