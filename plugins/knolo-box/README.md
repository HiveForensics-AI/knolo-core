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

When the computer is not `~/.grok`, run `node packages/box/bin/knolo-box.mjs init --config <file>` before `build`. `init` follows symlinks and requires one real workflows directory and one real managed-skills directory. `--skills` and `--managed-skills` skip detection for that role. `mcp --config <file>` reads that box config and starts `knolo-mcp` with `<output>/knolo-mcp.json`. The host keeps its own connector record. Search lowercases the query, splits it on spaces, and keeps a chunk when every term appears in the text. A term can sit inside a longer word. An empty hit list is the result. The config shape is in [the box doc](../../docs/box/README.md).

From the Plugins UI, add the marketplace `HiveForensics-AI/knolo-core`, install `knolo-box`, and trust it when asked.

The tool behavior is in [the skill](skills/knolo-box/SKILL.md). The layout is in [the box doc](../../docs/box/README.md). Package details are in the [@knolo/box README](../../packages/box/README.md).

Repository code stays on the [knolo-code plugin](../knolo-code/README.md).
