# KITE

KITE is an optional deterministic layer beside Cortex and KAR. Import it
from `@knolo/core/kite`. The root `@knolo/core` entry does not load it.

Cortex discovers evidence. KAR decides whether declared evidence
requirements were met. KITE checks a finite contract, names the obligations
that are still open, and tests only the changes the contract allows.

A KITE verdict describes that contract. It does not describe universal
real-world truth. It does not replace Cortex statuses `ANSWERED`,
`PARTIAL`, and `INSUFFICIENT_EVIDENCE`. `SATISFIED` remains a KAR word.
`InvarianceRoot` commits the KITE inputs. It does not replace a V5
`stateRoot` or a `KARRoot`.

Core does not call a model. The host owns any model.

## Verdicts

| Verdict                | Meaning                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `WARRANTED_IN_SCOPE`   | Support is closed, and every declared alternative agrees                                                              |
| `SUPPORTED_OPEN_WORLD` | Support exists, and a completeness or counterfactual obligation is still open                                         |
| `REFUTED_IN_SCOPE`     | Explicit evidence, or a signed completeness declaration, supports the negation, and every declared alternative agrees |
| `CONFLICTED`           | Admitted evidence supports incompatible conclusions                                                                   |
| `UNDERDETERMINED`      | A required record or applicability fact is missing                                                                    |
| `BOUND_EXCEEDED`       | The search did not finish. This is not a certificate                                                                  |

A missing record is not a denial. A negative conclusion needs explicit
opposing evidence, or a signed completeness declaration for that absence.

## Check and replay

`evaluateKite` is the phase-1 obligation check. It returns met and unmet
obligations and does not emit a verdict.

`createKiteSession` and `evaluateKiteSession` add rules, completeness
declarations, and declared changes. `verifyKiteCertificate` mounts the
image again and recomputes the derivation. A stored hash that matches a
stored hash is not verification.

The Rust crate and the Python package replay the same derivation from a
`knolo-kite-world-1` snapshot. They do not search the image. The ICP canister
methods stay the pack, search, and health calls. The CLI template copies the
Rust sources so that crate still builds. Rust and the ICP canister stay
5.5.1. Python is 5.6.0. This tree's `@knolo/core` package file is 6.2.3. npm
`latest` is 6.2.3.

From a checkout, after building core:

```bash
node examples/kite-policy/run.mjs
node conformance/kite/v1/run.mjs
```

`knolo kite evaluate` and `knolo kite verify` are in npm `latest`
`@knolo/cli@6.2.9`. Published `@knolo/cli@6.2.5` does not include them.

A mount opts in with an empty `kite` object. `@knolo/mcp`, `@knolo/ai-sdk`,
`@knolo/mastra`, and `@knolo/openai-agents` then expose `knolo_kite_evaluate`
and `knolo_kite_verify`. The image is the pinned mount. The arguments match
the CLI: contract, rules, and the optional completeness, changes, bounds,
graph, question, and `asOf`. Verify also takes the certificate. A caller may
lower a bound and may not raise one. `BOUND_EXCEEDED` returns no certificate.
The tools do not call a model. A mount without `kite` keeps the previous tool
list.
The [pre-publish check](PREPUBLISH.md) records the local test run. It is not
an npm publish.

## Boundaries

The search budget starts at 5000 graph nodes, 2048 variants, 2
counterfactual changes, and 64 retrievals. A caller may lower a bound.
A caller may not raise it. An unfinished variant search returns
`BOUND_EXCEEDED` and no certificate.

No public novelty claim is made here. A patent search and a search of
non-academic systems are still required before any such sentence.
