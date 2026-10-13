# @knolo/tools

`@knolo/tools` is the host-agnostic service behind Knolo's read-only adapters.
`@knolo/openclaw` and `@knolo/mcp` both import it. The package pins a local V5
Knowledge Image by file SHA-256 and state root, checks the policy root at
load, and writes a replayable query receipt before search results are
returned.

Caller identity is an argument of `search`, `get`, `verify`, and `status`.
The host must supply that identity from its own configuration or attestation.
Tool arguments are not a caller.

Receipts use version `openclaw-knolo-query-v1`. An unwritable audit directory
fails the search with `AUDIT_UNAVAILABLE` and returns no hits. Mount failures
use `ACCESS_DENIED`, `IMAGE_INVALID`, `IMAGE_UNAVAILABLE`, `NOT_FOUND`,
`QUERY_INVALID`, or `STATE_ROOT_MISMATCH`.

The package requires Node 20 or newer and `@knolo/core` `^6.0.0`. It does not
download images, open a network connection, or implement KAR, coverage, or
composition. `@knolo/tools@0.1.0` is not on npm yet. Publish it before `@knolo/mcp`,
which depends on `^0.1.0`.
