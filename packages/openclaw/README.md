# Knolo for OpenClaw

`@knolo/openclaw` gives OpenClaw agents read-only access to operator-pinned,
verified Knolo V5 Knowledge Images. It exposes `knolo_search`, `knolo_get`,
`knolo_verify`, and `knolo_status` plus a bundled grounding skill.

Each mount requires a local image path, byte SHA-256 pin, V5 state-root pin,
policy document, allowed OpenClaw agents, and Knolo policy principal. Query
records are written locally and can be replayed against the mounted image.

The package requires an OpenClaw host compatible with its declared plugin API
range and Node 24.16 or newer. The plugin never downloads images during an
agent turn; install and pin Hub artifacts before configuring a mount.
