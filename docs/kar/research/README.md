# KAR research history

Product use starts at [KAR](../README.md) and the [quickstart](../quickstart.md). This page only points at the research record. Those files stay where they are. `research/kar-1` remains the executable semantic oracle for `kar-1-research-1`.

## Specification and oracle

- [spec/KAR-1.md](../../../spec/KAR-1.md)
- [research/kar-1](../../../research/kar-1/README.md)

Run the oracle from `research/kar-1` with `npm test` and `cargo test --manifest-path rust/Cargo.toml --offline`.

## Phase reports

- [Experimental core](../EXPERIMENTAL_CORE_REPORT.md)
- [CEG toolchain](../CEG_TOOLCHAIN_REPORT.md)
- [Semantic producers](../SEMANTIC_PRODUCERS_REPORT.md)
- [Evidence review workflow](../EVIDENCE_REVIEW_WORKFLOW.md)
- [Real-corpus validation](../REAL_CORPUS_VALIDATION_REPORT.md)
- [Real-corpus v2](../REAL_CORPUS_VALIDATION_V2.md)
- [Real-corpus v3](../REAL_CORPUS_VALIDATION_V3.md)
- [Real-corpus v4](../REAL_CORPUS_VALIDATION_V4.md)
- [Domain pack v3](../DOMAIN_PACK_V3_REPORT.md)
- [Domain pack v4](../DOMAIN_PACK_V4_REPORT.md)
- [Domain pack v5](../DOMAIN_PACK_V5_REPORT.md)
- [Human gold](../HUMAN_GOLD_VALIDATION_REPORT.md)
- [Human gold final](../HUMAN_GOLD_FINAL_REPORT.md)
- [Human pilot](../HUMAN_PILOT_REPORT.md)

Human gold and the pilot are `HUMAN_REVIEW_REQUIRED`. Domain pack v5 was not built. That state blocks a claim of validated automatic extraction. It does not block the KAR runtime, the CEG compiler, dossiers, or verification.

V6 engineering notes:

- [Gap audit](../V6_GAP_AUDIT.md)
- [Release readiness](../V6_RELEASE_READINESS.md)
- [Release notes](../../releases/v6.0.0.md)
