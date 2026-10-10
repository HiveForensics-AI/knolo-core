# KAR-1 research freeze

Semantics version: `kar-1-research-1`.

This freeze covers the research draft and the reference vectors. It does not register a V5 digest domain, assign a KIP number, or state novelty.

| Artifact | SHA-256 |
| --- | --- |
| `spec/KAR-1.md` | `a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66` |
| `research/kar-1/fixtures/expected.json` | `154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf` |

The TypeScript reference and the Rust verifier both reproduce `fixtures/expected.json`. A later change to the algorithm or the draft is a new semantics version, not a silent edit of this one.

Prior-art review is still required before any public novelty claim and before promotion to a numbered KIP. `spec/KAR-1.md` section 11 is the boundary of what the five experiments support.
