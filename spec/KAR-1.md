# KAR-1: Frontier-constrained evidence retrieval

Status: research draft, semantics version `kar-1-research-1`. Not a V5 KIP.
Not an assigned KIP number. Does not amend KIP-0001 through KIP-0027, V5
state roots, public package exports, or Evidence Gate.

Working name: KAR-1. The words behind the abbreviation are Knolo Adversarial
Retrieval. The expansion may change. The algorithm in this draft does not.

This draft separates two problems that the experiment series had begun to
mix. A host compiles text into a Committed Evidence Graph. KAR retrieves a
minimum evidence set from a graph that is already committed and already bound
to one Knowledge Image. Compilation is a host input. KAR begins at that input.

`SATISFIED` means the declared evidence requirements were met inside one
`(K, G, q, Π)`. It does not mean the proposition is true.
`UNSATISFIED_EVIDENCE_REQUIREMENTS` does not mean the proposition is false.
Those two sentences are normative. Later wording must not turn KAR into a
truth engine.

## 1. The question KAR answers

Lexical rankers answer which documents best match a query.

KAR answers a different question: from one committed Knowledge Image and one
Committed Evidence Graph bound to that image, under one declared retrieval
plan, what is the smallest applicable evidence set that meets the plan's
frontier requirements, and is that set sufficient?

The result is allowed to be abstention. Abstention means the declared
requirements were not met inside that image, that graph, and that plan. It
does not mean the proposition is false, and it does not mean no evidence
exists anywhere else.

## 2. Boundary

The normative input is a Committed Evidence Graph, abbreviated CEG. The
symbol in the formulas remains `G`. The name "semantic graph" is only
historical. A CEG is special because it binds concepts, relationships,
evidence, authority, provenance, time, and requirement identifiers to one
immutable knowledge state.

```text
G = (V, E, R, A, P, T)
```

`E`, `A`, and `T` are not separate free-floating sets in the artifact. They
are fields of evidence bindings. `P` is the graph header plus any
per-binding provenance. The header is:

```text
version
knowledgeRoot
provenance
nodes
relations
bindings
```

`version` for this draft is `1`. `provenance` names the producer and may
carry a digest of that producer's own inputs. KAR does not interpret the
producer. Before evaluation the implementation recomputes the research
knowledge root of `K` and requires:

```text
G.knowledgeRoot = KnowledgeRoot(K)
```

If they differ, or if a binding names an evidence identifier that `K` does
not contain, the status is `GRAPH_NOT_BOUND` and the emitted evidence set is
empty. A CEG is not movable onto another image merely because identifiers
collide.

The semantic root commits the pair:

```text
SemanticRoot = H(KnowledgeRoot, G)
```

`H` is defined in section 8. The preimage is the canonical object
`{ knowledgeRoot, graph }`, where `graph` is the normalized CEG. Two
producers that emit the same canonical pair have the same semantic root.
KAR does not prefer one producer. A deterministic parser, a human editor, a
model compiler, an imported ontology, an enterprise system, Evidence Gate
structures, a legal-ontology import, a FHIR mapping, a knowledge-graph
import, or a later Knolo compiler are interchangeable once `G` and
`SemanticRoot` are fixed.

Public digest names `EvidenceGraphRoot` and `CEGRoot` were considered and
are not used in this version. Experiments and this draft say `SemanticRoot`.
A numbered KIP can rename the digest when it chooses an encoding. It must
not treat the research digest as a V5 state root in the meantime.

The following are outside KAR-1:

- discovering the vocabulary of `G`
- deciding that two natural-language phrases are the same concept, except
  where a declared anchor procedure already committed that decision into `V`
  or into the plan
- extracting claims from raw text at query time
- training, prompting, or evaluating a compiler
- asserting that a source is objectively true

Experiment 5 is the reason for this cut. It is recorded in section 6.

### 2.1 Normative binding

A node is `{ id }`. The identifier is unique in `V` and non-empty.

A relation is `{ id, from, relation, to }`. Both endpoints exist in `V`.
`relation` is a non-empty symbol. Relation identifiers are unique. The
symbol is not a frontier label. The plan's mapping `φ` assigns the symbol
to a frontier, or leaves it unmapped.

An evidence binding is:

```ts
type EvidenceBinding = {
  id: string;
  nodeId: string;
  evidenceId: string;

  requirements: string[];

  authority?: number;
  unauthorized?: boolean;

  validFrom?: string;
  validUntil?: string;

  provenance?: string;
};
```

`id` is a producer-assigned identifier, unique among bindings. It is not a
digest of the binding. `requirements` lists the requirement identifiers this
binding can satisfy. Authority, the unauthorized bit, and the validity
interval are the applicability record that sections 4.4's `A` and `T` refer
to. Omitted `authority` is not zero. Omitted interval endpoints are
unbounded on that side. `unauthorized: false` is omitted in the canonical
form. Timestamps are ASCII dates `YYYY-MM-DD`. Comparison is lexicographic
on that form, which matches calendar order.

