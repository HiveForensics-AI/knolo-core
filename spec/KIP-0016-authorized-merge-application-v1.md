# KIP-0016: Authorized Merge Application V1

Status: foundation implementation

KIP-0016 applies an explicit resolution to a verified KIP-0015 merge plan.
The caller must provide exactly one local/remote decision for every conflict
and an authorization callback that approves the complete plan and normalized
resolution. The runtime verifies the plan against the supplied local, remote,
and ancestor images before invoking authorization.

An accepted resolution creates a new immutable image with both branch commits
as parents. Branch objects and selected events are retained, roots and views
are recomputed, and the resulting image is mounted and verified before it is
returned. Store-level merge methods persist only after successful construction,
so rejected, unresolved, or failed merges leave the current snapshot unchanged.

The authorization callback is host-injected; this KIP does not prescribe a
transport or authority protocol. Automatic conflict selection, remote writes,
and multi-writer coordination remain outside this release.
