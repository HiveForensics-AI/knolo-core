# n8n-nodes-knolo

`n8n-nodes-knolo` is an n8n community node for read-only Knolo search, get,
verify, status, KAR, and Cortex. `n8n-nodes-knolo@0.1.0` is on npm and
includes search, get, and verify. This checkout adds status, KAR, and Cortex
without a version bump. It depends on `@knolo/core` `^6.2.1` and
`@knolo/tools` `^0.2.1`. The license is Apache-2.0.

n8n itself is under the Sustainable Use License. This package does not
include n8n source. The only n8n peer dependency is `n8n-workflow`. The n8n
process provides that package. This repository pins `n8n-workflow` `2.47.0`
as a dev dependency so the node can typecheck.

n8n loads community nodes with `require`, so the built node is CommonJS.
`@knolo/core` and `@knolo/tools` stay ESM packages. The node loads the file
named by each package's import export. Engines ask for Node.js 22.12 or
newer, the first Node 22 release that loads an ES module with `require()`
without a flag. Node 20.19 and newer can load that file, and this
repository's tests run there. Node 21, and Node 22.0 through 22.11, cannot.

`n8n-workflow` depends on `isolated-vm` 7, which publishes prebuilds for
Node 24 and newer. This repository's CI uses Node 20. The root install
overrides that module with a stub. This node does not evaluate n8n
expressions.

Knolo does not call a model. This node does not open a port and does not
start a server.

## Load it locally

Build the package, install its dependencies, and point n8n at this directory.
npm `0.1.0` does not include status, KAR, or Cortex yet.

```bash
npm run build --workspace n8n-nodes-knolo
export N8N_CUSTOM_EXTENSIONS=/absolute/path/to/packages/n8n-nodes-knolo
```

`N8N_CUSTOM_EXTENSIONS` is the package directory, the folder that contains
`package.json`. n8n reads the `n8n` field and loads
`dist/nodes/Knolo/Knolo.node.js`.

## Operations

The node parameters hold the mount: image path, SHA-256, state root, policy
path, audit directory, mount id, principal, and agent id. Optional KAR graph
path and SHA-256, and optional source-tree fields (`grokHome`, `builtAt`,
`sourceDigest`, `sourceRoots`), are configuration too. n8n does not evaluate
those fields as item expressions, so an item cannot change the caller or the
pin. An incoming item field named `agentId` is ignored. The caller is the
Agent ID parameter, and the mount's agent list is that same id.

Search takes a query and an optional limit. The query description is the
shared Knolo search description from `@knolo/tools`. An empty limit, or `0`,
is omitted. It is not sent as `null`. Get takes an object id and an optional
image id. The configured state root is sent with that request. Verify takes
an optional image id. An empty image id uses the Mount ID.

A successful search returns hits, the receipt id (`qr_` plus 24 hex
characters), and the state root. A bad pin fails with `IMAGE_INVALID` before
any hit. A policy denial fails with `ACCESS_DENIED`. An unwritable audit
directory fails with `AUDIT_UNAVAILABLE` and returns no hits. If the node
is set to continue on fail, a failure while loading the image is returned
as `error` on every input item, or on one item when the input is empty.

Status calls `statusWithFreshness`. The output has `ok`, `status` (`ready`
or `stale`), `pin`, and `mounts`. `ok` is false when a recorded source tree
is stale. The image pin still matched, or the node would have failed while
loading. `builtAt` and `stale` appear only when the mount id is `files`,
`skills`, `memory`, or `transcripts` and the source fields are set. Status
does not write a receipt. `@knolo/tools` has no status receipt.

KAR Evaluate and KAR Verify run only when both KAR graph parameters are set.
The graph file is pinned the same way as the image. A mount without that
block fails with `IMAGE_UNAVAILABLE` and writes no receipt. Proposition, plan,
result, and dossier come from the node parameter or, when that parameter is
empty, from the current item. The plan is a JSON object checked by KAR.
Verify takes exactly one of result or dossier. Each call writes an `er_`
evidence receipt in the audit directory and returns that receipt on `receipt`.

`ok` on KAR Evaluate is true only when `status` is `SATISFIED`. `SATISFIED`
means evidence requirements were met. It does not mean a claim is proven.
An IF or Switch can branch on `ok` or `status`. The example workflow is
[kar-branch.json](../../examples/n8n/kar-branch.json).

Cortex Verify checks a supplied trace against the pinned image. The trace
comes from the Trace parameter or from the item fields `trace` or `answer`.
A match sets `ok` true and `status` to `verified`. That match means the trace
fits the image. It does not mean the answer is true. A tampered trace returns
`ok` false, a typed `status`, and still writes an `er_` receipt. This node
does not call a model. It does not add KITE operations.

A receipt is an integrity check. It does not mean a claim is proven.

The integration note is [n8n](../../docs/integrations/n8n.md). Pins and
receipts come from [`@knolo/tools`](../knolo-tools/README.md).
