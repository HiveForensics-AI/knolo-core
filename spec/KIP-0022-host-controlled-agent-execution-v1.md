# KIP-0022: Host-controlled agent execution v1

Status: foundation implementation

This contract defines the boundary between the agent host and the Knolo V5
knowledge runtime. Knolo supplies verifiable run state; the host supplies model
inference and external tool execution.

## Execution contract

`executeKnowledgeAgentRunV1` accepts a pending, running, or paused durable run,
the original input, and an injected `executeStep` function. The input is
re-hashed with the `run-input` domain and must equal the run's input root.
Pending runs are started; paused runs are resumed; completed and failed runs
cannot be resumed.

Each step is one of:

```text
tool       -> host executes a validated ToolCallV1 and returns ToolResultV1
checkpoint -> state is journaled and execution returns paused
complete   -> result state is journaled and execution returns completed
```

Tool calls must have unique call IDs within an execution. When an agent
definition is supplied, the existing allow/deny tool policy is enforced before
the host executor is called. Missing executors, malformed or mismatched tool
results, rejected tools, and executor errors fail the run through the durable
run journal.

## Bounds and persistence

Execution is bounded by `maxSteps` (default 64, maximum 1000). The clock is
injectable for deterministic tests and must return non-negative safe integers.
The optional `persist` callback is invoked after start, resume, checkpoint,
completion, and failure transitions; it can delegate to
`DurableKnowledgeRunStoreV5` for atomic disk persistence.

Tool calls and results are returned in the execution report for host tracing.
They are not implicitly placed into the canonical run state because tool
outputs may contain non-CBOR values or external side effects. Hosts that need
durable tool evidence should encode a bounded representation into a checkpoint
state explicitly.

## Scope boundary

This KIP does not select a model, execute tools, manage credentials, schedule
agents, provide leases, or decide authority. It is compatible with any agent
framework that can implement the step and tool adapters. Networked execution,
signed run authority, and Studio management remain subsequent features.
