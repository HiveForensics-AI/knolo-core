# KIP-0005: Single-writer transactions

Status: implemented foundation feature

`KnowledgeImageStoreV5` maintains one committed image and permits one active
writer transaction. Readers call `snapshot()` and receive detached immutable
state. A transaction records the base commit digest, stages new objects, and
creates one child commit.

The child commit:

- sets `parents` to the base commit digest;
- increments `sequence` by one;
- retains all prior objects and events;
- appends events for staged objects;
- recomputes object, event, transaction, view, commit, and state roots.

Commit rejects a transaction that is not the store's active writer or whose base
commit is no longer current. Rollback releases the writer slot without changing
the committed image.

This release intentionally does not provide concurrent writers, durable file
locking, sync, conflict merging, authority evaluation, or transaction
signatures.
