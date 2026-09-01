# V5.1.0 release record

**Status:** Release candidate prepared locally; publication not yet performed

**Date:** 2026-09-01

**Owner:** Knolo runtime/release maintainers

**Previous live release:** V5.0.0 (`v5.0.0`, 2026-08-28)
**Candidate release:** V5.1.0 (`v5.1.0` after external approval)

## Release decision

V5.1.0 is the correct next version because this release adds backward-
compatible V5 capabilities and runtime profiles after the already-live V5.0.0
foundation. It is a minor release, not a patch release and not V6.

The candidate contains no CESR implementation. The V6 specification remains
reviewed and queued under the [V5-to-V6 handoff](V5_TO_V6_HANDOFF.md), with V6
materials excluded from the V5 release surface.

## Release contents

All public package and crate metadata is aligned to `5.1.0`:

- npm: `@knolo/core`, `@knolo/cli`, `@knolo/langchain`,
  `@knolo/llamaindex`, `@knolo/semantic-ollama`, and `create-knolo-app`;
- Rust: `knolo-core-rust` and `knolo-icp-canister`, including the bundled ICP
  template;
- Python: `knolo` `5.1.0` with read-only V5 image verification/query support;
- package-lock and Cargo.lock files with matching internal versions and ranges.

The functional scope is documented in the [V5 interoperability boundary](V5_INTEROPERABILITY.md)
and [V5.1.0 release guide](RELEASE.md): durable leases and authorized sync,
read-only Studio/diagnostics boundaries, Python and adapter V5 profiles,
cross-runtime vectors, and trust/compatibility documentation.

## Local verification evidence

The following commands passed on 2026-09-01 from the candidate tree:

| Check                          | Result                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `npm run release:check`        | Passed: builds, exports, package publication sources, archives, metadata, and docs |
| `npm test`                     | Passed: 31 core tests plus CLI, scaffold, LangChain, and LlamaIndex tests          |
| `python -m pytest`             | Passed: 21 tests                                                                   |
| Python build and `twine check` | Passed for `knolo-5.1.0` sdist and wheel                                           |
| Clean Python wheel V5 smoke    | Passed: shared state, query result root, and `__version__ == 5.1.0`                |
| `npm run test:icp`             | Passed: 18 Rust tests, 11 ICP tests, and template synchronization                  |
| ICP WASM release build         | Passed                                                                             |
| `npm run trustbench:test`      | Passed                                                                             |
| `npm run smoke:v5`             | Passed: create, inspect, query, verify, migrate, and receipt                       |
| `npm run format:check:all`     | Passed                                                                             |
| `npm run docs:check`           | Passed: 79 Markdown files                                                          |
| `git diff --check`             | Passed                                                                             |

The exact roots and cross-runtime expectations are frozen in
[`conformance/v5/README.md`](../conformance/v5/README.md) and
[`V5_INTEROPERABILITY.md`](V5_INTEROPERABILITY.md).

## External release checklist

- [x] Local implementation phases and V5 completion evidence are complete.
- [x] Version metadata, changelogs, lockfiles, and release instructions are
      aligned to `5.1.0`.
- [x] V6 implementation remains absent and `/docs/v6/` remains gitignored.
- [ ] Run hosted Node, Rust/ICP, and Python CI on the reviewed candidate tree.
- [ ] Verify npm, PyPI, and crates.io publication state for `5.1.0`.
- [ ] Commit the reviewed release tree and create the `v5.1.0` tag.
- [ ] Publish the packages/crates and create the GitHub release.
- [ ] Attach hosted and registry evidence, record release-operator approval,
      and close the V5 completion gate.
- [ ] Start the separate V6 implementation workstream only after approval.

The candidate is ready for those external operations; this record does not
claim that a registry publication, GitHub release, commit, or tag has happened.
