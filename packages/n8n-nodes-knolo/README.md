# n8n-nodes-knolo

`n8n-nodes-knolo` is an n8n community node for read-only Knolo search, get,
and verify. `n8n-nodes-knolo@0.1.0` is not on npm yet. It depends on
`@knolo/core` `^6.2.1` and `@knolo/tools` `^0.2.1`. The license is Apache-2.0.

n8n itself is under the Sustainable Use License. This package does not
include n8n source. The only n8n peer dependency is `n8n-workflow`. The n8n
process provides that package. This repository pins `n8n-workflow` `2.47.0`
as a dev dependency so the node can typecheck.

n8n loads community nodes with `require`, so the built node is CommonJS.
`@knolo/core` and `@knolo/tools` stay ESM packages. The node loads the file
named by each package's import export.

`n8n-workflow` depends on `isolated-vm` 7, which publishes prebuilds for
Node 24 and newer. This repository's CI uses Node 20. The root install
overrides that module with a stub. This node does not evaluate n8n
expressions.

Knolo does not call a model. This node does not open a port and does not
start a server.

## Load it locally

Build the package, install its dependencies, and point n8n at this directory.
The community installer installs by npm name, so that path waits until
`0.1.0` is published.

```bash
npm run build --workspace n8n-nodes-knolo
export N8N_CUSTOM_EXTENSIONS=/absolute/path/to/packages/n8n-nodes-knolo
```

`N8N_CUSTOM_EXTENSIONS` is the package directory, the folder that contains
`package.json`. n8n reads the `n8n` field and loads
`dist/nodes/Knolo/Knolo.node.js`.

## Operations

The node parameters hold the mount: image path, SHA-256, state root, policy
path, audit directory, mount id, principal, and agent id. Those values are
configuration. Search, get, and verify do not accept `agentId` from an item.
An incoming item field named `agentId` is ignored. The caller is the Agent ID
parameter, and the mount's agent list is that same id.

Search takes a query and an optional limit. The query description is the
shared Knolo search description from `@knolo/tools`. An empty limit, or `0`,
is omitted. It is not sent as `null`. Get takes an object id and an optional
image id. The configured state root is sent with that request. Verify takes
an optional image id. An empty image id uses the Mount ID.

A successful search returns hits, the receipt id (`qr_` plus 24 hex
characters), and the state root. A bad pin fails with `IMAGE_INVALID` before
any hit. A policy denial fails with `ACCESS_DENIED`. An unwritable audit
directory fails with `AUDIT_UNAVAILABLE` and returns no hits.

A receipt is an integrity check. It does not mean a claim is proven.
`SATISFIED` is not a search result from this node, and it is not proof.

The integration note is [n8n](../../docs/integrations/n8n.md). Pins and
receipts come from [`@knolo/tools`](../knolo-tools/README.md).
