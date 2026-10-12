# Composition

Composition cites Knowledge Images, V4 packs, KAR sidecars, Domain Packs, bounded excerpts, and other composition records. The citation is a sidecar. It is not a new V5 commit view, and it is not an input to `stateRoot` or `KARRoot`.

```ts
import {
  createCompositionRecord,
  verifyCompositionRecord,
  createBoundedExcerpt,
  verifyBoundedExcerpt,
  createCompositionAttestation,
  verifyCompositionAttestation,
  openComposedSession,
  queryComposedSession,
  evaluateComposedKar,
} from '@knolo/core/composition';
```

`@knolo/core` and `@knolo/core/kar` do not load this module. Core does not read the filesystem, the network, or the clock. Hub is optional and is not called from this entry.

## What a record commits

`compositionRoot` is `digestDomain('composition-record', canonicalCbor(body))`. The stored `compositionRoot` field is not part of that preimage. The same rule applies to `excerptRoot`, `attestationRoot`, and `signatureRoot`.

A member keeps the role fixed by its kind: `dependency`, `evidence`, `vocabulary`, `excerpt`, or `nested`. Role does not grant precedence. The same alias, or the same primary identity, fails closed. The host image is not also a member.

`availability: material` requires every member's bytes. `availability: digest` commits to digests only. Supplied bytes are always checked. Upgrading digest to material changes `compositionRoot` when the bytes were not already committed.

Policy lives inside the composition root: `{ default, allow, deny }`. An explicit deny wins. The writer default is allow with empty lists. A parent cannot override a child record's deny.

## Attestations

`statement` is `mount`, `used`, or `cited`.

- `mount` means the record references members.
- `cited` means the record names sources.
- `used` means a composed query or a KAR evaluation ran.

`used` does not mean `SATISFIED`. It does not mean a claim is true or false. `SATISFIED` still means only that the declared KAR evidence requirements were met.

The content root has no signer and no clock. An optional Ed25519 envelope covers that root. One signer, no delegation. Core verifies with SubtleCrypto. The CLI signs. Core does not generate keys and does not call `Date.now()`.

`createCompositionAttestation` recomputes `compositionRoot` before it writes `attestationRoot`. A stored root that does not match the body is `COMPOSITION_ROOT_MISMATCH`. When a signature names `keyringRoot`, that value must equal `authorityKeyringRootV1` of the supplied keyring. The matching key must satisfy `notBefore <= now`, `now < notAfter`, and `now < revokedAt`. A key outside that window is `ATTESTATION_KEY_MISMATCH`.

License, price, currency, and usage belong in `commerce.json`. Verification ignores that file. Those fields never enter `compositionRoot`.

## CLI

```bash
knolo compose create --members members.json --out composition/ [--host knowledge.knolo]
knolo compose verify composition/
knolo compose excerpt --image knowledge.knolo --object <id> --out excerpt.json
knolo compose query --composition composition/ --eql 'FROM chunk SEARCH "valve" LIMIT 5'
knolo attest create --composition composition/composition.json --subject composition --statement cited --out composition/attestation.json
knolo attest verify composition/attestation.json --content-only
```

`knolo verify-attestation` is the same check as `knolo attest verify`. Both recompute `compositionRoot` when `--composition` is set. A bad signature exits 1 even when the content root matches. `--content-only` checks the content root and ignores the envelope. `compose verify` runs `verifyBoundedExcerpt` on each bundled excerpt file. A nested composition directory may include `host.knolo` for that child only. Signing with `--keyring` stores the root of that keyring file.

Hub `attested: true` is a listing flag. It is not an attestation root. See [Hub](hub.md).

## Limits

Slice A is local and offline. There is no merged evidence graph, no composed `SATISFIED`, no Merkle inclusion proof, and no zero-knowledge disclosure. A bounded excerpt commits object id and kind for at most 64 objects. Nesting stops at 8 composition records. Cycles fail closed.

Creating an excerpt always has the parent image, so the created inclusion is `included`. A foreign `digest-bound` excerpt can still be verified without its parent. Supplying the parent for a digest-bound excerpt does not upgrade it.

Further reading: [verification](verification.md), [Hub](hub.md), [6.1.0 notes](../releases/v6.1.0.md), and [`examples/composition-v1`](../../examples/composition-v1/README.md).
