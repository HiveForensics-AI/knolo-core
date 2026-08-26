# KIP-0020: Durable agent runs v1

Status: foundation implementation

This contract defines the deterministic state and journal mechanics for a
durable V5 agent run. It does not define model execution, tool invocation,
authority decisions, scheduling, or cluster leases.

## Run identity and roots

A run is bound to an agent identifier, the mounted Knowledge Image state root,
and a canonical input root. The run ID is:

```text
SHA-256("knolo:run-id:v1" || canonical_cbor({
  agentId, createdAt, imageStateRoot, inputRoot, version: 1
}))
```

Inputs and checkpoint state use the `run-input` and `run-state` digest domains.
Each journal event uses the `run-event` domain and includes the run ID, event
sequence, timestamp, kind, and payload. The run root covers the complete run
record except its derived `runRoot` field and uses the `run` domain.

## Journal state machine

The permitted lifecycle is:

```text
pending --started--> running
running --checkpointed--> paused
paused --resumed--> running
running|paused --completed--> completed
running|paused --failed--> failed
```

Events are append-only, numbered from one, and must verify against their event
IDs. Timestamps are non-negative safe integers and cannot move backward.
Malformed records, invalid transitions, root mismatches, and identity changes
are rejected fail-closed.

## Checkpoints and resume

A checkpoint stores the exact state plus its `run-state` root and the sequence
of the checkpoint event. A run can resume only when its checkpoint and journal
relationship verify. The pure TypeScript lifecycle functions are suitable for
browser and host runtimes; `DurableKnowledgeRunStoreV5` provides the Node
file-backed adapter.

The Node adapter owns an exclusive lock, verifies an existing run before
opening, writes through a temporary file with flush/rename semantics, and
removes the lock on open failure. A failed update does not replace the current
verified snapshot.

## Scope boundary

This KIP makes run state durable and verifiable. The host remains responsible
for executing models and tools, applying authority policy, managing scheduling
and leases, and deciding how external side effects are recorded. Networked run
replication, signed run authority, and Studio management are subsequent
features.