The interval is half-open: `[validFrom, validUntil)`. A binding is
inapplicable when `unauthorized` is true, when the plan sets `minAuthority`
and authority is omitted or strictly below that minimum, when `asOf` is
earlier than `validFrom`, or when `asOf` is greater than or equal to
`validUntil`.

## 3. Inputs

A KAR-1 evaluation has four committed inputs.

| Input | Role |
| --- | --- |
| Knowledge Image `K` | Research evidence records `{ id, text }` and `KnowledgeRoot`. This is not a V5 image root. |
| Committed Evidence Graph `G` | The CEG in section 2, bound to `KnowledgeRoot`. |
| Proposition `q` | The query string the anchor is allowed to see. |
| Plan `Π` | Every field in section 3.1. There are no silent defaults. |

`QueryRoot = H(q)` and `PlanRoot = H(Π)`. A result that omits any root
required by section 4.6 is not a KAR-1 result.

The plan is part of the algorithm's trust boundary. Thresholds, depth, the
relation-to-frontier mapping, the bounds, and the anchor procedure are
chosen before the result is interpreted. Changing them changes `PlanRoot`
and therefore the certificate.

### 3.1 Plan fields

A missing field, a field of the wrong type, a negative bound, or an
inconsistent mapping yields `PLAN_INVALID`. The implementation does not fill
in a research partition or a default floor.

| Field | Meaning |
| --- | --- |
| `version` | `1`. |
| `anchor` | `{ mode: "recompute", procedure }` or `{ mode: "supplied", witness }`. |
| `frontierMap` | `φ`, a map from relation symbol to exactly one frontier label. |
| `depth` | Non-negative integer `h`. |
| `cardinalityBound` | Non-negative integer `K`. |
| `coverageMode` | `requirements` or `nonempty`. |
| `requirements` | Five arrays of requirement identifiers, one per frontier. |
| `floors` | Five decimal strings, one per frontier, each matching `^\d+(\.\d{1,6})?$`. |
| `profile` | `minimum-cover`, `minimum-cover-redundancy-v1`, or `exp1-lexicographic`. |
| `asOf` | ASCII date `YYYY-MM-DD`. |
| `minAuthority` | Integer, or `null` when authority is not required. |
| `bounds` | The seven limits in section 4.3. |
| `lexical` | `null`, or `{ frontier, evidenceIds }` whose digest therefore sits inside `Π`. |

Frontier labels are `F_S`, `F_O`, `F_Q`, `F_T`, and `F_A`. A symbol absent
from `frontierMap` is not traversable. A symbol assigned twice is
`PLAN_INVALID`. The same frontier may receive many symbols.

The experiment reports used one partition of a thirteen-symbol alphabet.
That partition is not a default of this algorithm. A plan that wants it
must write the assignments out. For the record, that historical partition
was: `supports`, `permits`, `requires`, and `equivalent` to `F_S`;
`prohibits` and `contradicts` to `F_O`; `qualifies` and `excepts` to `F_Q`;
`valid_before`, `valid_after`, `applies_to`, `supersedes`, and `overrides`
to `F_T`; nothing to `F_A`. `requires` does not necessarily support a
proposition. `equivalent` does not universally imply support. `overrides`
can matter to more than one ontology. KAR does not decide which. The plan
does, and only for the symbols it lists.

`F_A` has no special walk. Authority is satisfied from the binding fields in
section 2.1, and from requirement identifiers the plan places on `F_A`.

## 4. Algorithm

The normative procedure is the composition of pure functions. None of them
calls a model. None of them reads benchmark labels.

```text
(K, G, q, Π) → A_q → F(q) → S* → KARRoot
```

### 4.1 Resolve proposition anchors

```text
A_q = Anchor_Π(q, G)
```

`A_q` is a finite set of node identifiers. The verifier rejects the run with
`ANCHOR_REJECTED` unless `A_q ⊆ V`. The normalized set is still committed,
so an auditor can see what was proposed.

The plan selects one anchor mode.

- `recompute`. The plan names a pure procedure. The reference procedure
  `member-id-v1` tokenizes `q` on every character outside ASCII letters,
  digits, `_`, `:`, and `-`, and anchors each node whose identifier equals a
  token. The verifier runs that procedure. It is a conformance hook, not a
  semantic compiler. Another procedure is legal only when both the evaluator
  and the verifier implement it and the plan names it.
- `supplied`. The plan carries a witness, a list of `{ nodeId, queryTerm? }`.
  The verifier checks the node identifiers and does not re-infer concepts.
  This is the mode that lets a host ground `room` to a committed `lodging`
  node without pretending the grounding is part of KAR. Given that committed
  grounding, the guarantee is the frontier closure and the minimum evidence
  set.

