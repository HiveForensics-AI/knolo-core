# Knolo V5 Specification Set

**Status:** Draft (implementation-bound)  
**Target:** Knolo V5 Verifiable Knowledge Runtime  
**Source of truth:** these KIPs — not TypeScript implementation comments  
**Runtime kernel:** Rust (Node / Python / WASM bind to the Rust contract)

This directory freezes the V5 wire and trust contracts before code lands.

## Determinism contract

```
same state root + same EQL plan + same authority + same runtime contract
  = the same canonical evidence package
```

## Documents

| Spec | Title | Status |
|------|-------|--------|
| [KIP-0000](./KIP-0000-process.md) | Spec process and versioning | Draft |
| [KIP-0001](./KIP-0001-container.md) | V5 container (superblock, segments, mount) | Draft |
| [KIP-0002](./KIP-0002-ledger.md) | Unified event ledger and transactions | Draft |
| [KIP-0003](./KIP-0003-canonical-encoding.md) | Canonical CBOR, domain separation, state roots | Draft |
| [KIP-0004](./KIP-0004-eql.md) | Evidence Query Language | Draft |
| [KIP-0005](./KIP-0005-receipts.md) | Read / write / run receipts | Draft |
| [KIP-0006](./KIP-0006-authority.md) | Default-deny capabilities | Draft |
| [KIP-0007](./KIP-0007-sync.md) | Deltas, branches, merge, federation | Draft |
| [THREAT-MODEL](./THREAT-MODEL.md) | Integrity, authenticity, rollback | Draft |

## Implementation order (normative)

1. Freeze byte/trust contracts (this directory)
2. Canonical encoding + cryptographic state identity
3. Rust single-file transaction kernel
4. Incremental projections
5. EQL IR
6. Read/write receipts
7. Default-deny authority
8. Durable agent runtime
9. Sync / federation
10. Studio and advanced proofs

Do not reorder. Surface features on an unstable trust substrate are rejected.

## Compatibility

- V1–V4 packs remain readable.
- V4 → V5 migration is a deterministic genesis transaction that emits a migration receipt.
- V4 patch packs, Cortex logs, and ClaimGraph logs are compatibility surfaces only. New mutations use the V5 ledger.

## Conformance home

New contracts land with fixtures under `trustbench/` and `conformance/`.
A spec without a vector is not implementable.
