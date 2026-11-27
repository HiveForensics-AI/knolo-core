# openhands

MCP server config for [OpenHands](https://docs.all-hands.dev) and Agent
Canvas. The server runs over stdio and does not need an API key.

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

**OpenHands SDK:** Pass the `mcpServers` object as `mcp_config` when
creating the agent.

**Agent Canvas:** Go to Customize > MCP Servers, add a custom server with
type `STDIO`, name `knolo`, command `npx`, and arguments one per line:

```
-y
@knolo/mcp@0.2.4
--config
/absolute/knolo-mcp.json
```

OpenHands runs the command inside its sandbox. The config path and the
pinned image must be readable from inside the sandbox.

## Tools

Without a `kar` block the server exposes `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status`. Adding a `kar` block also exposes
`knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`.

Receipts are integrity checks, not truth claims.

## Related

- [OpenHands integration](../../docs/integrations/openhands.md)
- [`@knolo/mcp` README](../../packages/mcp/README.md) for server config details

---

## License

Apache-2.0
