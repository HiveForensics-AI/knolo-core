# KIP-0002: V5 object and event roots

Status: implemented foundation contract

## Object identity

An object is a canonical CBOR map with `kind`, `bytes`, and `meta`. Its ID is:

```text
sha256(knolo:object:v1\0 || canonical_cbor({kind, bytes, meta}))
```

The object segment is a canonical CBOR array of objects, sorted by object ID.
The object root is the digest of the canonical array of object ID strings under
`knolo:object-root:v1`.

## Events

`KnowledgeEventV1` contains `version`, `id`, `transactionId`, `parents`,
`actor`, `actorCounter`, `kind`, `target`, `payload`, and `provenance`.
The event ID is computed over the same map without `id`, under
`knolo:event:v1`.

The event segment is a canonical CBOR array sorted by event ID. The event root
is the digest of the canonical array of event ID strings under
`knolo:event-root:v1`.

## Commits and state roots

`KnowledgeCommitV1` contains:

```text
version, parents, transactionRoot, objectRoot, eventRoot, views,
schemaRoot, policyRoot, runtimeContract, sequence, actor,
objectSegmentDigest, eventSegmentDigest
```

The commit digest is the digest of its canonical CBOR payload under
`knolo:commit:v1`. The state root is the digest of the raw 32-byte commit hash
under `knolo:state:v1`.
