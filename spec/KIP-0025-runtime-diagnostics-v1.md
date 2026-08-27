# KIP-0025: Runtime diagnostics v1

Status: foundation implementation

This contract defines a read-only operational snapshot for a V5 runtime. It
provides the health and introspection data that a CLI, service, or future
Studio management surface can display without granting that surface mutation
authority.

## Diagnostics contents

`inspectKnowledgeRuntimeV5` always verifies the mounted image and reports its
state root, commit digest, sequence, object/event counts, segment count, and
active superblock. Optional verified artifacts add compact status records for:

- the state-root-bound query index;
- append-only query history;
- the durable agent run; and
- the sync replay cache.

The report contains no unverified “healthy” flag. If an artifact is malformed,
stale, or bound to a different image state root, inspection fails closed.

## Diagnostics root

The complete report, excluding its derived root, is canonicalized and hashed
with the `runtime-diagnostics` domain:

```text
SHA-256("knolo:runtime-diagnostics:v1\0" || canonical_cbor(report_without_root))
```

`verifyKnowledgeRuntimeDiagnosticsV5` recomputes the report from the supplied
artifacts and requires byte-equivalent canonical output and a matching root.
Equivalent reports therefore produce identical roots across runtimes.

## Scope boundary

Diagnostics do not repair, compact, adopt, merge, authorize, or delete runtime
state. File discovery, process metrics, network connectivity, alert routing,
and UI presentation remain host or Studio responsibilities. This contract is
deliberately suitable for health endpoints and offline inspection commands.
