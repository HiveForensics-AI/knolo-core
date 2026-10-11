# Limitations

KAR retrieves inside one committed Knowledge Image and one Committed Evidence Graph. It does not search the open web, and it does not invent missing evidence.

## Status is not truth

`SATISFIED` means the declared evidence requirements were met by the selected set. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means they were not met. Neither status says the proposition is true or false. Other statuses (`SEARCH_BOUND_EXCEEDED`, `CLOSURE_BOUND_EXCEEDED`, `ANCHOR_REJECTED`, `PLAN_INVALID`, `GRAPH_NOT_BOUND`, `GRAPH_INVALID`) mean the evaluation did not decide the requirements. Abstention is a result, not an exception.

## Semantic production is not validated

Initial V6 Domain Packs assist semantic production but require review before committing semantics. Human gold for automatic relation commitment is incomplete. Relation-producing automatic extraction is not human-validated. An empty automatic prediction set is not 100% precision. Relation-producing rules in the bundled v4 packs are not `AUTO_ACCEPT`.

`AUTO_ACCEPT` may commit a proposal that the pack marks as safe to commit, such as a heading used only as context. `NEEDS_REVIEW` waits for a person. `OBSERVATION_ONLY` stays out of the committed relation graph. A regex match is not, by itself, committed semantics.

KAR itself evaluates an already committed CEG deterministically and does not depend on automatic semantic extraction. KAR does not change when a pack changes. The committed graph is the input. A hand-authored graph, a reviewed producer graph, an ontology graph, and a model-assisted graph are the same kind of input once `compileCegSource()` emits the sidecar.

## Bounds

Exact cover is bounded by `maxCoverVisits`. Past that bound the status is `SEARCH_BOUND_EXCEEDED` and the selected set is empty. Closure past `maxClosureNodes` returns `CLOSURE_BOUND_EXCEEDED`. There is no approximate fallback. Long pathological graph chains can be expensive.

## Verification

Verification replays the committed inputs. It does not establish real-world truth, author correctness, or evidence that was never committed. See [Verification](verification.md).

## Packaging

The public conformance vectors run in TypeScript on V5 images. The Rust verifier reproduces `research/kar-1` fixtures. It does not execute those V5 vectors.

`@knolo/core` npm packages publish `dist` only. `conformance/kar/v1` stays in the repository. `knolo kar conformance` finds it by walking up from the checkout. An installed CLI without the repository cannot see those files.

Domain Pack maturity is catalog metadata. It is not inside `DomainPackRoot` and it is not a field of `kar-distribution-1`.
