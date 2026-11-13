---
name: share-findings
description: Share a verified research pack by file SHA-256 and state root so another agent can pin it.
---

# share-findings

The host owns the model. This skill does not call one.

1. Run `knolo verify` on the research pack before sharing it.
2. Share the file, the SHA-256 of those file bytes, and the state root printed by `knolo verify`. `commitDigest` is not the artifact pin.
3. The other agent pins the file with `knolo add` and verifies it before mounting. A published pack is pinned as `publisher/slug@version`.
4. Include the receipt id when a search of the mounted image is used.
5. A receipt is an integrity check. It does not mean a claim is proven. SATISFIED means the evidence requirements were met.
6. Do not skip the pin. Discover research packs with `knolo search "<query>" --research`. That filter is separate from `knolo search --agents`.
