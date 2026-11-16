# KITE pre-publish check

This record is the local check of KITE phases 0–5 on main
`df731c78e4da60488e915dddaced109a0e425601` (merge of PR #175, 2026-11-14).
It is not an npm publish. Package versions were not changed.

`@knolo/core` stays 6.2.2. `@knolo/cli` stays 6.2.5. The Rust crate, the
Python package, and the ICP canister stay 5.5.1. `knolo kite` is in this
checkout. Published `@knolo/cli@6.2.5` does not include it. The ICP canister
methods stay pack, search, and health.

The [benchmark note](BENCHMARK.md) is a synthetic fixture review. It is not
a customer-corpus review and not a novelty claim.

| Command                                                        | Result                                                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test --prefix packages/core`                              | 264 tests passed, then `scripts/test.mjs` passed                                                                                              |
| `node packages/core-rust/tests/emit-kite-fixtures.mjs --check` | KITE Rust fixtures match                                                                                                                      |
| `cargo test --manifest-path packages/core-rust/Cargo.toml`     | 30 tests passed (5 library, 24 image, 1 KAR vector)                                                                                           |
| `cargo test --manifest-path packages/icp-canister/Cargo.toml`  | 11 tests passed                                                                                                                               |
| `bash scripts/check-icp-template-sync.sh`                      | Template sources match                                                                                                                        |
| `node --test packages/cli/test/kite.test.mjs`                  | 1 test passed                                                                                                                                 |
| `node examples/kite-policy/run.mjs`                            | `UNDERDETERMINED sha256-526d163cb9044fce7408d935dcb20817d8e0e2b736fd9dfa7cb4c41792fc7ff1`                                                     |
| `node conformance/kite/v1/run.mjs`                             | KITE conformance vectors match                                                                                                                |
| `npm run release:check`                                        | Passed on this commit before this page: builds, V5 preflight, release metadata, 301 Markdown files, package source checks, and archive checks |

A second documentation link check, after this page was added, passed for
302 Markdown files. GitHub Actions on the pull-request head `9820a44`
reported 36 successful checks before that merge. This page does not bump a
version, tag a commit, or publish a package. A later package-file stamp sets
`@knolo/core` to `6.2.3` and `@knolo/cli` to `6.2.6`. `@knolo/cli@6.2.5` does not include `knolo kite`.
npm `latest` for `@knolo/core` is `6.2.3` and for `@knolo/cli` is `6.2.8`.
