# KITE synthetic fixture review

This is the review record for the synthetic KITE fixtures. It is not a
measurement against dense RAG, GraphRAG, or agentic retrieval. Those
comparisons are not in this repository. It is not a claim that the
technique is new, and it is not a claim about a customer corpus.

The labels below are the expected verdicts for the fixtures in
[conformance/kite/v1](../../conformance/kite/v1/README.md). The runner
fails when a verdict or `InvarianceRoot` changes.

| Fixture         | Expected verdict     | Why                                                                                                          |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| undetermined    | `UNDERDETERMINED`    | Policy and exception are present. The required approval is missing                                           |
| explicit-refute | `REFUTED_IN_SCOPE`   | The policy is present and the exception is not                                                               |
| warranted       | `WARRANTED_IN_SCOPE` | Exception and approval are present, the completeness declaration is signed, and no declared change disagrees |
| conflict        | `CONFLICTED`         | Policy, exception, and approval are all present                                                              |
| bound           | `BOUND_EXCEEDED`     | Two declared changes do not fit in a one-variant budget. There is no certificate                             |

The unit tests also check that a signed absence can refute, an unsigned
absence cannot, a single retracting change removes `WARRANTED_IN_SCOPE`,
the enumerated worlds are the full subset lattice, a tampered certificate
fails verification, and an incremental delta matches a full recomputation.

A human review of a real corpus is not part of this record.
