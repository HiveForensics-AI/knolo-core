# KIP-0012: Sync Summary V1

Status: foundation implementation

KIP-0012 defines the first safe synchronization boundary for V5. A sync
summary commits to the image state root, commit digest, sequence, parent
commits, object root, event root, and optional authority keyring root.

The runtime compares two verified images and returns one of:

- `equal`: both images identify the same state;
- `local-ahead`: the local commit directly names the remote commit as a parent;
- `remote-ahead`: the remote commit directly names the local commit as a parent;
- `diverged`: neither state is a direct fast-forward of the other.

For `remote-ahead`, the plan lists remote object and event IDs absent locally.
For divergence, no transfer or merge set is produced. Automatic merge,
network transport, signatures over transport messages, and conflict resolution
remain subsequent upgrades. This release therefore cannot silently overwrite a
branch or durable snapshot.

`syncSummaryRoot` and `sync-plan` roots use canonical CBOR and the existing
`knolo:<domain>:v1` SHA-256 domain separation. Memory and Node durable stores
expose planning only; state mutation still requires the existing single-writer
transaction path.