An anchor that matches only an action, and not the entity the proposition is
about, is a legal procedure only when the plan names those nodes. It is not
implied by the default of this draft. Experiment 5 measured why an
action-only rule admitted an unrequested opposition document on every
negative-control query. The reference procedure does not do that, because it
matches node identifiers, not action words.

```text
AnchorRoot = H(AnchorCommitment)
AnchorCommitment = {
  mode,
  procedure,   // the named procedure, or null when supplied
  witness,     // normalized witness records, or null when recomputed
  nodes        // A_q sorted
}
```

Supplied records are sorted by `nodeId`, then `queryTerm`, and duplicate
records are kept. `nodes` is the unique sorted identifier set. Recompute
stores `procedure` and a null witness.

### 4.2 Typed frontiers

The plan defines `φ` from relation symbols to frontier labels. Closure does
not contain a second, hidden partition.

```text
F_S  support
F_O  opposition
F_Q  qualification
F_T  temporal applicability
F_A  authority and applicability
```

### 4.3 Frontier closure

Let `h` be the plan depth. Closure walks states `(node, frontier)`, not bare
nodes.

```text
C_0 = { (a, ⊥) : a ∈ A_q }
(v, f) --r--> (v', φ(r))
```

`⊥` is the anchor frontier and is not one of the five labels. The frontier
component `f` is replaced by `φ(r)`. The last traversed relation decides the
frontier of the arrival state. An earlier relation on the same path does not
leave a second membership, and it does not block the arrival label. A path

```text
claim --applies_to--> customer --contradicts--> clause
```

with `φ(applies_to) = F_T` and `φ(contradicts) = F_O` admits the clause's
evidence to `F_O` and does not admit it to `F_T` by this path. Another walk
that arrives through a different relation can still place the same evidence
identifier in another frontier.

Evidence is collected from the arrival state `(v', φ(r))`, from every
binding whose `nodeId` is `v'`. Bindings on an anchor state `(a, ⊥)` do not
enter a frontier. A producer that wants an anchored node to contribute
evidence gives it an admitting relation.

Search is breadth-first. Depth 0 is `C_0`. A state at depth `h` is not
expanded. A walk of length `h + 1` does not enter `F(q)`. Each layer is
expanded in order `(frontier, nodeId)`, with `⊥` before the named labels.
Outgoing traversable relations are tried in relation-identifier order. The
first time a state is reached is its canonical path: shortest, then the
smallest anchor and relation sequence produced by that order. Later paths to
the same state are ignored.

`φ(r)` is undefined when `r` is unmapped, and the edge is not traversable.
Unmapped edges do not count as closure edges.

The plan bounds are all required:

```text
maxAnchorNodes
maxClosureNodes
maxClosureEdges
maxFrontierEvidence
maxRequirementsPerFrontier
maxEvidenceBindings
maxCoverVisits
```

They are non-negative integers. Exceeding a closure bound yields
`CLOSURE_BOUND_EXCEEDED`, empty frontiers, an empty witness list, and an
empty evidence set. The implementation does not return a partial closure.
The bounds apply as follows.

| Bound | Failure |
| --- | --- |
| `\|E\| > maxEvidenceBindings` | `CLOSURE_BOUND_EXCEEDED` |
| a plan requirement list longer than `maxRequirementsPerFrontier` | `PLAN_INVALID` |
| `\|A_q\| > maxAnchorNodes` | `CLOSURE_BOUND_EXCEEDED` |
| a newly reached node would exceed `maxClosureNodes` | `CLOSURE_BOUND_EXCEEDED` |
| another traversable edge examination would exceed `maxClosureEdges` | `CLOSURE_BOUND_EXCEEDED` |
| another distinct evidence identifier in one frontier would exceed `maxFrontierEvidence` | `CLOSURE_BOUND_EXCEEDED` |
| cover examinations exceed `maxCoverVisits` | `SEARCH_BOUND_EXCEEDED` |

Anchor nodes count toward `maxClosureNodes`. `maxCoverVisits` is not a
closure bound.

If the plan names a lexical contributor, those evidence identifiers are
appended to the named frontier after the walk, in sorted order, and the
contributor is inside `Π`. An identifier with no binding is applicable, covers
no requirement identifier, and can satisfy `nonempty` mode only. An
identifier with bindings uses those bindings' requirements and applicability
on the named frontier. An unlisted lexical union is not a KAR-1 closure.
Appending past `maxFrontierEvidence` is `CLOSURE_BOUND_EXCEEDED`.

```text
F(q) = Closure_Π(G, A_q)
     = (F_S(q), F_O(q), F_Q(q), F_T(q), F_A(q))
```

Frontier identity is preserved. The closure does not sort these sets into one
score and does not drop a frontier because another frontier is larger.

`FrontierRoot` is the digest of the five sets, each sorted by evidence
identifier.

### 4.4 Frontier witnesses

Each pair `(evidenceId, frontier)` that closure or the lexical contributor
places in `F(q)` has one witness:

```text
evidenceId
frontier
anchorId
path: node, relation, node, ...
```

