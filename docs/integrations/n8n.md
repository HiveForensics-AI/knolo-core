# n8n

`n8n-nodes-knolo` is an n8n community node for a pinned Knolo V5 Knowledge
Image. `n8n-nodes-knolo@0.1.0` is on npm and includes search, get, and
verify. This checkout also runs status, KAR evaluate, KAR verify, and Cortex
verify. Knolo does not call a model and does not read an API key.

The node asks for Node.js 22.12 or newer. Synchronous `require()` of the
`@knolo/tools` ES module is on by default from that release. n8n loads the
node with `require`, so the built file is CommonJS. It depends on
`@knolo/core` `^6.2.1` and `@knolo/tools` `^0.2.1`. The license is
Apache-2.0. n8n itself is under the Sustainable Use License. This package
does not include n8n source. The only peer dependency is `n8n-workflow`.

This node does not start a server and does not open a port. npm `0.1.0` does
not include status, KAR, or Cortex yet. Build this checkout and point
`N8N_CUSTOM_EXTENSIONS` at the package directory:

```bash
npm run build --workspace n8n-nodes-knolo
export N8N_CUSTOM_EXTENSIONS=/absolute/path/to/packages/n8n-nodes-knolo
```

## Operations

Search, Get, Verify, Status, KAR Evaluate, KAR Verify, and Cortex Verify read
one mounted image. The mount is configuration on the node: image path,
SHA-256, state root, policy path, audit directory, mount id, principal, and
agent id. The KAR graph path, KAR graph SHA-256, and source-tree fields are
configuration too. n8n does not evaluate those fields as item expressions, so
an item cannot change the caller or the pin.

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
and returns no hits. Each thrown message is `CODE: text`. If the node is
set to continue on fail, a failure while loading the image is returned as
`error` on every input item, or on one item when the input is empty.

Status returns `ok`, `status` (`ready` or `stale`), `pin`, and `mounts`.
`ok` is false when a recorded source tree is stale. The image pin still
matched. Status does not write a receipt.

KAR Evaluate and KAR Verify need both KAR graph parameters. Without them the
node fails with `IMAGE_UNAVAILABLE` and writes no receipt. Proposition, plan,
result, and dossier come from the parameter or, when it is empty, from the
current item. Verify takes exactly one of result or dossier. Each call writes
an `er_` receipt and attaches that receipt as `receipt`. `ok` on evaluate is
true only for `SATISFIED`. `SATISFIED` means evidence requirements were met.
It does not mean a claim is proven. An IF node can branch on `{{ $json.ok }}`.
The example is [kar-branch.json](../../examples/n8n/kar-branch.json).

Cortex Verify checks a trace from the Trace parameter or the item fields
`trace` or `answer`. `ok` true and `status` `verified` mean the trace matches
the image. They do not mean the answer is true. A tampered trace returns
`ok` false and still writes an `er_` receipt. This node does not add KITE
operations.

`SATISFIED` is not a search result, and it does not mean a claim is proven.

The package README is
[`n8n-nodes-knolo`](../../packages/n8n-nodes-knolo/README.md). Pins and
receipts come from
[`@knolo/tools`](../../packages/knolo-tools/README.md).
