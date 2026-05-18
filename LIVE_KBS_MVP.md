# Live KBs MVP

## Summary

- Add `LivePack` as a deterministic mutable overlay on top of an immutable mounted base pack.
- Keep the existing flattened postings index, Cortex, and `query()` pipeline unchanged in phase 1.
- Persist with full-snapshot `serialize()` only; no mutable postings map, patch-pack format, or mutation log yet.

## Implementation

- Add a new `packages/core/src/live.ts` module with `createLivePack()` and `LivePack`.
- Make live mutations require stable doc ids; the initial `docs` array follows the same rule.
- `addDocument()` inserts or replaces, `updateDocument()` merges partial fields onto the last known full doc and shadows any base copy, and `removeDocument()` tombstones the id while deleting any overlay copy.
- Keep internal state as a read-only `base`, an overlay `Map` of docs, a `Set` of tombstones, a rebuilt `delta` pack, and only the deterministic build knobs that can be recomputed from docs alone.
- Rebuild only the overlay pack after each mutation with the existing `buildPack()` and `mountPack()` primitives.
- Query base and delta separately with the existing lexical/graph options, collapse duplicate ids with delta winning, and sort final hits by `score desc`, `source/docId asc`, then `blockId asc`.
- Return the same `Hit[]` shape as `query()` so downstream code can swap in live packs without adapter changes.
- Keep live querying lexical/graph-only in v1; semantic build options are rejected for live packs until we add a mutation-time embedding story.
- Make `serialize()` materialize the merged live state in stable id order and return a normal `.knolo` snapshot.
- Export `LivePack`, `createLivePack()`, and `LivePackOptions` from `packages/core/src/index.ts`.
- Update the root README and `packages/core/README.md` to document `LivePack`, clarify that Cortex remains a separate append-only memory layer, and keep `knolo dev` as the watch/rebuild workflow instead of adding `build --watch` now.
- Leave `packages/core/src/indexer.ts`, `packages/core/src/query.ts`, and the CLI command behavior unchanged for this phase.

## Test Plan

- Add a `node:test` suite under `packages/core/test` for the live pack lifecycle.
- Cover adding a doc, updating a base doc, removing a base doc, re-adding a removed id, query merging, and `serialize()` round-tripping through `mountPack()`.
- Verify repeated `serialize()` calls on the same live state are byte-identical.
- Verify deterministic merge order for equal-score hits and delta-over-base precedence.
- Verify missing ids and updates to unknown ids fail fast.

## Assumptions

- Phase 1 is lexical/graph-only; semantic live updates are deferred to a later `consolidate()` or embedding-aware follow-up.
- Anonymous blocks in an existing base pack stay queryable but are read-only for live mutations.
- Rebuilding the overlay pack on every mutation is the intended MVP tradeoff for incremental evidence and docs-scale writes.
- Patch packs, mutation logs, source-watcher APIs, and `build --watch` stay out of scope for this phase.
- No Rust/ICP changes are needed because the persisted output remains a standard `.knolo` pack.