`path` is empty and `anchorId` is null for a lexical member. For a walked
member, `path` begins at the anchor node and then alternates the relation
identifier with the node it entered. `FrontierWitnessRoot = H(witnesses)`
over that list sorted by frontier, evidence identifier, then anchor
identifier.

`FrontierWitnessRoot` is part of the emitted result and the verifier
recomputes it. It is not an input to `KARRoot` in this version. The eight-field
certificate in section 4.6 stays stable. A result whose witness root does not
match the recomputed closure fails verification even though stripping the
witness would not change `KARRoot`. Implementations must emit the witness.

### 4.5 Minimum sufficient evidence cover

Let `U_q` be the set of evidence identifiers that are applicable and that
belong to at least one frontier. A candidate set `S` satisfies `S ⊆ U_q` and
`|S| ≤ K`.

Coverage uses only identifiers committed on bindings or, for `nonempty` mode,
frontier membership.

- Mode `requirements`. A requirement is covered when `S` contains an
  applicable evidence identifier that lists that requirement on a binding
  admitted to that frontier. Coverage is the covered count divided by the
  required count. An empty requirement list has coverage 1.
- Mode `nonempty`. Coverage of a frontier is 1 when `S` contains at least
  one applicable member of that frontier, and 0 otherwise. A floor of 0 does
  not constrain the frontier. A positive floor requires coverage 1.

Benchmark fact identifiers that are absent from `G` and from `Π` are not
requirements. Experiment 1's oracle used fixture labels. That oracle remains
an evaluation instrument. It is not this function.

Floors are decimal strings. A floor `floor` passes when
`covered * 1000000 >= floorMicros * required`, where `floorMicros` is the
floor scaled by `1000000` with no floating-point rounding. Required count 0
passes. The same integer rule is mandatory for TypeScript and Rust.

`S` is feasible when every frontier passes its floor.

The normative profile `minimum-cover` ignores redundancy. Among feasible
sets it selects the unique set that minimizes cardinality and then is the
lexicographically smallest sorted evidence-identifier sequence:

```text
S* = argmin_(S in feasible) ( |S|, CanonicalIDs(S) )
```

If no feasible set exists, the status is
`UNSATISFIED_EVIDENCE_REQUIREMENTS` and the emitted set is empty. The
procedure does not substitute a top-k list. A cardinality bound that excludes
every feasible set is this status, not a search failure.

Among applicable evidence identifiers with the same requirement mask, a
`minimum-cover` result contains at most one, and it is the lexicographically
smallest identifier in that mask group. The mask is the sorted set of
`(frontier, requirementId)` pairs the identifier can satisfy, and in
`nonempty` mode the frontiers where it is an applicable member.

Exact search examines combinations in increasing size and, within a size, in
lexicographic identifier order. Each combination increments the visit count.
If the count would exceed `maxCoverVisits` before the decision is proven, the
status is `SEARCH_BOUND_EXCEEDED` and the set is empty. The profile name
`minimum-cover` is not applied to an approximate set.

Profile `minimum-cover-redundancy-v1` breaks ties after cardinality by the
mean pairwise token-set Jaccard of evidence texts, then by the identifier
sequence. It is not the default. Its tokenizer is ASCII: bytes `A-Z` fold to
`a-z`, and any byte outside `0-9`, `A-Z`, and `a-z` is a separator. A set of
size 0 or 1 has redundancy 0. Jaccard of two empty token sets is 1, matching
the Experiment 1 helper. The decision records redundancy as a reduced
rational. This profile may not discard every non-smallest member of a mask
group, because a different member can change the rational. It still returns
an empty set on `SEARCH_BOUND_EXCEEDED`.

Profile `exp1-lexicographic` is the reproduction profile. Among sets that
already meet the floors and the cardinality bound, it prefers higher covered
counts in the order `F_O`, `F_S`, `F_Q`, `F_T`, `F_A`, then smaller
cardinality, then the lexicographically smaller identifier sequence. It does
not claim minimum cardinality. It does not read labels that are absent from
`G` and `Π`.

`EvidenceSetRoot` digests the chosen identifiers in sorted order, each with
the sorted frontier labels it was allowed to satisfy. `DecisionRoot` digests
the status, the profile name, the cardinality, and the five coverage pairs
`{ covered, required }`. The redundancy rational is included only for
`minimum-cover-redundancy-v1`.

### 4.6 Commit the derivation

```text
KARRoot = H(
  KnowledgeRoot,
  SemanticRoot,
  QueryRoot,
  PlanRoot,
  AnchorRoot,
  FrontierRoot,
  EvidenceSetRoot,
  DecisionRoot
)
```

The preimage is one object with those eight fields. `FrontierWitnessRoot` is
emitted beside it and verified, and it is not inside this hash.

A verifier recomputes closure, witnesses, and the cover from `K`, `G`, `q`,
and `Π`. It accepts the result only when every root matches, including the
witness root. A mismatch is a failed verification, not a weaker pass.

