# KIP-0006: Durable V5 Store

Status: foundation implementation

This contract defines the Node adapter for the portable V5 single-writer
store. It does not change the V5 image bytes, transaction roots, or browser and
React Native APIs.

## File and lock ownership

`DurableKnowledgeImageStoreV5.open(path, initial?)` creates an exclusive
`path.lock` file before reading or creating the image. The lock contains the
writer process id for diagnostics. A second open fails closed while the lock
exists. `close()` releases the lock. Stale-lock recovery and lease expiry are
intentionally outside this foundation release.

An existing file is mounted and fully verified before `open()` returns. A
missing file requires `initial`; that initial image is verified by the normal
V5 mount path before its first durable write.

## Atomic commit persistence

For a committed transaction, the adapter:

1. serializes the next immutable Knowledge Image to a sibling temporary file;
2. flushes the temporary file with `fsync`;
3. atomically replaces the target with `rename`;
4. flushes the containing directory where supported; and
5. swaps the in-memory snapshot only after persistence succeeds.

The previous committed image remains the in-memory state if serialization or
replacement fails. A temporary file is removed on failure. The V5 A/B
superblocks remain part of the image-level torn-write recovery contract; the
adapter never edits an image in place.

## Portability boundary

This adapter is exported only from `@knolo/core/node`. The portable entry point
continues to have no Node filesystem imports. Browser and React Native callers
can use `KnowledgeImageStoreV5` with an application-provided persistence layer.

Durable multi-process coordination, stale-lock recovery, sync, transactions
spanning multiple files, and crash fault-injection tooling remain subsequent
work.
