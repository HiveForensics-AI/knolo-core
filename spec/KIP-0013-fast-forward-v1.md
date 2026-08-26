# KIP-0013: Verified Fast-Forward Import V1

Status: foundation implementation

KIP-0013 defines the first V5 state-import operation. A local store may adopt a
remote image only when both images mount and verify, the remote commit directly
names the current local commit as a parent, and supplied authority keyring
roots agree.

Equal, local-ahead, and diverged states are rejected as fast-forward imports.
No object or event is partially copied, and no implicit merge is attempted.
The Node durable store writes the verified remote bytes using its existing
temporary-file, fsync, atomic-replace, and directory-fsync sequence before
publishing the new in-memory snapshot. Active writer transactions block the
operation.

Network transport, multi-writer coordination, automatic merge, and divergent
branch resolution remain subsequent upgrades.