One hundred repeated query-time evaluations over a frozen artifact produced
0 mismatches in Experiments 4 and 5. That property is a conformance
requirement in section 9, not a sample we treat as optional.

## 5. Decision statuses

| Status | Emitted set | Meaning |
| --- | --- | --- |
| `SATISFIED` | the chosen `S*` | Every required floor was met inside `F(q)`. The proposition is not thereby true. |
| `UNSATISFIED_EVIDENCE_REQUIREMENTS` | empty | No feasible set exists under `Π`. The proposition is not thereby false. |
| `SEARCH_BOUND_EXCEEDED` | empty | Exact cover stopped at `maxCoverVisits`. Frontiers already computed stay in the result. |
| `CLOSURE_BOUND_EXCEEDED` | empty | A closure bound in section 4.3 fired. Frontiers and witnesses are empty. |
| `ANCHOR_REJECTED` | empty | `A_q` was not a subset of `V`. `AnchorRoot` still commits the proposal. |
| `GRAPH_NOT_BOUND` | empty | `G.knowledgeRoot` differs from `KnowledgeRoot(K)`, or an evidence identifier does not resolve in `K`. |
| `GRAPH_INVALID` | empty | `G` violates section 2. |
| `PLAN_INVALID` | empty | The plan's fields, partition, or bounds are inconsistent. |

`SATISFIED` does not mean the proposition is true. It means the declared
floors were met by the chosen set inside `(K, G, q, Π)`.
`UNSATISFIED_EVIDENCE_REQUIREMENTS` does not mean the proposition is false.

## 6. What the five experiments support

Numbers below are the published experiment reports. This draft does not
recompute them and does not edit the runner labels. The historical semantic
roots in those reports hash the experimental artifact alone. They are not
instances of `SemanticRoot = H(KnowledgeRoot, G)`.

| Experiment | Report | Result that KAR-1 uses |
| --- | --- | --- |
| 1. Evidence-set selection | `experiments/kar-theory/KAR_THEORY_REPORT.md` | On 160 adversarial instances at K = 5, raw top-k dual success is 31.3% and production MMR is 68.8%. The label-aware oracle over the lexical pool is also 68.8%. The same oracle over the whole corpus is 100%. Where top-k fails and the ceiling succeeds, top-k averages 4.73 passages and 4.5% opposition coverage; the oracle averages 2.45 passages and covers the required frontiers. Opposition recall at depth 50 is 78.1% and does not rise at depth 100. Qualifier recall is 50%. Passages that never score cannot be selected. Review label: promising, blocked on discovery. The harness label `GO` was overridden in that report. |
| 2. Blind frontier discovery | `experiments/kar-frontier/FRONTIER_DISCOVERY_REPORT.md` | Query-time cues and morphology do not discover disconnected opposition. The union reaches 84.4% adversarial opposition and leaves scenario D at 0%. Qualifier recall stays 50%. |
| 3. Activation of the existing claim graph | `experiments/kar-activation/RELATIONSHIP_ACTIVATION_REPORT.md` | Blind anchors stay at 78.1% opposition, 50% qualifier, and 0% on scenario D. The all-edges ceiling, which is not an anchor, reaches scenario D opposition 100% and qualifier recall 72.5%. Unanchored closure also admits the unrequested contradiction on the 500-document negative corpus. Stored edges are not usable until an anchor enters the right region, and entering every region fails the damage bound. |
| 4. Committed semantics | `experiments/kar-semantics/COMMITTED_SEMANTICS_REPORT.md` | A frozen compiler with a general lexicon, then deterministic frontier retrieval, reaches holdout opposition 90%, qualifier 85%, temporal 100%, and scenario D opposition 100%, with support unchanged and damage 0. The development qualifier gate stays at 50% because those qualifier sentences were outside the frozen vocabulary. In-lexicon holdout rows are 100%. Stress rows are 0%. Query-time mismatches are 0 over 200 runs. The semantic root is stable across two builds and a reload. Runner label: `SEMANTIC_LAYER_PROMISING_BUT_BLOCKED`. The blocked gate is vocabulary coverage, not replay. |
| 5. Vocabulary-independent compilation | `experiments/kar-generalization/SEMANTIC_GENERALIZATION_REPORT.md` | The tested dual-anchor contract scores holdout opposition 0% and qualifier 0%, with support 100%, lexicon-control opposition 0%, dual-anchor damage 0%, and action-only opposition damage 100%. Entity-only opposition is 18.3%. Action-only opposition is 1.7%. Query-time mismatches are 0. Median artifact size is 3181 bytes. Runner label: `GENERALIZATION_NOT_SHOWN`. |

Experiment 5's runner label stands for the contract that was scored: entity
hit and action hit together, on that benchmark, did not meet the
pre-registered recall gates. The frozen model outputs do not support a
stronger claim that build-time interpretation produced nothing.

