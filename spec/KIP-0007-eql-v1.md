# KIP-0007: Bounded EQL v1

Status: foundation implementation

KIP-0007 defines a read-only query surface over a mounted V5 Knowledge Image.
It does not alter V4 retrieval APIs, mutate objects, or evaluate authority and
policy decisions.

## Grammar

```text
FROM <kind|*>
  [WHERE <field> = <literal> AND <field> = <literal> ...]
  [SEARCH "text"]
  [LIMIT <positive integer>]
```

The keywords are case-insensitive. Supported fields are `id`, `kind`, and
scalar `meta.<key>` values. Literals are quoted strings, safe integers,
`true`, `false`, or `null`. `SEARCH` requires a non-empty quoted string and
matches every normalized term against UTF-8 object bytes. The limit defaults to
100 and is capped at 1000.

KIP-0018 adds bounded equality joins and one-field deterministic ordering while
preserving the legacy plan and result roots when those clauses are absent.
Mutation statements, embedded expressions, authority checks, and policy
overrides remain unsupported.

## Canonical plan

The parser normalizes keyword spelling, text case, whitespace, field names, and
filter order. The plan is encoded as canonical CBOR:

```text
{
  "filters": [{"field": text, "op": "=", "value": scalar}],
  "kind": text|null,
  "limit": uint,
  "search": text|null,
  "source": "knowledge-image-v5",
  "version": 1
}
```

`planRoot` is:

```text
knolo:query-plan:v1\0 || canonical_cbor(plan)
```

## Result root

Objects are filtered, sorted by stable object identity, and truncated by the
plan limit. `resultRoot` is computed from the committed image root, plan root,
and ordered matching object IDs:

```text
knolo:query-result:v1\0 || canonical_cbor({
  "objectIds": [digest...],
  "planRoot": digest,
  "stateRoot": digest
})
```

Rust and TypeScript must produce identical plan roots, hit IDs, and result roots
for the same image and expression. Querying is snapshot-based and read-only.
Authority evaluation, result filtering by policy, indexes, and durable query
history remain subsequent work.
