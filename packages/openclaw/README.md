# Knolo for OpenClaw

`@knolo/openclaw` gives OpenClaw agents read-only access to operator-pinned,
verified Knolo V5 Knowledge Images. It exposes `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status` plus a bundled grounding skill.

Each mount requires a local image path, byte SHA-256 pin, V5 state-root pin,
policy document, allowed OpenClaw agents, and Knolo policy principal. Query
records are written locally and can be replayed against the mounted image.
`maxAuditRecords` (default 10,000) and `maxAuditBytes` (default 256 MiB) bound
receipt retention; the oldest Knolo receipts are removed before a new receipt
is written.

The package requires an OpenClaw host compatible with its declared plugin API
range and Node 24.16 or newer. The plugin never downloads images during an
agent turn; install and pin Hub artifacts before configuring a mount.

## Published package

The current release is published on ClawHub as `@knolo/openclaw` version
`0.1.0`. It was built from the Knolo Core `main` branch at commit
`d8a175b4375c5bb8cf7d3e8b93dbcb6233a30da1`.