The committed claim for "The lodging stays committed through the prepaid
season." is a prohibition whose action aliases include `cancel`, `end`,
`finish`, `stop`, and `terminate`, and whose entity aliases are
`accommodation`, `lodging`, and `stay`. The query token `cancel` matches the
action side. The query token `room` matches none of the entity aliases. The
dual-anchor rule discards the claim. The committed claim for "The impeller is
still mounted through the prepaid season." includes the entity alias `pump`
and the action aliases `cease`, `end`, `halt`, and `stop`. The query verb is
`cancel`. Each side generalizes in one of these two rows, and the
intersection misses both. That is a grounding mismatch between the query and
`V`, which section 4.1 allows the plan to supply. It is not a failure of
frontier replay.

The qualifier sentences in that benchmark, such as "Holders of the lodging
from the north intake retain the former limit.", do not say what the former
limit is, that it concerns cancellation, or that it modifies the queried
right. The compiler's recorded reading is entity `lodging`, action `retain`,
relation `equivalent`. Across the run, the experimental artifact contains
473 `prohibits` relations, 11 `permits` relations, 508 `equivalent`
relations, and no `qualifies` relations. A 0% qualifier score on that set is
not evidence against committed frontier retrieval. Several opposition rows
have the same defect: an impeller that remains mounted does not, by itself,
state that a pump cannot be cancelled. The generator knew the pairing. The
document does not. For the KAR thesis, Experiment 5 is inconclusive about
semantic generalization. It is conclusive that a damage-safe retrieval rule
needs some binding narrower than "any ending verb," and that the replay path
around a frozen artifact holds.

No sixth retrieval experiment is required to state this draft. A later
measurement of compilers would be a compiler measurement. It would not amend
sections 4.3 through 4.6.

## 7. Architecture

```text
host producer  ->  G bound to K  ->  SemanticRoot
                                    |
K, q, Π, G  ->  Anchor  ->  Closure  ->  Minimum cover  ->  KARRoot
                |            |              |
                A_q          F(q)           S* or abstain
                AnchorRoot   FrontierRoot
                             FrontierWitnessRoot
```

The host producer is replaceable. The lower row is KAR-1. Evidence Gate
remains a separate product boundary: it checks claims in a proposed answer
against a declared image, policy, and time. KAR-1 selects an evidence set and
a sufficiency decision. A later integration may hand `S*` to Evidence Gate.
This draft does not define that handoff and does not change
`@knolo/evidence-gate`.

Lexical retrieval stays the way a plan gathers a named frontier when the plan
says so. It is not the opposition procedure. Experiments 2 and 3 are the
measurements behind that sentence.

### 7.1 Implementation design

The reference implementation is a pure function over fixture graphs. It lives
in `research/kar-1/`, outside `packages/core` public exports and outside the
npm workspaces. It does not write `SemanticRoot` or `KARRoot` into a V5
state root.

| Module | Responsibility |
| --- | --- |
| `graph` | Parse and reject a `G` that violates section 2. Recompute `KnowledgeRoot` and require the binding. |
| `anchor` | Run `member-id-v1`, or accept a supplied witness. |
| `closure` | Compute `F(q)` as states `(node, frontier)` within the plan bounds. |
| `cover` | Run the named profile and return a status. |
| `canonicalize` | Emit the research digest bytes in section 8. |
| `verify` | Recompute every root, including `FrontierWitnessRoot`, and compare. |

Determinism rules for that code:

- sort every set by identifier before hashing
- do not depend on object key insertion order
- do not call the network or a model
- put no floating-point numbers in a hashed object
- treat a closure-bound overflow as `CLOSURE_BOUND_EXCEEDED`
- treat a visit-limit overflow as `SEARCH_BOUND_EXCEEDED`
- keep frontier arrays separate through the cover

A Rust verifier in `research/kar-1/rust/` recomputes the same roots. It is
not `packages/core-rust` and it does not link the V5 runtime.

A production port, if one is later specified by a numbered KIP, has to
replace the research JSON digest with the encoding that KIP chooses and has
to ship conformance vectors. Until that KIP exists, the research digest is
the one implementations of this draft must match.

### 7.2 Relationship to current Knolo

V5 already commits image bytes, object identity, canonical digests, query
plans, and receipts under KIP-0001, KIP-0002, KIP-0003, and KIP-0007. KAR-1
adds a semantic root and a frontier certificate beside those roots. It does
not replace BM25, MMR, EQL, or the claim graph inside the image. Experiment 3
showed that the current claim-graph edges, walked from query tokens, do not
implement this algorithm.

## 8. Research digests

V5 digest domains are listed in KIP-0003. This draft does not add to that
list. Proposed domain names, not registered by this draft:

```text
kar-semantic, kar-query, kar-plan, kar-anchor,
kar-frontier, kar-evidence, kar-decision, kar
```

