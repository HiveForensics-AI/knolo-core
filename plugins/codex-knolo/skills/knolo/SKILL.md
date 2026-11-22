---
name: knolo
description: Search a pinned local Knolo Knowledge Image with the read-only MCP tools.
---

# Knolo

Use `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status` for questions about mounted knowledge. Cite the `imageId`, `objectId`, and `stateRoot`.

The server is `@knolo/mcp@0.2.4` over stdio. `KNOLO_MCP_CONFIG` is the absolute path of `knolo-mcp.json`. A missing or invalid config fails closed. Tool arguments cannot set the caller, the image, or the policy.

`SATISFIED` means evidence requirements were met. It does not mean a claim is proven. A receipt is an integrity check. It does not mean a claim is proven.
