---
name: share-findings
description: Share a verified research pack by digest so another agent can pin it.
---

# share-findings

The host owns the model. This skill does not call one.

1. Run `knolo verify` on the research pack before sharing it.
2. Give the other agent the digest and the state root from that check.
3. The other agent pins that digest, verifies the file, and mounts it.
4. Include the receipt id when a search of the mounted image is used.
5. A receipt is an integrity check. It does not mean a claim is proven. SATISFIED means the evidence requirements were met.
6. Do not skip the pin. Discover research packs with `knolo search --research`. That filter is separate from `knolo search --agents`.
