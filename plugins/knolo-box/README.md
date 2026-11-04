# knolo-box

Grok Build plugin for a pinned knowledge image of a Grok Bot computer. One command installs the skill and the MCP server:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-box --trust
```

`--trust` is required so the skill and the MCP server load. Node.js 20 or newer must already be on `PATH`.

`@knolo/box@0.1.0` is not published yet. The plugin command is `npx -y @knolo/box@0.1.0 mcp`, and that download will fail until the package is on npm. Until then, run the workspace binary:

```bash
node packages/box/bin/knolo-box.mjs build
node packages/box/bin/knolo-box.mjs mcp
```

`mcp` starts `knolo-mcp` with the primary config and inherits stdio. It does not proxy JSON-RPC.

From the Plugins UI, add the marketplace `HiveForensics-AI/knolo-core`, install `knolo-box`, and trust it when asked.

The tool behavior is in [the skill](skills/knolo-box/SKILL.md). The layout is in [the box doc](../../docs/box/README.md). Package details are in the [@knolo/box README](../../packages/box/README.md).

Repository code stays on the [knolo-code plugin](../knolo-code/README.md).