Research artifacts use canonical JSON. Objects have keys sorted by UTF-16
code units. Arrays keep the order defined by this draft, which is sorted
identifier order for every set that is hashed. Strings use JSON escaping and
do not escape solidus. The only numbers in a hashed object are integers,
written in base 10 without a fraction or an exponent. Optional fields that
are absent are omitted, not encoded as null. The digest string is `sha256-`
plus lowercase hexadecimal of the SHA-256 of the canonical UTF-8 bytes.

`KnowledgeRoot(K)` hashes `{ version: 1, evidence }` after sorting evidence
by identifier. The stored root is not part of that preimage. `H(q)` hashes
the proposition as a JSON string.

The Experiment 4 and Experiment 5 artifact roots remain historical fixtures
of those experiments. Experiment 4 instance A-00 is
`sha256-544d8cd420e7509e8365a97376ba0cc27d69e78f07f8aa10516b8c0224539fed`.
Experiment 5 instance D-clinic-visits-00 is
`sha256-6784984ed1d3f9f648a45f9d91396bbc3d674b4df2615817608cc0f10286f3f6`.
They were computed as `H(experimental artifact)` without a knowledge-root
pair. Reproducing them is not a conformance test of section 4.6.

Until a numbered KIP registers domains, verifiers of this draft use the
research JSON digest and must refuse to treat it as a V5 state root.

## 9. Conformance requirements

These are tests of an implementation of sections 4 and 5. They are not a new
scientific benchmark and they do not ask a compiler to invent a vocabulary.
The vectors live under `research/kar-1/`. A conformance run that calls a
model has left this specification.

1. Replay. For a fixed `(K, G, q, Π)`, two evaluations produce the same
   status, the same `S*`, and the same `KARRoot`. Repeating the query-time
   half at least 100 times produces 0 mismatches.
2. Abstain. When the opposition floor is positive and `F_O` is empty, the
   status is `UNSATISFIED_EVIDENCE_REQUIREMENTS` and `S*` is empty.
3. No top-k fallback. A fixture whose lexical list contains the support
   documents and whose graph omits a required opposition document abstains
   when the opposition floor is unmet. It does not return the lexical list.
4. Minimality. For every `SATISFIED` result under `minimum-cover`, no proper
   subset of `S*` meets the floors.
5. Mask economy. Two applicable bindings with the same requirement mask do
   not both appear in `S*`. The survivor is the lexicographically smaller
   evidence identifier.
6. Frontier separation. A binding admitted only by an opposition relation is
   not treated as support coverage.
7. Anchor binding. A fixture with two nodes that share a relation symbol
   admits only the node named by the supplied anchor. A wider witness is a
   different plan and must show the extra admission.
8. Supplied anchor. A witness that points outside `V` yields
   `ANCHOR_REJECTED` and still commits `AnchorRoot`. A witness inside `V`
   reproduces the closure of that witness.
9. Depth. Increasing `h` is a different plan. A walk of length `h + 1` does
   not enter `F(q)` for a plan whose depth is `h`.
10. Lexical union. Support that enters only through a lexical contributor
    disappears when that contributor is removed from `Π`, and `PlanRoot`
    changes.
11. Damage shape. On a fixture where two nodes share an action-like relation
    symbol, a supplied anchor for one node does not admit the other node's
    evidence. This records the Experiment 5 binding lesson without a compiler.
12. Visit bound. A plan with `maxCoverVisits` below the search size returns
    `SEARCH_BOUND_EXCEEDED` and an empty set. Frontiers remain available.
13. Root stability. Reordering object keys and re-hashing yields the same
    `SemanticRoot`. The historical experiment digests in section 8 stay
    citations. They are not expected outputs of `H(KnowledgeRoot, G)`.
14. Anchor commitment. `AnchorRoot` changes when the supplied witness
    changes, including when a query term changes and the node set does not.
15. Image binding. A copied graph whose `knowledgeRoot` differs from `K`
    yields `GRAPH_NOT_BOUND`.
16. Closure bound. A graph wider than `maxClosureEdges` or
    `maxFrontierEvidence` yields `CLOSURE_BOUND_EXCEEDED` and empty
    frontiers, not a prefix of the closure.
17. Explicit mapping. An unmapped relation is not traversed. Omitting
    `frontierMap` yields `PLAN_INVALID`. The implementation must not insert
    the historical partition.
18. Last-edge frontier. A two-step path whose relations map to `F_T` and then
    `F_O` places the arrival evidence only in `F_O`.
19. Witness. The witness for that arrival names the anchor, both relation
    identifiers, and the intermediate node. `FrontierWitnessRoot` matches a
    second implementation of the same walk.
20. Default objective. `minimum-cover` selects the smaller set when one
    feasible set has lower token overlap and a larger cardinality. The
    redundancy profile is selected only when the plan names
    `minimum-cover-redundancy-v1`.
21. Exhaustive agreement. On randomly drawn graphs whose candidate count is
    at most 8, `minimum-cover` matches an independent enumeration of every
    feasible subset.
