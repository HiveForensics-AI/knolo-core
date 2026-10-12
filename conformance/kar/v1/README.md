# KAR public conformance v1

Compact vectors for the production TypeScript API on the 6.1.0 tree. They cover support, opposition, qualification, temporal applicability, authority, a supplied anchor, abstention, a search bound, a closure bound, certificate tamper, and dossier-language tamper. Composition has its own vectors and does not change these results.

```bash
npm run build --workspace @knolo/core
node conformance/kar/v1/run.mjs
```

From a checkout:

```bash
knolo kar conformance
```

`expected.json` locks status, stable code, selected-set size, and the certificate roots for these inputs. A mismatch exits non-zero.

`UNSATISFIED_EVIDENCE_REQUIREMENTS` is a successful conformance result. It means the declared requirements were not met. It does not mean the proposition is false.

## Rust

The Rust verifier reproduces the research oracle, not these V5 image vectors:

```bash
cd research/kar-1 && npm test
cargo test --manifest-path research/kar-1/rust/Cargo.toml --offline
```

`research/kar-1` remains the executable reference for `kar-1-research-1`.
