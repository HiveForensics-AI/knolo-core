# V5-to-V6 handoff decision

**Date:** 2026-09-01

**Decision:** Conditional readiness; keep V6 implementation deferred until the
external V5 release gates close.

**Current release:** V5.1.0 release candidate; V5.0.0 is already live
**Reviewed input:** local `docs/v6/Knolo_V6_CESR_Implementation_Specification.docx`

## Decision

The V5 implementation phases are complete locally. V5 remains the release
surface for the current branch, and the uploaded V6 specification is accepted
as the next development direction. V6 code must not begin until hosted CI,
publication verification, and release-operator sign-off are recorded.

This is a deliberate hold, not a V6 design rejection: the V6 specification
builds on the verified V5 Knowledge Image and lexical retrieval foundation,
while introducing a separate certified-evidence query layer.

## V5 evidence baseline

The implementation and test evidence is maintained in the
[V5 pre-V6 development plan](V5_PRE_V6_DEVELOPMENT_PLAN.md) and the
[V5 interoperability boundary](V5_INTEROPERABILITY.md). The final local gate
passed:

- Node workspace tests: 31 core tests plus CLI, scaffold, LangChain, and
  LlamaIndex adapter tests;
- Python: 21 tests, package build, Twine validation, and clean-wheel V5 smoke;
- Rust: 18 core tests, 11 ICP tests, template synchronization, and release
  WASM build;
- release metadata, package publication/archive checks, formatting, Markdown
  links, TrustBench, and the clean V5 create/inspect/query/verify/migrate/receipt
  smoke test.

The frozen shared image, commit, state, plan, and result roots are listed in
[`V5_INTEROPERABILITY.md`](V5_INTEROPERABILITY.md). V6 materials remain
ignored under `/docs/v6/` and are not part of the V5 release surface.

## V6 scope accepted for the next major-version phase

The reviewed V6 specification describes CESR as a certified-evidence query
runtime over V5 artifacts. The following are V6 work, not V5 completion work:

- evidence atoms, relations, applicability, and obligation plans;
- candidate challenge closure and certified-evidence evaluation;
- sparse optimization/solver integration and independent witness checking;
- certificate verification, membership bounds, and final decision statuses;
- V6 KIPs 0030–0037, V6 fixtures/TrustBench metrics, and `knolo v6` commands.

The V6 solver remains untrusted. Certified results must be checked against the
declared V5 image roots and V6 evidence/certificate contracts before a host
uses them. Model inference, networking, credentials, deployment, UI, and
external side effects remain host-owned.

## Do-not-cross rules

- Do not add CESR types, evidence semantics, V6 roots, solver code, or V6 CLI
  commands to V5 modules, V5 fixtures, or V5 package exports.
- Do not change the V5 container, canonical encoding, existing root
  composition, migration receipt semantics, or V4 compatibility behavior as a
  prerequisite for V6.
- Do not treat V5 query roots, adapter metadata, or TrustBench retrieval
  receipts as certified CESR decisions.
- Keep the uploaded V6 document and experiments ignored until their contents
  are intentionally promoted into a separately reviewed V6 workstream.

## Remaining release gates

- [ ] Run the configured hosted Node, Rust/ICP, and Python CI workflows from
      the reviewed V5 tree and attach their results to the release record.
- [ ] Verify the exact V5.1.0 npm, PyPI, and crates.io publication state before
      any publish or release-tag action.
- [ ] Record release-operator approval and close the V5 completion gate in the
      development plan.
- [ ] Only then create the V6 implementation branch/workstream from the
      verified V5 release point.

Until these checks are closed, the correct development state is **V5 complete
locally, V6 reviewed and queued, V6 implementation paused**.
