# Verification

`verifyKar` mounts the Knowledge Image bytes, reads the sidecar, and recomputes the certificate.

```ts
import { verifyKar } from '@knolo/core/kar';

const verification = verifyKar({ image, graph, proposition, plan, result });
```

`verification.ok` is true only when the recomputed certificate matches `result`. The check accepts an evaluation object or the inner certificate. It does not accept a live session. Abstention can verify. `SATISFIED` is not required.

## What verification establishes

- the same committed image identity used for the run
- the same committed graph
- the same proposition
- the same plan
- the same anchor commitment
- the same frontier result
- the same selected evidence
- the same decision

The roots in that certificate are:

| Root | What it commits |
| --- | --- |
| `KnowledgeRoot` | The frozen research projection of the evidence text |
| `SemanticRoot` | `H(KnowledgeRoot, G)`, the committed graph bound to that projection |
| `QueryRoot` | The proposition |
| `PlanRoot` | The declared plan |
| `AnchorRoot` | Anchor mode, procedure or supplied witness, and sorted node ids |
| `FrontierRoot` | The frontier membership after closure and applicability |
| `FrontierWitnessRoot` | The witness paths. It is verified and is not an input to `KARRoot` |
| `EvidenceSetRoot` | The selected evidence ids |
| `DecisionRoot` | Status, profile, cardinality, and coverage |
| `KARRoot` | `H(KnowledgeRoot, SemanticRoot, QueryRoot, PlanRoot, AnchorRoot, FrontierRoot, EvidenceSetRoot, DecisionRoot)` |

V5 `stateRoot` is reported beside these roots. It is not `KnowledgeRoot`.

## What verification does not establish

- real-world truth of the source text
- correctness of an author's statements
- completeness of evidence outside the committed image
- that a Domain Pack extracted the right relations
- that `SATISFIED` means the proposition is true
- that `UNSATISFIED_EVIDENCE_REQUIREMENTS` means the proposition is false

Tamper checks fail closed. A changed root, a changed manifest, or a changed dossier sentence returns a non-zero CLI status and a stable code.

`verifyKarCoverage` uses the same rule for a coverage report. It remounts the image, recomputes every case, and compares the manifest, the report, and the optional rendering. `CoverageRoot` is checked and is not an input to `KARRoot`. A gap row can verify. See [Evidence coverage](coverage.md).

Public vectors: [conformance/kar/v1](../../conformance/kar/v1/README.md) and [conformance/kar/coverage-v1](../../conformance/kar/coverage-v1/README.md).

A composition record can cite `KARRoot`. It is not an input to `KARRoot`, `KnowledgeRoot`, or `stateRoot`. `statement: used` on an attestation means an evaluation ran. See [Composition](../composition/README.md).

Research oracle, including the Rust verifier:

```bash
cd research/kar-1 && npm test
cargo test --manifest-path research/kar-1/rust/Cargo.toml --offline
```

The Rust crate `kar1-research` checks `research/kar-1/fixtures/expected.json`. It does not execute the V5 public vectors. Those vectors run in TypeScript.
