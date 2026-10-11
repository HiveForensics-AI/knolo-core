# Domain Pack v4 report

Package version `5.5.1`. Version `6.0.0` was not published. `kar-1-research-1` and `ceg-source-1` were not changed.

Classification: `HUMAN_REVIEW_REQUIRED`.

## Why v4 exists

Phase 11 stopped at `GOLD_STANDARD_BLOCKED`. The engine, compiler, and producer framework stayed sound. Version 3 committed no relations, because no relation rule met the development bar. On the Phase 11 holdout that produced 1,163 grounded auto-accept excerpts, 382 review proposals, and 31 observations, with invented evidence, dates, authority, and referents at 0.

Version 3 roots were not edited:

| Pack | DomainPackRoot |
| --- | --- |
| contracts v3 | `sha256-6ae56377066d223902532a3cbc092965f377b9be754071891e8b0fcddbcf3008` |
| policy v3 | `sha256-e8b870e3153bc9037d6b8083fc89d742d320eb9ffa7af507ba3ad40ce0d724f8` |
| operations v3 | `sha256-b71574dd91b60e29766ebcefda39c13a11f9f5eca965934d1697fec13a9c6d01` |

## v4 changes

Version 4 keeps `AUTO_ACCEPT`, `NEEDS_REVIEW`, and `OBSERVATION_ONLY`. It adds bounded review rules for `must`, `shall`, `will`, `may`, `agrees to`, `shall be responsible`, `has the right to`, renewal verbs, heading context, and unresolved `pursuant to` / `as provided in` references. Heading rules that carry no relation may auto-accept as context. Date rules stay review-only and do not paint a committed window. Incomplete references stay `OBSERVATION_ONLY` and carry `INCOMPLETE_REFERENCE` with no invented target. Numeric authority still attaches only from an explicit integer.

`supports` and `contradicts` are in the pack vocabulary so a reviewer can add them. No rule emits them automatically. Concept kind `condition` is in each registry. A contracts concept `right` is separate from kind `right` on a more specific id.

| Pack | DomainPackRoot |
| --- | --- |
| contracts v4 | `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5` |
| policy v4 | `sha256-109ad58943b28a93453205ea86585843931eb69d8a989bcd071e8e48c70eacea` |
| operations v4 | `sha256-edde04257c55c480c95ce3db90074238a54ab05ee8c9d25135190f5da70f6da4` |

Relation-producing `AUTO_ACCEPT` rules: 0 in each pack. Policy class counts:

| Pack | AUTO_ACCEPT | NEEDS_REVIEW | OBSERVATION_ONLY | unset |
| --- | --- | --- | --- | --- |
| contracts | 5 | 45 | 9 | 1 |
| policy | 5 | 31 | 8 | 1 |
| operations | 5 | 27 | 5 | 1 |

The unset rule is the existing explicit-integer authority side effect. It has no `policyClass`.

## Calibration

`research/kar-real-corpus-v3/calibrate.mjs` scored v4 against the exposed Phase 10 adjudicated set. It does not edit packs. Phase 11 has no stable gold, so it was not used as a precision denominator. Of 143 rules, 0 were suggested for `AUTO_ACCEPT`.

Rules at strict precision 1 still missed the sample bar. `contracts.termination.permission.v1` had 7 matches across 6 families. Payment `shall pay` clause and phrase rules had 4 matches across 2 families. One-off perfect rules stayed `NEEDS_REVIEW`.

Broad duties stayed well below 98 percent. `contracts.duty.shall.v4` had 143 matches, 10 families, and strict precision 0.531. `contracts.duty.will.v3` had 44 matches and precision 0.455. `contracts.duty.agrees.v3` had 13 matches, 5 families, and precision 0.846. `operations.step.must.v3` had 31 matches, 2 families, and precision 0.935. `operations.step.must.v2` had 62 matches, 2 families, and precision 0.919.

`policy.control.required.v1` is still copied from v3. Its token is `control-required`, while Annotation Guide v3 uses `requirement-duty` unless the quote names a control. The new policy duty rules propose `requirement` and `requirement-duty`. Both can appear as review proposals. Neither is auto-accepted.

## What was not scored

v4 was not run on a fresh holdout. P0, P1, P2, and P3 quality against human gold was not measured. Review seconds were not measured. Model proposals were not run.

## Historical gates

Repository tests finished at 2026-10-11T14:46:51+02:00 with exit 0. Core 210, CLI 56, reflex 42, evidence-gate 9, semantic-ollama 6, langchain 2, llamaindex 2, create-knolo-app 1, KAR unit 16, KAR integration 5, and core-rust 24 passed with 0 failures. KAR Rust parity passed. The named 10,000, 25,000, and 50,000 producer, CEG, differential, and tamper gates are inside those suites. KAR mismatches 0. CEG compiler mismatches 0.

The 50,000-node closure rerun is `research/kar-real-corpus-v3/results/closure-scale-rerun.json` at `sha256-6c02014629c8f10a0c78f6276a6a39c26b2de31693bed43ffae1c097950c5131`. Chain degree 1 at 50,000 nodes: closure p50 15,907.74 ms, 49,999 edges, frontier 8. Local degree 3 depth 4 at 50,000 nodes: closure p50 28.80 ms. The published file `research/kar-1/integration/bench/scale-results.json` was restored to `sha256-77093ffe56710d0055d5863febc5a722a12577608322e284bf5a17f428241981`.
