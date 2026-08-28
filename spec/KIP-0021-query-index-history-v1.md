# KIP-0021: Query indexes and history v1

Status: foundation implementation

This contract adds deterministic read acceleration and auditable query history
to the V5 read-only EQL surface. It does not add query mutation, embedded
expressions, authorization decisions, or a network query service.

## Query index

`KnowledgeQueryIndexV1` is derived from one Knowledge Image state root and
contains sorted object IDs, kind postings, and scalar field postings for `id`,
`kind`, and scalar `meta.<key>` values. Postings contain strictly sorted,
unique object IDs. The index root is:

```text
SHA-256("knolo:query-index:v1\0" || canonical_cbor({
  fieldPostings, kindPostings, objectIds, stateRoot, version: 1
}))
```

An index must verify against the image state root and its complete derived
contents before it can be used. Query evaluation still applies the existing
full EQL matching and ordering rules; the index only narrows safe candidates.
Text search remains semantically checked by the query evaluator.

## Query history

`KnowledgeQueryHistoryV1` is an append-only sequence of verified query records.
Each record stores the query plan, state root, plan root, result root, sequence,
timestamp, and an entry root. Timestamps cannot move backward. The history root
is derived from the ordered entry list using the `query-history` domain, while
each entry uses `query-history-entry`.

History records preserve verifiable query intent and result identity without
claiming to preserve the result payload itself. A caller that needs the hits
must retain or recompute the corresponding verified image and query result.

## Node persistence

`DurableKnowledgeQueryIndexStoreV5` and
`DurableKnowledgeQueryHistoryStoreV5` use exclusive lock files and temporary
file plus flush/rename writes. Existing artifacts are decoded and verified
before opening; failed opens release their newly acquired lock. Index refresh
rebuilds the index for a new state root and adopts it only after persistence.

Persistent indexes and history are local read-side artifacts. Multi-process
coordination and distributed query caches remain host-level concerns. Query
authorization is defined by the authority KIPs, and KIP-0026 defines the
read-only Studio management view over verified index/history state.
