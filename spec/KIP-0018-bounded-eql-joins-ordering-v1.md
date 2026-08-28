# KIP-0018: Bounded EQL Joins and Ordering V1

Status: foundation implementation

KIP-0018 extends KIP-0007 with read-only equality joins and deterministic
ordering:

```text
FROM <kind|*>
  [JOIN <kind|*> ON <field> = <field> ...]
  [WHERE <field> = <literal> AND ...]
  [SEARCH "text"]
  [ORDER BY <field> [ASC|DESC]]
  [LIMIT <positive integer>]
```

Joins compare scalar fields on the source object and the joined object, allow
at most four clauses, and return stable joined object identities. `ORDER BY`
supports one scalar field; missing values sort after present values and object
identity is the ascending tie-break. The existing 1,000-result limit remains
in force.

Legacy queries omit the new optional plan fields and retain their existing
plan and result roots. Join results add ordered joined identities to the result
root. Execution scans verified snapshots and builds no persistent index; query
indexes, mutation, embedded expressions, and authority evaluation remain
subsequent work.
