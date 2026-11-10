# Mastra

`@knolo/mastra` returns Mastra tools for a pinned Knolo V5 Knowledge Image.
`@knolo/mastra@0.1.0` is not published yet. Knolo does not call a model and
does not read an API key.

The host passes the tools to its own model. The peer dependency is
`@mastra/core` `^1.82.0`. The package asks for Node.js 22.13 or newer. It
depends on `@knolo/core` `^6.2.1` and `@knolo/tools` `^0.2.1`.

`knoloMastraTools(config)` reads the same object as `knolo-mcp.json`. It does
not watch files. After a pin change, the host calls `knoloMastraTools` again.

A host that already has an MCP client can launch the published server
instead. Mastra's client is `MCPClient` from `@mastra/mcp`:

```js
import { MCPClient } from '@mastra/mcp';

const mcp = new MCPClient({
  id: 'knolo',
  servers: {
    knolo: {
      command: 'npx',
      args: ['-y', '@knolo/mcp@0.2.1', '--config', '/absolute/knolo-mcp.json'],
    },
  },
});
```

That command is stdio. This package does not start it and does not open a
port.

## Tools

Without a `kar` block, the tools are `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status`. With a `kar` block, `knolo_kar_evaluate`,
`knolo_kar_verify`, and `knolo_cortex_verify` are added.

Caller identity is `agentId` in the config, default `mcp`. Tool arguments
cannot set it. The Mastra execute context cannot set it either. This adapter
does not add a session id.

`knolo_search` lowercases the query, keeps a quoted phrase as one whole
phrase, and treats unquoted `OR` as any remaining term. Unquoted stopwords and
terms shorter than 3 characters are dropped. Each kept term must appear as a
whole word. `match` is `all`, `any`, `partial`, or `none`. EQL `SEARCH` still
matches every space-separated term as a substring. `knolo_search` writes an
`openclaw-knolo-query-v1` receipt before it returns hits. A receipt is an
integrity check. It does not mean a claim is proven.

`SATISFIED` from `knolo_kar_evaluate` means evidence requirements were met.
It does not mean a claim is proven. Cortex verification checks that the trace
matches the image. It does not mean the answer is true.

A pin mismatch, a policy denial, or an unwritable audit directory fails
closed. The tool throws `CODE: message` and returns no hits.

## Example

The example is [`examples/mastra`](../../examples/mastra/README.md). Build the
package, point `KNOLO_MCP_CONFIG` at an absolute `knolo-mcp.json`, and run
the smoke. The smoke does not call a model and does not construct an agent.

Server configuration is documented in the
[`@knolo/mcp` README](../../packages/mcp/README.md). The package README is
[`@knolo/mastra`](../../packages/mastra/README.md).
