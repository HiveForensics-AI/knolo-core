# KIP-0029: Exchange Capsule V1

Status: foundation implementation

A capsule is evidence that a few objects belong to one verified V5 Knowledge
Image. It is not a sync message and it is not a skill pack. Receiving a
capsule does not mount a store, adopt an image, or activate instructions.

`objectRoot` in a V5 image is a flat digest of the sorted object ids. It is
not a Merkle tree. This capsule does not claim a Merkle inclusion proof
against that root. Composition excerpts stay id and kind only.

## Proof

The capsule carries:

- the V5 commit record
- the full sorted object-id list
- the selected object records, at most 64, each `{ id, kind, bytes, meta }`

The caller chooses the object ids. The codec does not run KAR, Cortex, or a
model.

Verification recomputes each selected object id as
`digestDomain('object', canonicalCbor({ kind, bytes, meta }))`. The id field
is not part of that preimage. It recomputes `objectRoot` from the full id
list and `stateRoot` from the carried commit:

- `commitDigest = digestDomain('commit', canonicalCbor(commit))`
- `stateRoot = digestDomain('state', digestBytes(commitDigest))`

The commit digest covers `objectRoot`, the event root, views, policy, and
the segment digests, including `objectSegmentDigest`. A capsule does not
rebuild `objectSegmentDigest` from every object byte. It checks the commit
record it carries. The recomputed `stateRoot` must equal the capsule field
and the parent `stateRoot` inside the signed exchange offer.

The object-id list must be sorted and must not repeat an id. A swapped
object body, an id list that changes `objectRoot`, or a commit that does not
match the signed `stateRoot` fails closed.

## Wire

Canonical CBOR. `version` is 1. `kind` is `exchange-capsule`. Fields are
`stateRoot`, `commit`, `objectIds`, and `objects`. No extra fields.
