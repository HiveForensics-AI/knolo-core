# V5 implementation handoff

The previous session collected the V4 codebase and the architecture
spec, then died before writing artifacts. This directory is the P0
deliverable that session owed: **freeze the contracts first**.

## What landed

- `spec/` KIP-0000 … KIP-0007 + threat model
- `spec/vectors/canonical-v1.json` — SHA-256 + deterministic CBOR
  known-answer tests every binding must match

## What this is not

Not the Rust transaction kernel. Not a V4 pack format change. Not a
release.

## Next coding session (strict order)

1. Add `packages/kernel-v5/` Rust workspace:
   - `knolo-crypto` — domain-separated SHA-256 + vectors
   - `knolo-codec` — deterministic CBOR
   - `knolo-format` — superblock / segment / mount read-only
   - keep `packages/core-rust` marked legacy V1–V3 reader
2. Port the vectors into `#[test]` and a TypeScript twin under
   `packages/core/src/v5/identity.ts` that *must* match hex.
3. V5 read-only container parser + full-root verification.
4. V4 → V5 genesis importer + migration receipt.
5. Atomic append/flush/commit/superblock + fault injection.

## Do not do yet

- New LivePack / Cortex / ClaimGraph log features
- Embedding-first retrieval
- Multi-writer local lock protocol
- ZK
- Hosted control plane

## V4 seams to freeze, not extend

| File | Treat as |
|------|----------|
| `packages/core/src/patch_pack.ts` | V4 compat importer |
| `packages/core/src/memory/log.ts` | V4 compat importer |
| `packages/core/src/graph/log.ts` | V4 compat importer |
| `packages/core/src/live.ts` | V4 overlay; replace with ledger |
| `packages/core/src/receipt.ts` | Shape inspiration for KIP-0005 |
| `packages/core/src/query.ts` | Strict ranker reference for EQL |
| `packages/core/src/tool_gate.ts` | Import to KIP-0006 |
| `packages/core-rust` | Legacy reader |

## Determinism contract (print this on the crate README)

Same state root + same EQL plan + same authority + same runtime
contract = the same canonical evidence package.
