# OpenHands

OpenHands can launch the published Knolo MCP server over stdio. The example is [`examples/openhands/mcp_config.json`](../../examples/openhands/mcp_config.json). Knolo does not call a model and does not read an API key. The host owns the model.

Agent Canvas stores the server from Customize > MCP Servers. Add a custom server with server type `STDIO`, name `knolo`, and command `npx`. The command arguments are one per line:

```
-y
@knolo/mcp@0.2.4
--config
/absolute/knolo-mcp.json
```

The SDK passes the same command in `mcp_config`. Pass that object as `mcp_config` when the agent is created.

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

Replace `/absolute/knolo-mcp.json` with the absolute path of a Knolo MCP config that points at a pinned local Knowledge Image. OpenHands starts the command inside its sandbox. That config path and the pinned image must be readable inside the sandbox. A missing or invalid config fails closed. `npx` and Node must be on the PATH the sandbox uses. `@knolo/mcp@0.2.4` is the npm release. The server does not listen on a port. There is no remote URL.

A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller, the image, or the policy.

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

Continuous integration starts `npx -y @knolo/mcp@0.2.4 --config` against a pinned fixture, lists the four core tools, and checks that a search returns a receipt. A missing config exits before a tool call. It does not install the OpenHands app. An OpenHands Marketplace submission is a separate human step.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
