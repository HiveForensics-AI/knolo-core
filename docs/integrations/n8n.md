# n8n

`n8n-nodes-knolo` is an n8n community node for a pinned Knolo V5 Knowledge
Image. `n8n-nodes-knolo@0.1.0` is not on npm yet. Knolo does not call a model
and does not read an API key.

The node asks for Node.js 22 or newer. n8n loads it with `require`, so the
built file is CommonJS. It depends on `@knolo/core` `^6.2.1`
and `@knolo/tools` `^0.2.1`. The license is Apache-2.0. n8n itself is under
the Sustainable Use License. This package does not include n8n source. The
only peer dependency is `n8n-workflow`.

This node does not start a server and does not open a port. Install by npm
name waits until `0.1.0` is published. Until then, build the package and
point `N8N_CUSTOM_EXTENSIONS` at the package directory:

```bash
npm run build --workspace n8n-nodes-knolo
export N8N_CUSTOM_EXTENSIONS=/absolute/path/to/packages/n8n-nodes-knolo
```

## Operations

Search, Get, and Verify read one mounted image. The mount is configuration
on the node: image path, SHA-256, state root, policy path, audit directory,
mount id, principal, and agent id.

Caller identity is the Agent ID parameter. An item field named `agentId` is
ignored. Search and get arguments cannot set the caller.

Search uses the shared Knolo search description. Each kept term must appear
as a whole word. An empty limit, or `0`, uses the service default and is not
sent as `null`. A successful search returns hits, a receipt id (`qr_` plus
24 hex characters), and the state root. The node writes an
`openclaw-knolo-query-v1` receipt before it returns hits. A receipt is an
integrity check. It does not mean a claim is proven.

Get reads one object. The request uses the object id, the image id (or the
Mount ID when the image id is empty), and the state root configured on the
node. Verify checks the same mounted image.

A bad pin throws `IMAGE_INVALID` before any hit. A policy denial throws
`ACCESS_DENIED`. An unwritable audit directory throws `AUDIT_UNAVAILABLE`
and returns no hits. Each thrown message is `CODE: text`.

This node does not evaluate KAR. `SATISFIED` is not a search result, and it
does not mean a claim is proven.

The package README is
[`n8n-nodes-knolo`](../../packages/n8n-nodes-knolo/README.md). Pins and
receipts come from
[`@knolo/tools`](../../packages/knolo-tools/README.md).
