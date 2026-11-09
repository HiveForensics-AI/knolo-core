# @knolo/tools

`@knolo/tools` is the host-agnostic service behind Knolo's read-only adapters.
`@knolo/openclaw`, `@knolo/mcp`, and `@knolo/ai-sdk` import it. The package pins a local V5
Knowledge Image by file SHA-256 and state root, checks the policy root at
load, and writes a replayable query receipt before search results are
returned.

Caller identity is an argument of `search`, `get`, `verify`, `status`, and
`readAuthorizedMount`. The host must supply that identity from its own
configuration or attestation. Tool arguments are not a caller.

`readAuthorizedMount` returns the mounted image after the caller is allowed
and the mount principal may query `chunk` objects. Deny wins, then allow,
then the policy default. `writeEvidenceReceipt` appends
`knolo-mcp-evidence-receipt-v1` in the same audit directory. Those receipt
ids use the `er_` prefix. Query receipts stay `openclaw-knolo-query-v1` and
`qr_`. An unwritable audit directory fails the write with `AUDIT_UNAVAILABLE`
and the host returns no result. Mount failures use `ACCESS_DENIED`,
`IMAGE_INVALID`, `IMAGE_UNAVAILABLE`, `NOT_FOUND`, `QUERY_INVALID`, or
`STATE_ROOT_MISMATCH`.

`search` parses `knolo_search` text into a V5 plan with `textQuery`. A quoted
phrase is one contiguous whole phrase. Unquoted `OR` selects any remaining
term. Unquoted stopwords and terms shorter than 3 characters are dropped. A
query that drops every term matches nothing. Each kept term must appear as a
whole word. The stored plan uses `rank: relevance`. If every term misses and
at least one term hits, the stored mode is `partial`, so verify replays that
mode instead of choosing again. `match` on the result and the receipt is
`all`, `any`, `partial`, or `none`. EQL plans with no `textQuery` stay
substring matches in object id order. The stopword list is
`KNOLO_SEARCH_STOPWORDS`.

The package requires Node 20 or newer and `@knolo/core` `^6.0.0`. It does not
download images, open a network connection, or import KAR, Cortex, coverage,
or composition. `@knolo/openclaw@0.1.0` stays on `@knolo/tools` `^0.1.0`.
A clean install resolves that range to the published 0.1.0 package, because
the in-tree 0.2.0 does not satisfy it. `@knolo/tools@0.2.0` is the in-tree
version and this change does not publish it.
