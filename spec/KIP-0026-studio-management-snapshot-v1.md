# KIP-0026 — Read-only Studio management snapshot v1

Status: foundation

## Purpose

This contract defines the deterministic management surface that a future Knolo
Studio may consume. It exposes verified runtime state and the availability of
optional artifact panels without granting the management surface mutation
authority.

## Snapshot

`inspectKnowledgeStudioManagementV5(input)` first performs the complete
`KnowledgeRuntimeDiagnosticsV1` inspection. The result contains:

- `version: 1`;
- `surface: "studio-management"`;
- `valid: true` and `readOnly: true`;
- the verified runtime diagnostics snapshot;
- fixed image inspection and verification capabilities;
- booleans indicating whether query-index, query-history, run, and replay
  artifacts were supplied and verified;
- `mutateImage: false`;
- `managementRoot`.

The capability values describe only this read-only management surface. They do
not grant query, transaction, authority, sync, or host execution permissions.

## Root

`managementRoot` is:

```text
SHA256("knolo:studio-management:v1" || canonical_cbor(snapshot_without_managementRoot))
```

The root commits to the complete diagnostics snapshot and artifact-panel
availability. Field order is defined by canonical CBOR; no JSON key order is
significant.

## Verification and failure behavior

`verifyKnowledgeStudioManagementV5(input, snapshot)` recomputes the diagnostics
and management root from the supplied input. It rejects malformed snapshots,
tampered fields, stale artifact bindings, and root mismatches. Verification is
fail-closed and has no mutation behavior.

Unknown fields are not part of the V1 contract and must not be included when
computing `managementRoot`. A future version must use a new versioned contract
and domain.