22. Verifier parity. The Rust verifier recomputes every root in the
    conformance vectors. Any mismatch fails.

## 10. KIP draft structure

A future numbered KIP can promote this draft. This section is the skeleton.
It does not assign the number. KIP-0027 is the last numbered V5 contract in
`spec/README.md`. The Evidence Gate plan has already reserved the idea of a
later evidence-gate KIP. KAR must not take that number by implication.

Suggested title: Frontier-constrained evidence retrieval, KAR-1.

Suggested status line: Draft. Not part of the V5 foundation. No state-root
domain is registered.

Sections a numbered KIP would need:

1. Status, non-goals, and the compiler boundary in section 2 of this draft.
2. Normative CEG header, the binding object in section 2.1, and the
   requirement that `G.knowledgeRoot` equals the image root.
3. Plan fields and the rule that an absent field is `PLAN_INVALID` rather
   than a silent default. `φ` is required. No historical partition is
   implied.
4. Anchor modes `recompute` and `supplied`, and `AnchorRoot`.
5. State closure `(node, frontier)`, last-edge frontier identity, witnesses,
   and the closure bounds.
6. Coverage modes and the `minimum-cover` objective without redundancy.
7. Status codes in section 5, including `CLOSURE_BOUND_EXCEEDED` and
   `GRAPH_NOT_BOUND`.
8. One canonical encoding, chosen there, with domain-separated digests if
   KIP-0003 is amended on purpose.
9. The verifier algorithm and the byte layout of `KARRoot`.
10. Conformance vectors, shared by each runtime that claims the KIP.
11. The relationship to Evidence Gate: KAR selects `S*`; the gate may later
    consume it; neither redefines the other in that KIP's first version.
12. The relationship to KIP-0007: an EQL plan is not a KAR plan unless it
    carries the fields in section 3.
13. A claim-boundary appendix equivalent to section 11 of this draft.

Non-goals for that KIP:

- a required semantic compiler
- a query-time model
- a change to BM25 or MMR behavior when no KAR plan is requested
- a statement that abstention is global absence
- a statement that `SATISFIED` means the proposition is true
- patent claim text

## 11. Claim boundary

This section is an engineering record for later prior-art review. It is not
legal advice, not a patent application, and not a statement of novelty or
freedom to operate. No claim should be drafted from this section until that
review exists. The text below says what the experiments measured and what
they did not.

Supported as technical statements about these experiments:

- A minimum evidence set under explicit coverage floors can satisfy a
  dual-evidence objective that top-k ranking does not satisfy, once the
  required passages are in the candidate universe. Experiment 1.
- Raw counter-query rewriting and blind activation of the current lexical
  claim graph do not reliably discover disconnected opposition. Experiments 2
  and 3.
- If the relevant relationships are already committed in `G`, deterministic
  query-time closure can retrieve disconnected opposition and keep a stable
  artifact digest. Experiment 4, inside the frozen vocabulary, with the
  development qualifier gate unmet.
- A frozen build-time model can emit a prohibition and ordinary ending verbs
  for a persistence sentence that does not contain those verbs, and can emit
  an entity alias that meets a query noun on some other row. The tested
  intersection of those two checks still scored 0 on the Experiment 5
  holdout. Action-only use of the ending verbs admitted unrequested
  opposition on every negative-control query.
- Replay of query-time activation over those frozen artifacts produced 0
  mismatches, and the experimental artifact digests reproduced across rebuild
  and reload.

Not supported, and not available as a statement in a claim draft from this
record:

- that KAR, or Knolo, finds all relevant evidence in a corpus
- that abstention means the proposition is unsupported in the world
- that `SATISFIED` means the proposition is true
- that a model compiler generalizes across unseen wording well enough to be
  the normative anchor
- that the Experiment 5 qualifier score measures qualification understanding
- that typed edges, aliases, or reverse walks are each independently
  necessary; Experiment 4's single-feature ablations did not move the score,
  and removing aliases and reverse traversal together did
- that the historical relation-to-frontier partition is the meaning of those
  English words
- that the current production claim graph already implements KAR
- novelty, inventive step, or freedom to operate relative to prior retrieval,
  question-answering, citation, or certificate systems

## 12. Parameters left to the plan

These are intentionally not frozen as constants. Each one must appear in
`Π` or the plan is invalid. The implementation does not supply them.

- the anchor procedure and its mode
- `φ`, the assignment of traversable symbols to frontiers
- `h`, `K`, and every bound in section 4.3
- the floors `τ_S`, `τ_O`, `τ_Q`, `τ_T`, and `τ_A`
- the coverage mode
- the profile, including whether redundancy is used
- whether a lexical contributor is included, and on which frontier

Freezing any of them inside the algorithm would hide a choice that changes
the certificate. Experiment 4 is the existence result for one plan over one
family of graphs. It is not a universal setting of these parameters.
