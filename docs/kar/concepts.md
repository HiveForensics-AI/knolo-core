# KAR concepts

KAR-1 retrieves a minimum evidence set from a committed graph. It does not discover that graph at query time.

## Frontiers

Every traversable relation is assigned to one of five frontiers by the plan:

| Frontier | Role |
| --- | --- |
| `F_S` | Support |
| `F_O` | Opposition |
| `F_Q` | Qualification |
| `F_T` | Temporal |
| `F_A` | Authority |

There is no default mapping. A relation symbol omitted from `frontierMap` is not traversable. An evidence object may appear in more than one frontier. Benchmark labels that the plan does not list are not requirements.

## Closure

Closure is a breadth-first walk over `(node, frontier)` states. The anchor starts at depth 0 with an empty frontier. The relation used to enter a node replaces the frontier. The first time a state is reached is the canonical witness.

Bindings on the anchor state do not enter a frontier. A state at depth `h` is not expanded when `h` is the plan depth. Resource bounds are hard. Exceeding a closure bound returns `CLOSURE_BOUND_EXCEEDED` with empty frontiers, witnesses, and selected evidence.

The experimental runtime stores parent pointers during the walk and materializes the witness path only when an evidence item is first admitted. The emitted witness object matches the research reference.

## Exact cover

`minimum-cover` returns the smallest set that meets the floors, then the lexicographically smallest evidence-id sequence at that size. It does not return an approximate set under that name.

Each combination increments the visit count, including the empty set. If the visit budget is exhausted before the decision is proven, the status is `SEARCH_BOUND_EXCEEDED` and the selected set is empty, even if a feasible set was already seen. The frontiers already computed stay on the certificate.

A cardinality bound that excludes every feasible set is `UNSATISFIED_EVIDENCE_REQUIREMENTS`, not a search failure. An empty set is `SATISFIED` when every floor passes at size 0.

`inspectKarComplexity` estimates how large that search can become. It does not select evidence and it does not change a later evaluation. Distinct requirement masks around 12 are generally practical at the default 10,000 visits. Fifteen or more private requirement combinations can exceed that budget because the combination count passes 10,000. That bound is unchanged.

## Identity

A mounted V5 image has a `stateRoot`. KAR also has a `knowledgeRoot`, the frozen digest of `{ version: 1, evidence }` sorted by evidence id. The specification forbids treating that projection digest as a V5 state root. A session keeps both, and they are not redefined to be equal.

The sidecar must match the image on `stateRoot`, `objectRoot`, and `commitDigest`, and its `knowledgeRoot` must match the projection. The graph's own `knowledgeRoot` is that same projection root. `SemanticRoot` digests the graph and the projection root. It is not renamed `CEGRoot`.

## Absence

A frontier that comes back empty says that this closure did not admit evidence into that frontier. It does not say that no such evidence exists anywhere.

## Compiler

The CEG is an input. KAR does not compile text into edges, and this phase does not add a model, an embedding index, or a vector database.
