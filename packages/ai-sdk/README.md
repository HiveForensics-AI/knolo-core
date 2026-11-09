# @knolo/ai-sdk

`@knolo/ai-sdk` builds Vercel AI SDK tools for read-only Knolo search, verify,
KAR, and Cortex. Version 0.1.0 is in this repository and is not on npm yet.
The license is Apache-2.0.

The peer dependency is `ai` `^7.0.0`. Engines ask for Node.js 22 or newer,
matching that package. Knolo does not run these tools on the edge runtime,
and Knolo does not call a model. The host owns the model and passes the tools
to it.

```js
import { knoloTools } from '@knolo/ai-sdk';

const tools = await knoloTools(config);
```

`knoloTools` accepts the same object as `knolo-mcp.json`. Paths are absolute.
A bad image pin, graph pin, or policy root throws before any tool is
returned. `loadKnoloAiSdkConfigFile(path)` reads an absolute config file. A
relative path throws `QUERY_INVALID: Knolo config path must be absolute.`
Invalid JSON throws `IMAGE_INVALID: Knolo config is not valid JSON.`

This function does not watch files. After a pin change, call `knoloTools`
again. A server started from `@knolo/mcp` with a config path is the one that
reloads changed files.

## Tools

Without a `kar` block the tools are `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status`. A mount with a `kar` block also adds
`knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`.

Caller identity is `agentId` in the config, default `mcp`. Tool arguments
cannot set it. This adapter does not add a session id.

`knolo_search` lowercases the query, keeps a quoted phrase as one whole
phrase, and treats unquoted `OR` as any remaining term. Unquoted stopwords and
terms shorter than 3 characters are dropped. Each kept term must appear as a
whole word. `match` is `all`, `any`, `partial`, or `none`. EQL `SEARCH` is a
different matcher: every space-separated term is a substring. `knolo_search`
writes an `openclaw-knolo-query-v1` receipt before it returns hits. Receipt
ids from search use the `qr_` prefix. KAR and Cortex
receipts use `er_`. A receipt is an integrity check. It does not mean a claim
is proven.

`SATISFIED` from `knolo_kar_evaluate` means evidence requirements were met.
It does not mean a claim is proven. Cortex verification checks that the trace
matches the image. It does not mean the answer is true.

A policy denial throws `ACCESS_DENIED`. An unwritable audit directory throws
`AUDIT_UNAVAILABLE` and returns no hits. Other closed failures use
`IMAGE_INVALID`, `IMAGE_UNAVAILABLE`, `NOT_FOUND`, `QUERY_INVALID`, or
`STATE_ROOT_MISMATCH`. Each thrown message is `CODE: text`, the same text the
MCP tool returns for that input and image.

## MCP alternative

A host that already has an MCP client can launch the published server:

```bash
npx -y @knolo/mcp@0.2.0 --config /absolute/knolo-mcp.json
```

That command is stdio. This package does not start it and does not open a
port.

The example is [`examples/ai-sdk`](../../examples/ai-sdk/README.md). The
integration note is [Vercel AI SDK](../../docs/integrations/ai-sdk.md). Pins
and receipts come from [`@knolo/tools`](../knolo-tools/README.md).
