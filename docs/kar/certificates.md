# KAR certificates

A KAR certificate is the frozen `kar-1-research-1` result. The experimental API wraps it in `evaluation.certificate` and adds resolved evidence beside it. The wrapper is not a new semantics version.

## Roots

| Root | What it commits |
| --- | --- |
| `knowledgeRoot` | Frozen projection `{ version: 1, evidence }` sorted by id. Not the V5 `stateRoot`. |
| `semanticRoot` | `{ knowledgeRoot, graph }` for a valid CEG. An invalid graph uses a distinct invalid digest. |
| `queryRoot` | The proposition as a JSON string. |
| `planRoot` | The plan object as supplied, before normalization. |
| `anchorRoot` | Anchor mode, procedure, witness, and the sorted anchor node set. |
| `frontierRoot` | The five frontier membership lists. |
| `frontierWitnessRoot` | Witnesses sorted by frontier, evidence id, and anchor id. |
| `evidenceSetRoot` | The selected choices. |
| `decisionRoot` | Status, profile, cardinality, coverage, and redundancy when present. |
| `karRoot` | `knowledgeRoot`, `semanticRoot`, `queryRoot`, `planRoot`, `anchorRoot`, `frontierRoot`, `evidenceSetRoot`, and `decisionRoot`. |

`frontierWitnessRoot` is emitted and verified. It is not an input to `karRoot`. That split is frozen.

Canonical JSON sorts object keys by UTF-16 code units, preserves array order, does not escape solidus, and uses only integers inside hashed objects. The digest is `sha256-` plus lowercase hex.

## What verification checks

`verifyKar` remounts the image bytes, rebuilds indexes itself, and recomputes the certificate. It then compares:

- the certificate bytes, including every root;
- when the claimed value is an evaluation, the image identity, selected evidence, frontiers, witnesses, status, and API code.

There is no uncommitted field on the certificate. Changing `version`, status, evidence ids, choices, frontiers, witnesses, the decision, any root, or adding a field changes the canonical certificate and verification rejects it.

These evaluation fields are outside `karRoot` and are still checked when they are present on the claimed object:

- `image.stateRoot`, `image.knowledgeRoot`, `image.objectRoot`, `image.commitDigest`
- `selectedEvidence` text, source, and metadata
- the copy of `proposition` and the validated `plan`
- `code`

`inspectKarComplexity` output is not part of the certificate and is not verified. It is advisory.

## Abstention

On `UNSATISFIED_EVIDENCE_REQUIREMENTS` the frozen decision records covered 0 on every frontier, including frontiers that have members. The explainer reports both that zeroed coverage and the populated frontier list. The selected set is empty. KAR does not fill the gap with a top-k list.

## Tamper

A change to the image bytes, the sidecar binding, the plan, the proposition, or any committed result field fails verification. Randomized single-field mutations are part of the phase 7 suite. The expected number of accepted tampered certificates is 0.
