# Hub and composition

Knolo Hub, in this slice, does not publish composition records.

Hub artifact inspection accepts a V4 pack or a V5 Knowledge Image. A composition JSON document is neither, so Hub verify rejects it. The Hub draft field `attested: true` is a publisher listing flag stored as `publisherAttested`. It is not `attestationRoot`, and it is not `compositionRoot`.

`knolo publish` still sends that listing flag for a V4 or V5 blob. It does not send a composition sidecar. `knolo compose` and `knolo attest` do not call Hub. `@knolo/cli` `6.1.0` depends on `@knolo/core` `^6.1.0` for those commands.

Composition records stay local sidecars. A later Hub change can add optional draft fields only after Hub verify accepts a third artifact kind. License, price, currency, and usage stay in `commerce.json`. They do not enter `digestDomain` unless a later revision says so.

The local cache `~/.knolo/cache/sha256/<hex>.knolo` may supply member bytes during `knolo compose verify`. A cache miss fails closed when material is required. The cache is a CLI concern. Core does not read it.
