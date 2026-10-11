# KAR plans

A plan declares the evidence requirements. It does not rank passages. Format `kar-plan-v1`. Schema: [`kar-plan-v1.schema.json`](../../schemas/experimental/kar/kar-plan-v1.schema.json).

The runtime requires every field below. A missing or mistyped field is status `PLAN_INVALID` and code `KAR_PLAN_INVALID`.

| Field | Role |
| --- | --- |
| `anchor` | `supplied` witness, or `recompute` with procedure `member-id-v1` |
| `frontierMap` | Relation symbol to `F_S`, `F_O`, `F_Q`, `F_T`, or `F_A` |
| `depth` | Closure depth. The anchor is depth 0 and has no frontier |
| `requirements` | Requirement tokens demanded on each frontier |
| `floors` | Decimal strings. `1` means one covering admission |
| `profile` | `minimum-cover` is the product profile |
| `asOf` | `YYYY-MM-DD` applicability date |
| `minAuthority` | Number, or `null` when authority is not a floor |
| `bounds` | Hard caps. Overflow does not fall back to a greedy set |
| `lexical` | `null` unless the plan adds an explicit lexical frontier |

`frontierMap` is mandatory. A relation omitted from the map is not walked. There is no default partition.

`minimum-cover` selects the smallest set that meets the floors, then the lexicographically smallest evidence-id sequence. `SEARCH_BOUND_EXCEEDED` means `maxCoverVisits` was hit before that set was proven. The selected set is empty. There is no approximate substitute under this profile.

`CLOSURE_BOUND_EXCEEDED` means a closure cap was hit. Frontiers and the selected set are empty.

A supplied anchor names node ids. If a named node is not in the committed graph, the status is `ANCHOR_REJECTED` and the code is `KAR_ANCHOR_REJECTED`. The witness `queryTerm` is part of `AnchorRoot`. It does not, by itself, filter evidence text.

Applicability uses the binding, not a score:

- `unauthorized: true` excludes the binding
- `authority` below `minAuthority` excludes the binding
- `validFrom` after `asOf`, or `validUntil` at or before `asOf`, excludes the binding

Those exclusions can produce `UNSATISFIED_EVIDENCE_REQUIREMENTS` when the remaining admissions miss a floor.

See [Concepts](concepts.md) for closure and exact cover.
