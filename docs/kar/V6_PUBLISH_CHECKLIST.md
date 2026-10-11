# V6 publish checklist

Do not run `npm publish` until a person reviews this list. This candidate is `6.0.0-rc.1`.

## Packages

- `@knolo/core` `6.0.0-rc.1`
- `@knolo/cli` `6.0.0-rc.1`
- `@knolo/langchain` `6.0.0-rc.1`
- `@knolo/llamaindex` `6.0.0-rc.1`
- `@knolo/semantic-ollama` `6.0.0-rc.1`
- `create-knolo-app` `6.0.0-rc.1`

Leave `@knolo/reflex` at `0.2.0` and `@knolo/evidence-gate` at `0.1.0`. Their `@knolo/core` range is `>=6.0.0-rc.1 <7`.

Leave `knolo-core-rust`, `knolo-icp-canister`, and Python `knolo` at `5.5.0`.

## Before publish

- `npm run release:check` is green on the release commit
- `npm test` is green, including KAR differential, tamper, compiler, and producer gates
- `node conformance/kar/v1/run.mjs` matches `expected.json`
- `cargo test --manifest-path research/kar-1/rust/Cargo.toml --offline` matches the research oracle
- `npm pack --dry-run` for `@knolo/core` contains `dist` and does not contain `research/` or `domains/`
- A clean install from the packed tarballs can mount an image, run a lexical query, compile a CEG, build a dossier, and verify it
- A browser bundle of `@knolo/core` and `@knolo/core/kar` has no `node:` import
- Domain Pack maturity in `domains/v6-catalog.json` is still `review-required` unless a human-gold report says otherwise
- Restricted Phase 10–12 corpus files are not in the tarball or the handoff zip

## After publish

Tag the candidate. Do not retag it as `6.0.0` until the RC smoke and a second full suite pass. Final `6.0.0` keeps Domain Packs at `review-required` if human validation is still incomplete.
