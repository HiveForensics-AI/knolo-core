# KAR-1 research reference

Pure reference for [`spec/KAR-1.md`](../../spec/KAR-1.md), semantics version `kar-1-research-1`.

This directory is not an npm workspace and not a V5 state root. It does not export from `@knolo/core`, and the Rust crate is not `packages/core-rust`. A committed evidence graph is an input. This code does not compile natural language.

```bash
cd research/kar-1
npm test
npm run bench
cargo test --manifest-path rust/Cargo.toml --offline
```

`npm test` compiles the TypeScript with the repository's TypeScript binary at `../../node_modules/typescript` (install dependencies from the repository root). It checks the conformance vectors and checks `minimum-cover` against an independent enumeration of 200 tiny graphs. The Rust test recomputes every root in `fixtures/expected.json`. Those vector bytes stay fixed for `kar-1-research-1`.

The Knolo integration pilot is `integration/`. It is an internal entrypoint, `integration/index.mjs`, and it is not exported from `@knolo/core`.

```bash
npm run test:integration
npm run bench:integration
```

The hand-authored benchmark in `bench/REPORT.md` is a conformance demonstration on graphs whose edges were written down. It is not Experiment 6 and it does not score a compiler.
